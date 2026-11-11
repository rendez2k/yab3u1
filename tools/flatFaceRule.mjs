// Flat-face rule for the built-in colours spike (Task 12 follow-up). Experimental; not
// wired into the app, and web/shared/paintBands.js is unchanged.
//
// The slicer builds layer n from the cross-section at its mid height (the first layer's
// at half its own height). So a near-flat face is not part of the band it lies in but of
// the layer it tops or bottoms: an up-facing face at height z is the top of the highest
// layer whose slice is at or below z, and a down-facing face is the bottom of the lowest
// layer whose slice is above z. Layers are numbered as in web/shared/layerBands.js:
// layer 0 is the first layer (0 to `first`), layer n >= 1 ends at first + n * height.

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
  const k = Math.floor((z - first) / height + 0.5);       // highest n >= 1 with sliceMid(n) <= z, or 0
  return up ? Math.max(0, k) : Math.max(1, k + 1);
}

/** Whether a normal is within `degrees` of vertical, and whether it faces up. */
export function isNearFlat(normal, degrees) {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return {flat: false, up: false};
  const c = normal[2] / length;
  return {flat: Math.abs(c) >= Math.cos(degrees * Math.PI / 180), up: c > 0};
}
