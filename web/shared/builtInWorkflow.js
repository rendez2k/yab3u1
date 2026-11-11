// Built-in colours (experimental) in the colour workflow: the plan the page shows and the
// options it sends to the worker, and the worker's own export step. Pure apart from the
// entries applyBuiltInColours rewrites. Every shade here is an estimate, never a measurement.
import {planBuiltIn, alignPhases} from './builtInRecipes.js';
import {applyBuiltInColours, builtInProblem, builtInLayerProblem, BUILT_IN_NOZZLE, BUILT_IN_NOZZLE_PROBLEM, BUILT_IN_DEPTH, BUILT_IN_LAYERS, BUILT_IN_FIRST_LAYER} from './builtInColours.js';
import {matchU1Profile} from './u1Profiles.js';
import {norm, toLab} from './colour.js';

export const BUILT_IN_DUAL_WALL = 'Dual-wall mixing is not available with built-in colours yet.';

/** Model reels only: a PETG support reel never carries a colour. 1-based slots. */
export const builtInModelSlots = reels => (reels || []).flatMap((reel, i) => (reel && reel.role !== 'support-interface' && norm(reel.color) ? [i + 1] : []));

/** The default interior and backing reel: the lightest model reel by CIE L* (the first on a tie). */
export function defaultBackingSlot(reels) {
  let best = 0;
  for (const slot of builtInModelSlots(reels)) if (!best || toLab(reels[slot - 1].color)[0] > toLab(reels[best - 1].color)[0]) best = slot;
  return best || null;
}

/** The fixed settings of the mode: the layer heights the pattern is cut for and the colour shell. */
export const builtInFixed = () => ({depth: BUILT_IN_DEPTH.standard, layerHeight: BUILT_IN_LAYERS.standard, firstLayer: BUILT_IN_FIRST_LAYER});

/**
 * The plan for these source colours ({source: hex}) on these reels. weights are by source
 * (they only steer the phase alignment, through each recipe's accumulated weight). The
 * mapping sends every source to the id of the recipe planned for it, never by sequence.
 */
export function builtInPlan(sourceColors, reels, weights = {}) {
  const plan = planBuiltIn(sourceColors, reels, weights);
  const recipes = alignPhases(plan.recipes);
  const byId = new Map(recipes.map(r => [r.id, r]));
  const rows = plan.rows.map(row => ({...row, sequence: [...byId.get(row.recipe).sequence], estimated: true}));
  const mapping = Object.fromEntries(rows.map(row => [row.source, row.recipe]));
  return {rows, recipes, mapping, shades: recipes.length};
}

/** The reason this export cannot be written, or ''. Built-in colours and dual-wall mixing are never both applied. */
export function builtInRefusal({target, reels, builtIn, dualWall}) {
  if (!builtIn) return '';
  if (dualWall) return BUILT_IN_DUAL_WALL;
  return builtInProblem({target, reels, backingSlot: builtIn.backingSlot, depth: builtIn.depth, layerHeight: builtIn.layerHeight});
}

/** exportProject's options for a built-in export: shade ids in place of slicer blends. */
export function builtInExportOptions(options) {
  const recipes = options.builtIn.recipes || [];
  return {...options, recipes: [], subdivideMixLayer: false, dualWall: null,
    builtIn: {shades: recipes.reduce((n, r) => Math.max(n, Number(r.id) || 0), 0)}};
}

/** Write the pattern into an exported project's entries; returns the record. */
export function applyBuiltInExport(entries, {target, reels, builtIn}) {
  return applyBuiltInColours(entries, {target, reels, recipes: builtIn.recipes, backingSlot: builtIn.backingSlot,
    depth: builtIn.depth, layerHeight: builtIn.layerHeight, firstLayer: builtIn.firstLayer});
}

/**
 * The nozzle refusal the export would give, known before exporting: the U1 nozzle is
 * resolved as the export resolves it (`auto` follows the source's own nozzle, else 0.4 mm).
 */
export function builtInNozzleProblem(sourceSettings, u1Nozzle = 'auto') {
  let match;
  try { match = matchU1Profile(sourceSettings || {}, u1Nozzle || 'auto', {blends: false}); } catch (error) { return error.message; }
  if (match.nozzle !== BUILT_IN_NOZZLE) return BUILT_IN_NOZZLE_PROBLEM;
  return builtInLayerProblem(match, BUILT_IN_LAYERS.standard, BUILT_IN_FIRST_LAYER);
}

/**
 * The mode and backing reel a saved session restores. A session saved before built-in
 * colours existed (or with a value this page does not know) restores as Slicer blends with
 * no backing reel, rather than keeping whatever mode is current.
 */
export function sessionBuiltInSettings(saved) {
  const construction = saved?.construction === 'built-in' ? 'built-in' : 'slicer';
  const backing = saved?.builtInBacking;
  return {construction, builtInBacking: Number.isInteger(backing) && backing > 0 ? backing : null};
}

/** The layer-height choice the page validates: none in built-in mode, which fixes its own heights. */
export const profileLayerChoice = (builtIn, choice) => (builtIn ? undefined : choice);
