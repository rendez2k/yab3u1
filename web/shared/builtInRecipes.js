// Recipes for the built-in colour mode: each source colour is written into the model as
// a repeating layer-by-layer sequence of reels. Everything here is an estimate from the
// layer-interleaved model in fdmMix.js, never a measured colour. Pure functions, no DOM.
import { mixManyHex, FDM_MODEL } from './fdmMix.js';
import { distance, norm } from './colour.js';
import { MIN_IMPROVEMENT } from './mix.js';
import { builtInModelSlots } from './builtInReels.js';

export const DENOMINATORS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 40];
export { MAX_SEQUENCE } from './blendCalibration.js';
const PERIOD_CAP = 240;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;
const popcount = (n) => { let c = 0; for (let v = n; v; v &= v - 1) c += 1; return c; };
const weightOf = (value, fallback = 1) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** counts[i] layers of reel i+1, as 1-based reel numbers spread as evenly as possible. */
export function spreadSequence(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  const placed = counts.map(() => 0);
  const sequence = [];
  for (let i = 0; i < total; i += 1) {
    // counts[r]*(i+1)/total - placed[r], scaled by total so the comparison stays exact.
    let pick = -1;
    let pickValue = -Infinity;
    for (let r = 0; r < counts.length; r += 1) {
      if (!counts[r]) continue;
      const value = counts[r] * (i + 1) - placed[r] * total;
      if (value > pickValue) { pick = r; pickValue = value; }
    }
    placed[pick] += 1;
    sequence.push(pick + 1);
  }
  return sequence;
}

/**
 * The model reels (builtInReels.js), 0-based: not support and a usable colour. Mixed
 * materials among them are refused by builtInProblem, never silently left out here.
 */
const modelReelIndexes = (reels) => builtInModelSlots(reels).map((slot) => slot - 1);

function* compositions(total, parts) {
  if (parts === 1) { yield [total]; return; }
  for (let first = 0; first <= total; first += 1) {
    for (const rest of compositions(total - first, parts - 1)) yield [first, ...rest];
  }
}

/** Every way to share each denominator among the model reels, one entry per reduced ratio. */
export function builtInCandidates(reels) {
  const model = modelReelIndexes(reels);
  if (!model.length) return [];
  const colours = reels.map((reel) => norm((reel || {}).color));
  const out = [];
  // 1 is not a denominator, but it is where each single-reel recipe lives.
  for (const denominator of [1, ...DENOMINATORS]) {
    for (const share of compositions(denominator, model.length)) {
      // A ratio that is not already reduced was listed under a smaller denominator.
      if (share.reduce(gcd, 0) !== 1) continue;
      const counts = reels.map(() => 0);
      model.forEach((reelIndex, k) => { counts[reelIndex] = share[k]; });
      out.push({ counts, sequence: spreadSequence(counts), color: mixManyHex(colours, counts) });
    }
  }
  return out;
}

/**
 * For each source colour take the shortest recipe whose estimate is within MIN_IMPROVEMENT of
 * the closest one. weights (by source) only add up into each recipe's weight for alignPhases.
 */
export function planBuiltIn(sourceColors, reels, weights = {}) {
  const candidates = builtInCandidates(reels);
  if (!candidates.length) throw Error('At least one model filament is required.');
  const rows = [];
  const recipes = new Map();
  Object.keys(sourceColors).map(Number).sort((a, b) => a - b).forEach((source) => {
    const original = norm(sourceColors[source]);
    if (!original) throw Error(`Source colour ${source} is not a valid colour.`);
    const scored = candidates.map((candidate) => ({ candidate, error: distance(original, candidate.color) }));
    const best = Math.min(...scored.map((s) => s.error));
    let pick = null;
    for (const entry of scored) {
      if (entry.error > best + MIN_IMPROVEMENT) continue;
      const length = entry.candidate.sequence.length;
      if (!pick || length < pick.candidate.sequence.length
          || (length === pick.candidate.sequence.length && entry.error < pick.error)) pick = entry;
    }
    const { candidate } = pick;
    const key = candidate.sequence.join();
    if (!recipes.has(key)) {
      recipes.set(key, { id: recipes.size + 1, sequence: [...candidate.sequence], counts: [...candidate.counts],
                         color: candidate.color, model: FDM_MODEL, weight: 0 });
    }
    const recipe = recipes.get(key);
    recipe.weight += weightOf(weights[source]);
    rows.push({ source, original, shade: candidate.color, sequence: [...candidate.sequence],
                counts: [...candidate.counts], error: Math.round(pick.error * 10) / 10,
                estimated: true, recipe: recipe.id });
  });
  return { rows, recipes: [...recipes.values()] };
}

/**
 * Rotate each recipe's sequence (rotation only) so fewer different reels are needed on any
 * one layer over a common period capped at 240 layers. The heaviest recipe is placed first
 * (weights by recipe id, else the recipe's own weight, ties by id); each later one takes the
 * rotation that adds the fewest reels, the earliest rotation winning a tie.
 */
export function alignPhases(recipes, weights = {}) {
  const live = recipes.filter((r) => r.sequence.length);
  const period = Math.min(PERIOD_CAP, live.reduce((p, r) => lcm(p, r.sequence.length), 1));
  const layers = new Array(period).fill(0); // bit r-1 is set when reel r is used on that layer
  const shifts = new Map();
  const weight = (r) => weightOf(weights[r.id], weightOf(r.weight));
  for (const recipe of [...live].sort((a, b) => weight(b) - weight(a) || a.id - b.id)) {
    const { sequence } = recipe;
    const bit = (layer, shift) => 1 << (sequence[(layer + shift) % sequence.length] - 1);
    let bestShift = 0;
    let bestCost = Infinity;
    for (let shift = 0; shift < sequence.length; shift += 1) {
      let cost = 0;
      for (let layer = 0; layer < period; layer += 1) cost += popcount(layers[layer] | bit(layer, shift));
      if (cost < bestCost) { bestCost = cost; bestShift = shift; }
    }
    for (let layer = 0; layer < period; layer += 1) layers[layer] |= bit(layer, bestShift);
    shifts.set(recipe, bestShift);
  }
  return recipes.map((recipe) => {
    const shift = shifts.get(recipe) || 0;
    const { sequence } = recipe;
    return { ...recipe, sequence: sequence.map((_, i) => sequence[(i + shift) % sequence.length]) };
  });
}
