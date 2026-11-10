// Slicer layer arithmetic and triangle cutting.
//
// Paint is applied per layer, so a triangle that crosses layer boundaries is cut
// into strips that each sit inside one layer. Layer 0 is everything below the
// first layer; layer n >= 1 spans first + (n - 1) * height to first + n * height.
//
// Pure geometry: no dependency on the rest of the app.

// Tolerance in layers, so a point exactly on a boundary belongs to the layer above.
const EDGE = 1e-6;
// Pieces flatter or thinner than this lie on a boundary plane and are dropped.
const FLAT = 1e-9, SLIVER = 1e-12;

export function layerIndex(z, first, height) {
  const k = Math.floor((z - first) / height + EDGE);
  return k < 0 ? 0 : k + 1;
}

export function layerBounds(n, first, height) {
  return n < 1 ? [-Infinity, first] : [first + (n - 1) * height, first + n * height];
}

const order = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Where the edge p-q crosses height zc. Endpoints are ordered first, so a neighbouring triangle gets the identical point. */
function cut(p, q, zc, zOf) {
  const [a, b] = order(p, q) <= 0 ? [p, q] : [q, p];
  const za = zOf(a), t = (zc - za) / (zOf(b) - za);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

/** Keep the part of a convex polygon on one side of height zc (points on the plane count as inside). */
function clip(poly, zc, below, zOf) {
  const inside = p => (below ? zOf(p) <= zc : zOf(p) >= zc), out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], next = poly[(i + 1) % poly.length], ci = inside(cur), ni = inside(next);
    if (ci) out.push(cur);
    if (ci !== ni) out.push(cut(cur, next, zc, zOf));
  }
  return out.filter((p, i) => !same(p, out[(i + out.length - 1) % out.length]));
}

function area2(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
}

/** Cut one triangle into pieces that each lie within a single layer. Winding is kept. */
export function bandTriangle(points, zOf, first, height) {
  const zs = points.map(zOf), low = layerIndex(Math.min(...zs), first, height), high = layerIndex(Math.max(...zs), first, height);
  if (low === high) return [{ points, layer: low }];
  const result = [];
  for (let layer = low; layer <= high; layer++) {
    let poly = points;
    if (layer > low) poly = clip(poly, first + (layer - 1) * height, false, zOf);
    if (layer < high) poly = clip(poly, first + layer * height, true, zOf);
    if (poly.length < 3) continue;
    const pz = poly.map(zOf);
    if (Math.max(...pz) - Math.min(...pz) < FLAT) continue;
    for (let i = 1; i < poly.length - 1; i++)
      if (area2(poly[0], poly[i], poly[i + 1]) > SLIVER) result.push({ points: [poly[0], poly[i], poly[i + 1]], layer });
  }
  return result;
}
