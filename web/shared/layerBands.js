// Slicer layer arithmetic and triangle cutting.
//
// Paint is applied per layer, so a triangle that crosses layer boundaries is cut
// into strips that each sit inside one layer. Layer 0 is everything below the
// first layer; layer n >= 1 spans first + (n - 1) * height to first + n * height.
//
// Cuts are exact: every cut point is worked out once, from one edge of the
// original triangle and one boundary height, so strips that meet at a boundary,
// and neighbouring triangles that share an edge, hold bit-identical points. A
// closed mesh therefore stays closed after banding.
//
// Pure geometry: no dependency on the rest of the app.

// Tolerance in layers, so a point exactly on a boundary belongs to the layer above.
const EDGE = 1e-6;

function checkHeights(first, height) {
  if (!(Number.isFinite(height) && height > 0 && Number.isFinite(first) && first >= 0))
    throw new RangeError('Layer heights must be positive numbers.');
}

export function layerIndex(z, first, height) {
  const k = Math.floor((z - first) / height + EDGE);
  return k < 0 ? 0 : k + 1;
}

export function layerBounds(n, first, height) {
  return n < 1 ? [-Infinity, first] : [first + (n - 1) * height, first + n * height];
}

/** Height of boundary k (the top of layer k). Always by multiplication, so every caller gets the identical value. */
const plane = (k, first, height) => first + k * height;

/** The boundary heights strictly between zMin and zMax, ascending. */
export function layerPlanes(zMin, zMax, first, height) {
  checkHeights(first, height);
  let k = Math.max(0, Math.floor((zMin - first) / height));
  while (k > 0 && plane(k - 1, first, height) > zMin) k--;
  while (plane(k, first, height) <= zMin) k++;
  const planes = [];
  for (; plane(k, first, height) < zMax; k++) planes.push(plane(k, first, height));
  return planes;
}

/**
 * Where a height sits against the boundaries, as one number: 2k means on boundary k
 * (within EDGE), 2n - 1 means strictly inside layer n. Worked out from the height
 * alone, so every triangle that shares a vertex classifies it the same way.
 */
function position(z, first, height) {
  const s = (z - first) / height, k = Math.round(s);
  if (k >= 0 && Math.abs(s - k) <= EDGE) return 2 * k;
  return 2 * layerIndex(z, first, height) - 1;
}

const order = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Where the original edge p-q crosses height zc. Endpoints are ordered first, so a neighbouring triangle gets the identical point. */
function cut(p, q, zc, zOf) {
  const [a, b] = order(p, q) <= 0 ? [p, q] : [q, p];
  const za = zOf(a), t = (zc - za) / (zOf(b) - za);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

/** Cut one triangle into pieces that each lie within a single layer. Winding is kept. */
export function bandTriangle(points, zOf, first, height) {
  checkHeights(first, height);
  const pos = points.map(p => position(zOf(p), first, height));
  const lowPos = Math.min(...pos), highPos = Math.max(...pos);
  const low = Math.floor(lowPos / 2) + 1, high = Math.max(low, Math.ceil(highPos / 2));
  if (low === high) return [{ points: [...points], layer: low }];

  // Walk the triangle's outline, inserting each boundary crossing in travel order.
  // An edge is cut at boundary k only when one end is strictly below it and the other strictly above.
  const ring = [];
  for (let i = 0; i < 3; i++) {
    const p = points[i], q = points[(i + 1) % 3], pp = pos[i], pq = pos[(i + 1) % 3];
    ring.push({ point: p, pos: pp });
    const kLo = Math.floor(Math.min(pp, pq) / 2) + 1, kHi = Math.ceil(Math.max(pp, pq) / 2) - 1;
    const crossings = [];
    for (let k = kLo; k <= kHi; k++) crossings.push({ point: cut(p, q, plane(k, first, height), zOf), pos: 2 * k });
    ring.push(...(pq > pp ? crossings : crossings.reverse()));
  }

  // The strip for layer n is the outline points between its two boundaries, inclusive,
  // which form a convex polygon; fan it into triangles. Nothing with area is dropped.
  const result = [];
  for (let layer = low; layer <= high; layer++) {
    const poly = ring.filter(r => r.pos >= 2 * layer - 2 && r.pos <= 2 * layer).map(r => r.point);
    for (let i = 1; i < poly.length - 1; i++) result.push({ points: [poly[0], poly[i], poly[i + 1]], layer });
  }
  return result;
}
