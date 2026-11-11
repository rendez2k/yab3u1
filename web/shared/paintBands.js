// Banding a whole painted mesh: every painted face is cut into the leaves of its
// paint tree and every leaf into strips that each lie inside one slicer layer,
// without opening any gap between neighbouring pieces.
//
// The pieces are joined by vertex index, not by matching coordinates. Every point
// that is made on a straight line -- an input edge, or a line a paint split
// created -- is registered against that line and made once:
//   - a split midpoint is keyed by its line and its dyadic position along it, and
//     is the midpoint of the two registered points at the ends of its span (the
//     same arithmetic as the slicer's split geometry in standard.js);
//   - a layer-plane crossing is keyed by its line and plane, and is computed from
//     the line's own two end points, in index order.
// Every leaf then walks each of its sides through all the points registered on
// that line within its span, so a whole face beside a split neighbour, faces split
// to different depths, and uneven depth inside one face all meet point for point.
// All midpoints are registered in a first pass, before any crossing is made, so a
// line's crossings know every point that already sits on a layer plane.
//
// Pure geometry: no dependency beyond layerBands.js.
import {layerPosition, layerPlane} from './layerBands.js';

// Lines are keyed by their two end indices, lower first: lo * LINE + hi, exact in a double.
const LINE = 2 ** 26;
// Labels for the lines a strip polygon's points lie on: the leaf's three sides, then
// the strip's lower and upper layer planes. Three points sharing a label are collinear.
const SIDE = [1, 2, 4], LOWER = 8, UPPER = 16, LABELS = 5;

const lineKey = (a, b) => (a < b ? a * LINE + b : b * LINE + a);
/** The edge from vertex a to vertex b as a span of its line, t = 0 at the lower index. */
const edgeOf = (a, b) => (a < b ? {line: lineKey(a, b), ta: 0, tb: 1} : {line: lineKey(a, b), ta: 1, tb: 0});
const halves = e => {
  const tm = (e.ta + e.tb) / 2;
  return [{line: e.line, ta: e.ta, tb: tm}, {line: e.line, ta: tm, tb: e.tb}];
};
/** Boundaries strictly between two positions (see layerPosition), ascending. */
const between = (pa, pb) => [Math.floor(Math.min(pa, pb) / 2) + 1, Math.ceil(Math.max(pa, pb) / 2) - 1];

/**
 * Cut a painted mesh into pieces that each lie in one slicer layer and one paint leaf.
 *
 * @param {number[][]} vertices [x, y, z] in model coordinates
 * @param {{v: number[], paint: object}[]} faces indexed triangles with a decoded paint tree (paint.decode)
 * @param {{zOf: function, first: number, height: number}} options zOf gives a point's height above the bed
 * @returns {{vertices: number[][], pieces: {v: number[], face: number, state: number, layer: number}[]}}
 *   the input vertices, unchanged and in order, then the new ones; pieces in input face order
 */
export function bandMesh(vertices, faces, {zOf, first, height}) {
  if (!(Number.isFinite(height) && height > 0 && Number.isFinite(first) && first >= 0))
    throw new RangeError('Layer heights must be positive numbers.');
  const out = vertices.slice(), zs = [], ps = [];
  const classify = p => {
    const z = zOf(p);
    if (!Number.isFinite(z)) throw new RangeError('Vertex heights must be finite numbers.');
    zs.push(z);
    ps.push(layerPosition(z, first, height));
  };
  for (const p of vertices) classify(p);
  const append = p => {
    if (out.length >= LINE) throw new RangeError('The mesh has too many vertices to band.');
    classify(p);
    return out.push(p) - 1;
  };

  // ---- midpoints, registered against their line in the first pass ----
  const midpoints = new Map();   // `${line}/${t}` -> vertex
  const onLine = new Map();      // line -> [{t, v}] midpoints on it, sorted by t
  let sealed = false;
  const midpoint = (e, x, y) => {
    const t = (e.ta + e.tb) / 2, key = e.line + '/' + t;
    let v = midpoints.get(key);
    if (v === undefined) {
      if (sealed) throw new Error('A paint split asked for a midpoint the first pass did not make.');
      const p = out[x], q = out[y];
      v = append([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
      midpoints.set(key, v);
      if (!onLine.has(e.line)) onLine.set(e.line, []);
      onLine.get(e.line).push({t, v});
    }
    return v;
  };

  /**
   * Visit every leaf of a paint tree as corners c and sides e (e[i] runs from c[i]
   * to c[i + 1]). Child order and corners are those of standard.splitChildren.
   */
  const walk = (c, e, node, leaf) => {
    if (node.kind === 'leaf') return leaf(c, e, node.state);
    if (node.kind !== 'split') throw new Error(`Unknown paint node ${node.kind}.`);
    const sides = Number(node.sides), kids = node.children;
    if (![1, 2, 3].includes(sides)) throw new Error(`A paint split has ${node.sides} sides, which is not 1..3.`);
    if (kids.length !== sides + 1) throw new Error('A paint split and its child list disagree.');
    const s = sides === 3 ? 0 : Number(node.specialSide) % 3;
    const v0 = c[s], v1 = c[(s + 1) % 3], v2 = c[(s + 2) % 3];
    const e01 = e[s], e12 = e[(s + 1) % 3], e20 = e[(s + 2) % 3];
    if (sides === 1) {
      // The side opposite v0 is cut: (v0, v1, m) and (m, v2, v0).
      const m = midpoint(e12, v1, v2), [m1, m2] = halves(e12);
      walk([v0, v1, m], [e01, m1, edgeOf(m, v0)], kids[0], leaf);
      walk([m, v2, v0], [m2, e20, edgeOf(v0, m)], kids[1], leaf);
    } else if (sides === 2) {
      // The two sides meeting at v0 are cut: (v0, a, b), (a, v1, b), (v1, v2, b).
      const a = midpoint(e01, v0, v1), b = midpoint(e20, v2, v0);
      const [a1, a2] = halves(e01), [b1, b2] = halves(e20);
      walk([v0, a, b], [a1, edgeOf(a, b), b2], kids[0], leaf);
      walk([a, v1, b], [a2, edgeOf(v1, b), edgeOf(b, a)], kids[1], leaf);
      walk([v1, v2, b], [e12, b1, edgeOf(b, v1)], kids[2], leaf);
    } else {
      // All three sides: the four-way midpoint subdivision.
      const m01 = midpoint(e01, v0, v1), m12 = midpoint(e12, v1, v2), m20 = midpoint(e20, v2, v0);
      const [a1, a2] = halves(e01), [b1, b2] = halves(e12), [c1, c2] = halves(e20);
      walk([v0, m01, m20], [a1, edgeOf(m01, m20), c2], kids[0], leaf);
      walk([m01, v1, m12], [a2, b1, edgeOf(m12, m01)], kids[1], leaf);
      walk([m12, v2, m20], [b2, c1, edgeOf(m20, m12)], kids[2], leaf);
      walk([m01, m12, m20], [edgeOf(m01, m12), edgeOf(m12, m20), edgeOf(m20, m01)], kids[3], leaf);
    }
  };
  const rootOf = (face, f) => {
    const c = face.v;
    if (!Array.isArray(c) || c.length !== 3 || !c.every(i => Number.isInteger(i) && i >= 0 && i < vertices.length))
      throw new RangeError(`Face ${f} does not name three of the mesh's vertices.`);
    return [c, [edgeOf(c[0], c[1]), edgeOf(c[1], c[2]), edgeOf(c[2], c[0])]];
  };
  const none = () => {};
  faces.forEach((face, f) => {
    const [c, e] = rootOf(face, f);
    if (face.paint.kind !== 'leaf') walk(c, e, face.paint, none);
  });
  for (const list of onLine.values()) list.sort((a, b) => a.t - b.t);
  sealed = true;

  // ---- layer-plane crossings, made the first time any leaf needs one ----
  const crossings = new Map();   // line -> index of its first crossing (no midpoints), or Map plane -> vertex
  const cross = (a, b, k) => {
    const za = zs[a], t = (layerPlane(k, first, height) - za) / (zs[b] - za), p = out[a], q = out[b];
    return append([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])]);
  };
  const crossing = (line, k) => {
    const a = Math.floor(line / LINE), b = line - a * LINE;
    let made = crossings.get(line);
    if (made === undefined) {
      const list = onLine.get(line);
      if (!list) {
        // A plain line: one crossing for each boundary between its ends, consecutive indices.
        made = out.length;
        const [lo, hi] = between(ps[a], ps[b]);
        for (let j = lo; j <= hi; j++) cross(a, b, j);
      } else {
        // Midpoints on the line: a boundary is crossed only between two of its points that straddle it.
        made = new Map();
        const seq = [a, ...list.map(m => m.v), b];
        for (let i = 0; i + 1 < seq.length; i++) {
          const [lo, hi] = between(ps[seq[i]], ps[seq[i + 1]]);
          for (let j = lo; j <= hi; j++) if (!made.has(j)) made.set(j, cross(a, b, j));
        }
      }
      crossings.set(line, made);
    }
    return typeof made === 'number' ? made + k - between(ps[a], ps[b])[0] : made.get(k);
  };

  // ---- each leaf: its outline through every registered point, then its strips ----
  const pieces = [];
  const ringV = [], ringL = [];
  const leafPieces = (f, c, e, state) => {
    ringV.length = 0; ringL.length = 0;
    for (let i = 0; i < 3; i++) {
      const {line, ta, tb} = e[i], side = SIDE[i];
      ringV.push(c[i]); ringL.push(side | SIDE[(i + 2) % 3]);
      let prev = c[i];
      const reach = v => {
        const pa = ps[prev], pb = ps[v], [lo, hi] = between(pa, pb);
        if (pb > pa) for (let k = lo; k <= hi; k++) { ringV.push(crossing(line, k)); ringL.push(side); }
        else for (let k = hi; k >= lo; k--) { ringV.push(crossing(line, k)); ringL.push(side); }
        prev = v;
      };
      const list = onLine.get(line);
      if (list) {
        const inside = list.filter(m => m.t > Math.min(ta, tb) && m.t < Math.max(ta, tb));
        if (ta > tb) inside.reverse();
        for (const m of inside) { reach(m.v); ringV.push(m.v); ringL.push(side); }
      }
      reach(c[(i + 1) % 3]);
    }
    const n = ringV.length, pos = ringV.map(v => ps[v]);
    const low = Math.floor(Math.min(...pos) / 2) + 1, high = Math.max(low, Math.ceil(Math.max(...pos) / 2));
    for (let layer = low; layer <= high; layer++) {
      const lo = 2 * layer - 2, hi = 2 * layer, vs = [], ls = [];
      for (let j = 0; j < n; j++) {
        const p = pos[j];
        if (p < lo || p > hi) continue;
        // A run of points on the lower plane is the lower strip's edge: here only its
        // ends next to this strip's own points are kept, so each edge is used once.
        if (p === lo && layer > low && !(pos[(j + n - 1) % n] > lo || pos[(j + 1) % n] > lo)) continue;
        vs.push(ringV[j]);
        ls.push(ringL[j] | (p === lo ? LOWER : 0) | (p === hi ? UPPER : 0));
      }
      triangulate(vs, ls, (a, b, d) => pieces.push({v: [a, b, d], face: f, state, layer}));
    }
  };
  faces.forEach((face, f) => {
    const [c, e] = rootOf(face, f);
    walk(c, e, face.paint, (lc, le, state) => leafPieces(f, lc, le, state));
  });
  return {vertices: out, pieces};
}

/**
 * Triangulate a convex polygon whose sides may hold extra collinear points, using
 * every point and never three that share a line label (so no piece is a sliver
 * along one line). Ears are cut in ring order, which keeps the winding.
 */
function triangulate(vs, ls, emit) {
  const m = vs.length;
  if (m < 3) return;
  if (m === 3) { emit(vs[0], vs[1], vs[2]); return; }
  const prev = new Int32Array(m), next = new Int32Array(m), gone = new Uint8Array(m), count = new Int32Array(LABELS);
  for (let i = 0; i < m; i++) {
    prev[i] = (i + m - 1) % m; next[i] = (i + 1) % m;
    for (let b = 0; b < LABELS; b++) if (ls[i] & (1 << b)) count[b]++;
  }
  const stack = [];
  for (let i = m - 1; i >= 0; i--) stack.push(i);
  let left = m;
  while (left > 3 && stack.length) {
    const i = stack.pop();
    if (gone[i]) continue;
    const p = prev[i], q = next[i];
    if (ls[p] & ls[i] & ls[q]) continue;
    // Cutting this ear must not leave the rest on one line.
    let flat = false;
    for (let b = 0; b < LABELS && !flat; b++) flat = count[b] - ((ls[i] >> b) & 1) === left - 1;
    if (flat) continue;
    emit(vs[p], vs[i], vs[q]);
    gone[i] = 1; next[p] = q; prev[q] = p; left--;
    for (let b = 0; b < LABELS; b++) if (ls[i] & (1 << b)) count[b]--;
    stack.push(q, p);
  }
  // Normally three points are left. More only when the polygon has no area at all
  // (a degenerate input face): fan the rest so that every edge is still used.
  let a = 0;
  while (gone[a]) a++;
  for (let b = next[a]; next[b] !== a; b = next[b]) emit(vs[a], vs[b], vs[next[b]]);
}
