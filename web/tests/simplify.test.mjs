// The preview simplifier: bounded, surface-preserving, colour-preserving.
//
// Vertex clustering has to keep the model a *surface* -- the failure it replaces
// was striding over triangles, which left detached facets and a patchy picture.

import assert from "node:assert/strict";
import { cluster, nakedEdges } from "../shared/simplify.js";

let checks = 0;
function ok(name, fn) {
  try {
    fn();
    checks += 1;
    console.log("PASS", name);
  } catch (error) {
    console.log("FAIL", name, error.message);
    process.exitCode = 1;
  }
}

/** A closed, subdivided cube: `n` by `n` quads per face, six faces.
 *
 * It is a genuine closed surface (every edge shared by exactly two facets), which
 * is what makes the naked-edge check below meaningful.
 */
function cube(n = 8, size = 100) {
  const faces = [
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] },
    { origin: [0, 0, size], u: [0, 1, 0], v: [1, 0, 0] },
    { origin: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { origin: [size, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { origin: [0, size, 0], u: [0, 0, 1], v: [1, 0, 0] },
  ];
  const positions = [];
  const colors = [];
  const at = (face, i, j) => [
    face.origin[0] + face.u[0] * (i * size / n) + face.v[0] * (j * size / n),
    face.origin[1] + face.u[1] * (i * size / n) + face.v[1] * (j * size / n),
    face.origin[2] + face.u[2] * (i * size / n) + face.v[2] * (j * size / n),
  ];
  for (const face of faces) {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const quad = [at(face, i, j), at(face, i, j + 1),
                      at(face, i + 1, j + 1), at(face, i + 1, j)];
        for (const tri of [[0, 1, 2], [0, 2, 3]]) {
          for (const corner of tri) positions.push(...quad[corner]);
          for (let k = 0; k < 3; k += 1) colors.push(0.4, 0.6, 0.8);
        }
      }
    }
  }
  return { positions, colors };
}

/** A grid of quads spread over `size` millimetres, `n` by `n` tiles (open sheet). */
function grid(n, size = 100) {
  const positions = [];
  const colors = [];
  const step = size / n;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const x = i * step;
      const y = j * step;
      const quad = [[x, y, 0], [x + step, y, 0], [x + step, y + step, 0],
                    [x, y + step, 0]];
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        for (const corner of tri) positions.push(...quad[corner]);
        for (let k = 0; k < 3; k += 1) colors.push(i / n, j / n, 0.5);
      }
    }
  }
  return { positions, colors };
}

function boundsOf(values) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      lo[axis] = Math.min(lo[axis], values[i + axis]);
      hi[axis] = Math.max(hi[axis], values[i + axis]);
    }
  }
  return { lo, hi };
}

ok("a small mesh is returned exactly", () => {
  const { positions, colors } = grid(4);
  const out = cluster(positions, colors, null, 60000);
  assert.equal(out.simplified, false);
  assert.equal(out.positions, positions);
  assert.equal(out.colors, colors);
});

ok("a big mesh is bounded to the target", () => {
  const { positions, colors } = grid(64);              // 8192 facets
  const out = cluster(positions, colors, null, 512);
  const facets = out.positions.length / 9;
  assert.equal(out.simplified, true);
  assert.ok(facets > 0 && facets <= 1024, `got ${facets} facets`);
  assert.equal(out.colors.length, out.positions.length, "one colour per vertex");
});

ok("a closed mesh stays closed after clustering", () => {
  const { positions, colors } = cube(10);              // 1200 facets, closed
  assert.equal(nakedEdges(positions), 0, "the fixture starts closed");
  const out = cluster(positions, colors, null, 300);
  const kept = out.positions.length / 9;
  assert.ok(out.simplified, "it was simplified");
  assert.ok(kept < positions.length / 9, `fewer facets (${kept})`);
  assert.equal(nakedEdges(out.positions), 0,
               "every edge is still shared by two facets: no holes");
});

ok("the clustered surface still covers the model", () => {
  const { positions, colors } = cube(10, 100);
  const out = cluster(positions, colors, null, 300);
  const before = boundsOf(positions);
  const after = boundsOf(out.positions);
  const span = before.hi[0] - before.lo[0];
  // Clustering approximates the surface at the cell scale: the welded surface
  // stays inside the original box and still reaches both edges to within a cell.
  assert.ok(after.lo[0] >= before.lo[0] - 1e-6, "never outside the original box");
  assert.ok(after.lo[0] <= before.lo[0] + span * 0.2,
            `near the same edge (${after.lo[0]} vs ${before.lo[0]})`);
  assert.ok(after.hi[0] >= before.hi[0] - span * 0.2,
            `the far edge is still covered (${after.hi[0]} vs ${before.hi[0]})`);
  assert.ok(after.hi[1] >= before.hi[1] - span * 0.2, "and in Y as well");
});

ok("every kept facet keeps a colour from the source", () => {
  const { positions, colors } = grid(32);
  const out = cluster(positions, colors, null, 256);
  const known = new Set();
  for (let i = 0; i < colors.length; i += 3) {
    known.add(`${colors[i].toFixed(4)},${colors[i + 1].toFixed(4)},`
      + `${colors[i + 2].toFixed(4)}`);
  }
  for (let i = 0; i < out.colors.length; i += 3) {
    const key = `${out.colors[i].toFixed(4)},${out.colors[i + 1].toFixed(4)},`
      + `${out.colors[i + 2].toFixed(4)}`;
    assert.ok(known.has(key), `facet colour ${key} came from the source`);
  }
});

ok("the per-facet state list survives the same way", () => {
  const { positions, colors } = grid(32);
  const states = [];
  for (let f = 0; f < positions.length / 9; f += 1) states.push(f % 7);
  const out = cluster(positions, colors, states, 256);
  assert.equal(out.states.length, out.positions.length / 9);
  assert.ok(out.states.every((state) => state >= 0 && state < 7));
});

if (!process.exitCode) console.log(`simplify ok: ${checks} checks`);

const { clusterWithinBudget } = await import('../shared/simplify.js');
{
 const { positions } = cube(24);
 const states = new Int32Array(positions.length / 9).fill(1);
 const result = clusterWithinBudget(Float32Array.from(positions), states, 200);
 assert.ok(result.positions.length > 0 && result.positions.length / 9 <= 200);
 assert.equal(nakedEdges(result.positions), 0);
 assert.equal(result.states.length, result.positions.length / 9);
 console.log('PASS bounded repeated mesh remains a closed surface');
}
