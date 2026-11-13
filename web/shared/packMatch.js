// How closely a filament pack can reach a model's colours, as one number for ranking packs.
//
// For every model colour the closest result the pack can give is found: one of its reels, or a
// blend of them. The misses are weighted by how much surface each colour covers. When a pack has
// more reels than the printer has inputs, the best set of reels that fits is scored and named.
// The score is an estimate from the same blend model as the preview, not a measurement.
import { distance, norm } from './colour.js';
import { candidateRecipes, blendStrength } from './mix.js';
import { mixFdmHex } from './fdmMix.js';

/** A miss of this size or more counts as no match at all. */
export const MATCH_ZERO_DISTANCE = 40;
const MAX_REELS = 24, MAX_SUBSETS = 20000;
export const matchShare = miss => Math.max(0, 1 - Math.min(miss, MATCH_ZERO_DISTANCE) / MATCH_ZERO_DISTANCE);

function subsets(n, k, visit) {
  const chosen = [];
  const walk = start => {
    if (chosen.length === k) { visit(chosen.reduce((m, i) => m | (1 << i), 0)); return; }
    for (let i = start; i <= n - (k - chosen.length); i += 1) { chosen.push(i); walk(i + 1); chosen.pop(); }
  };
  walk(0);
}
const choose = (n, k) => { let c = 1; for (let i = 1; i <= Math.min(k, n - k); i += 1) c = c * (n - i + 1) / i; return c; };

/**
 * @param sources [{color, weight}] the model's colours; weight is surface area (any unit).
 * @param reels   the pack's reels (support-interface reels are ignored).
 * @param inputs  how many reels the printer can hold for model colours.
 * @returns {percent, reels:[indices used], colours:[{color, miss}]} or null when nothing can be scored.
 */
export function packMatch(sources, reels, inputs) {
  const pack = (reels || []).filter(r => r?.role !== 'support-interface' && norm(r?.color)).slice(0, MAX_REELS);
  const wanted = (sources || []).map(s => ({ color: norm(s.color), weight: s.weight > 0 ? s.weight : 0 })).filter(s => s.color);
  if (!pack.length || !wanted.length || !(inputs >= 1)) return null;
  const total = wanted.reduce((sum, s) => sum + s.weight, 0);
  for (const s of wanted) s.weight = total > 0 ? s.weight / total : 1 / wanted.length;
  // Everything the whole pack could give, each with the reels it needs.
  const options = pack.map((r, i) => ({ color: norm(r.color), mask: 1 << i }));
  for (const r of candidateRecipes(pack, blendStrength().ratios, (a, b, percent, ia, ib, seen = percent) => mixFdmHex(a, b, seen)))
    options.push({ color: norm(r.color), mask: (1 << (r.a - 1)) | (1 << (r.b - 1)) | (r.c ? 1 << (r.c - 1) : 0) });
  // Per model colour: the options from nearest to farthest, so a set of reels finds its best quickly.
  const ranked = wanted.map(s => options.map(o => ({ mask: o.mask, miss: distance(s.color, o.color) })).sort((x, y) => x.miss - y.miss));
  const score = mask => {
    let share = 0; const misses = [];
    for (let i = 0; i < wanted.length; i += 1) {
      const best = ranked[i].find(o => (o.mask & mask) === o.mask);
      misses.push(best ? best.miss : Infinity); share += wanted[i].weight * matchShare(best ? best.miss : Infinity);
    }
    return { share, misses };
  };
  const n = pack.length, k = Math.min(n, Math.floor(inputs));
  let best = null, bestMask = 0;
  const consider = mask => { const s = score(mask); if (!best || s.share > best.share + 1e-9) { best = s; bestMask = mask; } };
  if (choose(n, k) <= MAX_SUBSETS) subsets(n, k, consider);
  else { // Too many sets to try them all: add the reel that helps most, one at a time.
    let mask = 0;
    for (let step = 0; step < k; step += 1) {
      let pick = -1, top = -1;
      for (let i = 0; i < n; i += 1) { if (mask & (1 << i)) continue; const s = score(mask | (1 << i)).share; if (s > top) { top = s; pick = i; } }
      mask |= 1 << pick;
    }
    consider(mask);
  }
  return { percent: Math.round(best.share * 100), reels: pack.map((_, i) => i).filter(i => bestMask & (1 << i)),
    colours: wanted.map((s, i) => ({ color: s.color, miss: best.misses[i] })) };
}
