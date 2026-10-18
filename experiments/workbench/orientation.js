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
