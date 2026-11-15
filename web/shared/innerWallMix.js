// Inner-wall mixing for Snapmaker Orca (experimental).
//
// A layer blend changes reel from one layer to the next, and that is what shows as
// stripes on a wall and rings on a shallow slope. Here each blend is written as two
// layer cycles: one for the outer wall and one for the walls behind it. The outer wall
// keeps to one reel wherever the blend allows, and the other reels go into the inner
// walls, where they are seen through the outer one. The surface then stays one reel
// from layer to layer while the colour is made in the depth of the wall.
//
// How much of the colour the outer wall carries is an estimate from the reel's
// transmission distance, not a measurement. This rewrites an exported project: the
// blend table and a few print settings change; geometry and paint are untouched.
import { recipeParts } from './blendRecipes.js';

export const INNER_WALL_PATH = 'Metadata/YAB3D_inner_wall_mix.json';
export const INNER_WALL_TARGETS = ['snapmaker'];
export const INNER_WALL = { layers: 40, layerHeight: 0.10, walls: 5, lineWidth: 0.3 };
const PROJECT = 'Metadata/project_settings.config', SETTINGS = 'Metadata/model_settings.config';
const enc = new TextEncoder(), dec = new TextDecoder();

/** The part of the colour seen that comes from an outer wall of this reel. An estimate. */
export function outerWeight(td, width = INNER_WALL.lineWidth) {
  const n = Number(td);
  if (!(n > 0)) return 0.5;
  // Light crosses the wall twice, in and out.
  return Math.min(0.85, Math.max(0.35, 1 - Math.exp(-6 * width / n)));
}

/** Whole layers out of `total` for each share, by largest remainder. */
function counts(shares, total) {
  const sum = shares.reduce((a, b) => a + b, 0) || 1, exact = shares.map(s => s / sum * total), out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  for (const i of exact.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0]).map(x => x[1])) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}
/** A cycle with each reel's layers spread as evenly as whole layers allow. */
export function spread(slots, shares, total = INNER_WALL.layers) {
  const want = counts(shares, total), placed = want.map(() => 0), out = [];
  for (let layer = 0; layer < total; layer += 1) {
    let pick = -1, most = -Infinity;
    for (let i = 0; i < slots.length; i += 1) {
      if (placed[i] >= want[i]) continue;
      const behind = want[i] * (layer + 1) / total - placed[i];
      if (behind > most + 1e-9 || (Math.abs(behind - most) <= 1e-9 && want[i] > want[pick])) { most = behind; pick = i; }
    }
    placed[pick] += 1; out.push(slots[pick]);
  }
  return out;
}

/**
 * The outer and inner cycles for one blend. `tds` is each physical slot's transmission
 * distance (index = slot - 1); a missing value means the outer wall is taken to carry half.
 */
export function wallWords(recipe, tds = []) {
  const parts = recipeParts(recipe).filter(p => p.percent > 0), slots = parts.map(p => p.slot), s = parts.map(p => p.percent / 100);
  if (slots.some(slot => !Number.isInteger(slot) || slot < 1 || slot > 9)) throw Error('Inner-wall mixing can only use slots 1 to 9.');
  // The outer reel: the one that can hold the outer wall most steadily; among equals, the more translucent.
  let lead = 0, best = -1;
  parts.forEach((_, i) => {
    const w = outerWeight(tds[slots[i] - 1]), purity = Math.min(1, s[i] / w), score = purity * 1000 + (Number(tds[slots[i] - 1]) || 0);
    if (score > best) { best = score; lead = i; }
  });
  const weight = outerWeight(tds[slots[lead] - 1]);
  const outerShares = s.map(() => 0); outerShares[lead] = Math.min(1, s[lead] / weight);
  const others = s.reduce((sum, v, i) => i === lead ? sum : sum + v, 0);
  if (outerShares[lead] < 1 && others > 0) s.forEach((v, i) => { if (i !== lead) outerShares[i] = (1 - outerShares[lead]) * v / others; });
  // What the inner walls must add so that outer and inner together give the blend.
  let innerShares = s.map((v, i) => Math.max(0, v - weight * outerShares[i]) / (1 - weight));
  if (!(innerShares.reduce((a, b) => a + b, 0) > 1e-9)) innerShares = outerShares.slice();
  const outer = spread(slots, outerShares);
  let inner = spread(slots, innerShares);
  // Where the outer wall does change reel, turn the inner cycle so it differs as often as it can.
  if (new Set(outer).size > 1) {
    let most = -1, turned = inner;
    for (let shift = 0; shift < inner.length; shift += 1) {
      const candidate = inner.map((_, i) => inner[(i + shift) % inner.length]), differs = candidate.filter((slot, i) => slot !== outer[i]).length;
      if (differs > most) { most = differs; turned = candidate; }
    }
    inner = turned;
  }
  return { outer, inner, slots, outerSlot: slots[lead], outerWeight: weight, steadyOuter: new Set(outer).size === 1 };
}

/** One blend as a Snapmaker layer-cycle row with an outer and an inner cycle. */
export function innerWallRow(recipe, stableId, tds = []) {
  const words = wallWords(recipe, tds), slots = words.slots.slice().sort((a, b) => a - b), n = words.outer.length + words.inner.length;
  const share = slot => Math.round(100 * (words.outer.filter(v => v === slot).length + words.inner.filter(v => v === slot).length) / n);
  return { row: `1,2,1,1,${share(2)},0,g${slots.join('')},w${slots.map(share).join('/')},m0,z0,xa0,xb0,d0,o0,u${stableId},cm1,${words.outer.join('')},${words.inner.join('')}`, words };
}

/** Rewrite exported entries in place. `reels` are the physical reels, with `td` where known. */
export function applyInnerWallMix(entries, { target, recipes = [], reels = [] }) {
  if (!INNER_WALL_TARGETS.includes(target)) throw Error('Inner-wall mixing exports to Snapmaker Orca.');
  if (!entries.has(PROJECT)) throw Error('Inner-wall mixing needs a native slicer project.');
  const cfg = JSON.parse(dec.decode(entries.get(PROJECT)));
  const rows = String(cfg.mixed_filament_definitions || '').split(';').filter(Boolean);
  if (!rows.length || !recipes.some(r => !r.gradient)) throw Error('Inner-wall mixing needs at least one blended colour.');
  const tds = reels.map(r => Number(r?.td) || 0), report = [];
  recipes.forEach((recipe, index) => {
    if (recipe.gradient || index >= rows.length) return;
    const id = /,u(\d+)/.exec(rows[index])?.[1];
    if (!id) return;
    const { row, words } = innerWallRow(recipe, id, tds);
    rows[index] = row;
    report.push({ blend: index + 1, outerSlot: words.outerSlot, steadyOuter: words.steadyOuter, outerWeight: Math.round(words.outerWeight * 100) / 100, outer: words.outer.join(''), inner: words.inner.join('') });
  });
  const walls = Math.max(INNER_WALL.walls, Number(cfg.wall_loops) || 0);
  Object.assign(cfg, {
    mixed_filament_definitions: rows.join(';'),
    wall_loops: String(walls), outer_wall_line_width: String(INNER_WALL.lineWidth), inner_wall_line_width: String(INNER_WALL.lineWidth),
    // Inner walls first, so the outer wall is laid against them.
    wall_sequence: 'inner wall/outer wall',
    // Whole layers only: the cycles name a reel for each layer.
    enable_mixed_color_sublayer: '0',
  });
  delete cfg.dithering_local_z_mode;
  entries.set(PROJECT, enc.encode(JSON.stringify(cfg, null, 4)));
  let raised = 0;
  if (entries.has(SETTINGS)) {
    const text = dec.decode(entries.get(SETTINGS)).replace(/(<metadata(?: type="[^"]*")? key="wall_loops" value=")([^"]*)(")/g,
      (all, a, value, c) => (Number(value) >= walls ? all : (raised += 1, `${a}${walls}${c}`)));
    entries.set(SETTINGS, enc.encode(text));
  }
  const result = { blends: report.length, steadyOuter: report.filter(r => r.steadyOuter).length, walls, lineWidth: INNER_WALL.lineWidth, objectsRaised: raised, tdKnown: tds.filter(v => v > 0).length };
  entries.set(INNER_WALL_PATH, enc.encode(JSON.stringify({ schema: 1, feature: 'inner-wall-mix', target, ...result, cycles: report,
    note: 'Outer-wall weight is an estimate from transmission distance, not a measurement.', validation: { sliced: false, printed: false } }, null, 2)));
  return result;
}
