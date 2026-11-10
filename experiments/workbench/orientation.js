// Rigid rotations only: preserve winding, paint, scale and relative part positions.
export function orientPinUp(parts, directions) {
  if (!directions.length) return parts;
  const mean = directions.reduce((s, n) => s.map((v, i) => v + n[i]), [0, 0, 0]);
  const length = Math.hypot(...mean);
  if (length < 1e-6) throw Error('These pins point in opposite directions. Turn off Orient pins upwards and choose the print orientation in your slicer.');
  const n = mean.map(v => v / length);
  if (directions.some(d => d.reduce((s, v, i) => s + v * n[i], 0) < .5)) throw Error('These pins cannot all face upwards together. Turn off Orient pins upwards and choose the orientation in your slicer.');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (const face of part.faces) for (const p of face.points) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const centre = lo.map((v, i) => (v + hi[i]) / 2);
  const c = Math.max(-1, Math.min(1, n[2])), s = Math.hypot(n[0], n[1]);
  const axis = s < 1e-8 ? [1, 0, 0] : [n[1] / s, -n[0] / s, 0];
  const rotate = p => {
    const q = p.map((v, i) => v - centre[i]);
    const cross = [axis[1]*q[2]-axis[2]*q[1], axis[2]*q[0]-axis[0]*q[2], axis[0]*q[1]-axis[1]*q[0]];
    const dot = q.reduce((v, x, i) => v + x * axis[i], 0);
    return q.map((v, i) => centre[i] + c*v + s*cross[i] + (1-c)*dot*axis[i]);
  };
  return parts.map(part => ({...part, faces: part.faces.map(face => ({...face, points: face.points.map(rotate)}))}));
}

const HIDDEN_PART = /modifier|negative/;
/** Outward flat areas the object could rest on, largest first. A candidate must
 * be a supporting plane: no vertex of the object lies beyond it. */
export function restingFaces(parts, {minShare = .02, limit = 12} = {}) {
  const solid = parts.filter(p => !HIDDEN_PART.test(p.subtype || ''));
  const bins = new Map(); let total = 0;
  for (const part of solid) for (const face of part.faces) {
    const [a, b, c] = face.points, u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
    const n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]], twice = Math.hypot(...n);
    if (twice < 1e-12) continue;
    const unit = n.map(v => v / twice), offset = unit.reduce((s, v, i) => s + v * a[i], 0), area = twice / 2;
    const key = unit.map(v => Math.round(v * 500) + 0).join(',') + '|' + (Math.round(offset * 50) + 0);
    const bin = bins.get(key) || {area: 0, normal: [0, 0, 0], offset: 0};
    bin.area += area; bin.offset += offset * area; bin.normal = bin.normal.map((v, i) => v + unit[i] * area); bins.set(key, bin); total += area;
  }
  const candidates = [...bins.values()].filter(b => b.area >= total * minShare).sort((a, b) => b.area - a.area).slice(0, limit);
  const resting = [];
  for (const bin of candidates) {
    const length = Math.hypot(...bin.normal), normal = bin.normal.map(v => v / length), offset = bin.offset / bin.area;
    let supporting = true;
    scan: for (const part of solid) for (const face of part.faces) for (const p of face.points)
      if (p[0]*normal[0] + p[1]*normal[1] + p[2]*normal[2] > offset + .05) { supporting = false; break scan; }
    if (supporting) resting.push({normal, area: bin.area, share: bin.area / total});
  }
  return resting;
}
/** Turn whole objects rigidly about their centre. Quarter turns are exact;
 * `flat` rests the object on its largest supporting flat area. */
export function turnParts(parts, {axis = 2, degrees = 90, flat = false, scale = null} = {}) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (const face of part.faces) for (const p of face.points) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const centre = lo.map((v, i) => (v + hi[i]) / 2);
  let m;
  if (scale != null) {
    // Uniform only: painting is stored per triangle, so it follows the surface unchanged.
    if (!Number.isFinite(scale) || scale < .1 || scale > 10) throw Error('Enter a size between 10% and 1000%.');
    if (Math.abs(scale - 1) < 1e-9) throw Error('The object is already at 100%. Enter a different size.');
    m = [[scale, 0, 0], [0, scale, 0], [0, 0, scale]];
  } else if (flat) {
    const [best] = restingFaces(parts);
    if (!best) throw Error('No flat area large enough to rest on was found. Turn the object in quarter turns instead.');
    const n = best.normal, s = Math.hypot(n[0], n[1]), c = -n[2];
    if (s < 1e-6 && c > 0) throw Error('This object already rests on its largest flat area.');
    // Rodrigues rotation taking the face normal to straight down.
    const k = s < 1e-6 ? [1, 0, 0] : [-n[1] / s, n[0] / s, 0], t = 1 - c;
    m = [[c + k[0]*k[0]*t, k[0]*k[1]*t - k[2]*s, k[0]*k[2]*t + k[1]*s],
         [k[1]*k[0]*t + k[2]*s, c + k[1]*k[1]*t, k[1]*k[2]*t - k[0]*s],
         [k[2]*k[0]*t - k[1]*s, k[2]*k[1]*t + k[0]*s, c + k[2]*k[2]*t]];
  } else {
    if (![0, 1, 2].includes(axis) || ![90, -90, 180].includes(degrees)) throw Error('Choose a quarter or half turn about X, Y or Z.');
    const c = degrees === 180 ? -1 : 0, s = degrees === 180 ? 0 : Math.sign(degrees), a = (axis + 1) % 3, b = (axis + 2) % 3;
    m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; m[axis][axis] = 1; m[a][a] = c; m[b][b] = c; m[a][b] = -s; m[b][a] = s;
  }
  const turn = p => { const q = p.map((v, i) => v - centre[i]); return m.map((row, i) => centre[i] + row[0]*q[0] + row[1]*q[1] + row[2]*q[2]); };
  return parts.map(part => ({...part, faces: part.faces.map(face => ({...face, points: face.points.map(turn)}))}));
}
