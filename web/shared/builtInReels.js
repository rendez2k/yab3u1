// Which reels built-in colours (experimental) may use: the one definition shared by the
// planner (builtInRecipes.js), the page and worker (builtInWorkflow.js) and the export
// (builtInColours.js). A model reel is any reel not marked as the support reel that has a
// usable colour; the model reels must all be one material. Pure, no DOM.
import {norm} from './colour.js';

/** A reel's material as the exporter writes it: upper case, PLA when none is given. */
export const reelMaterial = reel => String((reel || {}).type || 'PLA').trim().toUpperCase();

/** The model reels, as 1-based slots in slot order: not the support reel, and a usable colour. */
export const builtInModelSlots = reels => (Array.isArray(reels) ? reels : [])
  .flatMap((reel, i) => (reel && reel.role !== 'support-interface' && norm(reel.color) ? [i + 1] : []));

/**
 * The refusal when the model reels are not all one material, or ''. The reel named is the
 * first whose material differs from the majority (the first-seen material wins a tie). A
 * different material is refused, never left out: a PLA shell over a PETG core is not built.
 */
export function builtInMaterialProblem(reels) {
  const slots = builtInModelSlots(reels), tally = new Map();
  for (const slot of slots) tally.set(reelMaterial(reels[slot - 1]), (tally.get(reelMaterial(reels[slot - 1])) || 0) + 1);
  let majority = null;
  for (const [material, n] of tally) if (majority === null || n > tally.get(majority)) majority = material;
  const odd = slots.find(slot => reelMaterial(reels[slot - 1]) !== majority);
  return odd ? `Built-in colours needs every model reel to be the same material. Remove or change the ${reelMaterial(reels[odd - 1])} reel in slot ${odd}.` : '';
}
