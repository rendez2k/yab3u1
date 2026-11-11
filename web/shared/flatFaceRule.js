// The flat-face rule for built-in colours (moved from tools/flatFaceRule.mjs, where the
// spike tried it; web/shared/builtInColours.js uses it to choose each piece's reel).
//
// The slicer builds layer n from the cross-section at its mid height (the first layer's
// at half its own height). So a near-flat face is not part of the band it lies in but of
// the layer it tops or bottoms: an up-facing face at height z is the top of the highest
// layer whose slice is at or below z, and a down-facing face is the bottom of the lowest
// layer whose slice is above z. Layers are numbered as in web/shared/layerBands.js:
// layer 0 is the first layer (0 to `first`), layer n >= 1 ends at first + n * height.
//
// Pure functions, no dependencies.

/** Tolerance in layers for a face exactly at a slice height (as layerBands.js's EDGE). */
const EDGE = 1e-6;

/** A face whose normal is within this many degrees of vertical counts as flat. */
export const FLAT_FACE_DEGREES = 30;

/** Height at which the slicer cuts layer n. */
export function sliceMid(n, first, height) {
  return n < 1 ? first / 2 : first + (n - 0.5) * height;
}

/**
 * The layer a near-flat face at height z belongs to. A face below the first slice stays
 * in the first layer either way (there is no lower layer, and a face on the bed is the
 * bottom of the first layer).
 */
export function flatFaceLayer(z, up, first, height) {
  if (z < sliceMid(0, first, height)) return 0;
  // Highest n >= 1 with sliceMid(n) <= z, or 0. A face within EDGE of a slice counts as on
  // it (the tie: facing up it tops that layer, facing down it is the next layer's bottom),
  // the same tolerance in layers as layerBands.js uses at band boundaries.
  const k = Math.floor((z - first) / height + 0.5 + EDGE);
  return up ? Math.max(0, k) : Math.max(1, k + 1);
}

/** Whether a normal is within `degrees` of vertical, and whether it faces up. */
export function isNearFlat(normal, degrees) {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return {flat: false, up: false};
  const c = normal[2] / length;
  return {flat: Math.abs(c) >= Math.cos(degrees * Math.PI / 180), up: c > 0};
}

/**
 * The layer whose reel a banded piece takes. `normal` is the piece's normal in bed
 * orientation (after the placement transform, its sign corrected for a mirrored one);
 * zHigh and zLow are its highest and lowest bed heights; `layer` is the band it lies in.
 * A near-flat piece facing up belongs to the layer its highest point tops, one facing
 * down to the layer its lowest point bottoms, so a piece that reaches its own band's
 * slice keeps that band. Any other piece keeps its band.
 */
export function pieceLayer({normal, zHigh, zLow, layer}, first, height) {
  const {flat, up} = isNearFlat(normal, FLAT_FACE_DEGREES);
  if (!flat) return layer;
  return up ? flatFaceLayer(zHigh, true, first, height) : flatFaceLayer(zLow, false, first, height);
}
