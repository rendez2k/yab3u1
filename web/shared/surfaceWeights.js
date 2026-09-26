// Measure original, transformed triangles before any preview simplification.
// Includes all non-modifier surfaces; this is not camera visibility or a slice.
export function surfaceAreas(positions, states) {
  const areas = {};
  for (let f = 0; f < states.length; f++) {
    if (states[f] < 0) continue;
    const i = f * 9;
    const ux = positions[i+3]-positions[i], uy = positions[i+4]-positions[i+1], uz = positions[i+5]-positions[i+2];
    const vx = positions[i+6]-positions[i], vy = positions[i+7]-positions[i+1], vz = positions[i+8]-positions[i+2];
    const area = Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx)/2;
    if (Number.isFinite(area) && area > 0) {
      const id = states[f] || 1;
      areas[id] = (areas[id] || 0) + area;
    }
  }
  return areas;
}

export function colourWeights(sourceColors, areas) {
  const weights = {};
  for (const [id, color] of Object.entries(sourceColors)) {
    const area = areas?.[id];
    if (Number.isFinite(area) && area > 0) weights[color] = (weights[color] || 0) + area;
  }
  return weights;
}
