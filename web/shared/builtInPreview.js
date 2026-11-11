// Honest preview for built-in colours. Steep faces look blended, because the printed layers
// alternate reels; flat and gently sloped faces cannot blend layer by layer and show one
// reel per layer, as bands. These pure functions give the preview each face's colour and a
// warning for how much of the model is affected. Every colour here is an estimate.
import {layerIndex} from './layerBands.js';
import {FLAT_FACE_DEGREES, isNearFlat, pieceLayer} from './flatFaceRule.js';

/** The same cut-off the export uses, so the preview shows what will print. */
export const SHALLOW_DEGREES = FLAT_FACE_DEGREES;

/** Below this share of the model's area no warning is shown. */
const WARNING_THRESHOLD = 0.02;

/** True when the face is within SHALLOW_DEGREES of horizontal (agrees with the export rule). */
export function isShallow(normal) {
  return isNearFlat(normal, FLAT_FACE_DEGREES).flat;
}

/**
 * The colour to preview for one face: the recipe's estimated blend for a steep face, or the
 * single reel the export gives the face's layer for a shallow one. `zHigh` and `zLow`
 * (the face's highest and lowest bed heights) default to `zMid`. `reels` are in slot order.
 */
export function builtInFaceColour({normal, zMid, zHigh = zMid, zLow = zMid, recipe, reels, firstLayer, layerHeight}) {
  if (!isShallow(normal)) return recipe.color;
  const band = layerIndex(zMid, firstLayer, layerHeight);
  const layer = pieceLayer({normal, zHigh, zLow, layer: band}, firstLayer, layerHeight);
  const reel = recipe.sequence[layer % recipe.sequence.length];
  return reels[reel - 1].color;
}

/** Area fraction (0 to 1) of the faces that are shallow. */
export function shallowShare(faces) {
  let total = 0, shallow = 0;
  for (const {normal, area} of faces) {
    total += area;
    if (isShallow(normal)) shallow += area;
  }
  return total > 0 ? shallow / total : 0;
}

/** The warning for the preview, or '' when the share is negligible. */
export function shallowWarning(share) {
  if (!(share >= WARNING_THRESHOLD)) return '';
  return `About ${Math.round(share * 100)}% of this model is flat or gently sloped. Those areas will print as single-reel bands, not blended shades.`;
}
