// Preview-only vertex clustering of the complete source surface.
// Vertices in each spatial cell share an averaged position. Collapsed triangles
// are removed; retained facets carry their source paint state. This is a visual
// approximation, not a topology-preserving repair or a change to exported meshes.

function weld(positions, cells) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis];
      if (value < lo[axis]) lo[axis] = value;
      if (value > hi[axis]) hi[axis] = value;
    }
  }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6);
  const size = span / cells;
  const ids = new Map();
  const sums = [];
  const counts = [];
  const vertexCell = new Int32Array(positions.length / 3);
  for (let v = 0; v < vertexCell.length; v += 1) {
    const at = v * 3;
    const x = Math.min(cells - 1, Math.max(0, Math.floor((positions[at] - lo[0]) / size)));
    const y = Math.min(cells - 1, Math.max(0, Math.floor((positions[at + 1] - lo[1]) / size)));
    const z = Math.min(cells - 1, Math.max(0, Math.floor((positions[at + 2] - lo[2]) / size)));
    const key = (x * cells + y) * cells + z;
    let found = ids.get(key);
    if (found === undefined) {
      found = sums.length / 3;
      ids.set(key, found);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    sums[found * 3] += positions[at];
    sums[found * 3 + 1] += positions[at + 1];
    sums[found * 3 + 2] += positions[at + 2];
    counts[found] += 1;
    vertexCell[v] = found;
  }
  const welded = new Float32Array(sums.length);
  for (let i = 0; i < counts.length; i += 1) {
    welded[i * 3] = sums[i * 3] / counts[i];
    welded[i * 3 + 1] = sums[i * 3 + 1] / counts[i];
    welded[i * 3 + 2] = sums[i * 3 + 2] / counts[i];
  }
  return { welded, vertexCell, cells, lo, hi };
}

// Rebuild non-degenerate facets on the clustered vertices.
function rebuild(positions, colors, states, facets, welded) {
  const tripleOf = new Int32Array(facets * 3);
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let f = 0; f < facets; f += 1) {
    const a = welded.vertexCell[f * 3];
    const b = welded.vertexCell[f * 3 + 1];
    const c = welded.vertexCell[f * 3 + 2];
    tripleOf[f * 3] = a;
    tripleOf[f * 3 + 1] = b;
    tripleOf[f * 3 + 2] = c;
  }
  const kept = new Map();                        // welded triple -> facet index
  let collapsed = 0;
  for (let f = 0; f < facets; f += 1) {
    const a = tripleOf[f * 3];
    const b = tripleOf[f * 3 + 1];
    const c = tripleOf[f * 3 + 2];
    if (a === b || b === c || a === c) { collapsed += 1; continue; }
    const triple = `${key(a, b)}|${c}`;
    if (!kept.has(triple)) kept.set(triple, f);
  }
  const outPositions = [];
  const outColors = [];
  const outStates = [];
  for (const f of kept.values()) {
    for (let corner = 0; corner < 3; corner += 1) {
      const cell = tripleOf[f * 3 + corner];
      outPositions.push(welded.welded[cell * 3], welded.welded[cell * 3 + 1],
                        welded.welded[cell * 3 + 2]);
    }
    for (let i = 0; i < 9; i += 1) outColors.push(colors[f * 9 + i]);
    if (states) outStates.push(states[f]);
  }
  return { positions: outPositions, colors: outColors, states: outStates,
           collapsed, weldedFacets: kept.size };
}

/** Naked edges of a triangle soup: edges used by exactly one facet.
 *
 * A closed surface has none.  Exported so a test can prove the reduced mesh is
 * still a sheet rather than a swarm of loose triangles.
 */
export function nakedEdges(positions) {
  const counts = new Map();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let f = 0; f + 8 < positions.length; f += 9) {
    const ids = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const at = f + corner * 3;
      ids.push(`${positions[at].toFixed(6)},${positions[at + 1].toFixed(6)},`
        + `${positions[at + 2].toFixed(6)}`);
    }
    for (const [p, q] of [[0, 1], [1, 2], [2, 0]]) {
      const edge = key(ids[p], ids[q]);
      counts.set(edge, (counts.get(edge) || 0) + 1);
    }
  }
  let naked = 0;
  for (const uses of counts.values()) if (uses === 1) naked += 1;
  return naked;
}

/** Cluster `positions`/`colors`/`states` down towards `target` facets.
 *
 * Returns `{positions, colors, states, simplified, cells, naked, dropped}`.
 */
export function cluster(positions, colors, states, target) {
  const facets = Math.floor(positions.length / 9);
  if (facets <= target) {
    return { positions, colors, states, simplified: false, cells: 1,
             dropped: 0 };
  }
  // One coarse probe tells us how fast the surface collapses (kept ≈ C·cells²), so
  // the resolution that lands on the target can be estimated instead of scanned:
  // four passes at most, which matters when the input is a million facets.
  const attempt = (cells) => {
    const welded = weld(positions, cells);
    const rebuilt = rebuild(positions, colors, states, facets, welded);
    return { kept: rebuilt.positions.length / 9, rebuilt, cells };
  };
  const probe = attempt(8);
  const estimate = Math.max(8, Math.min(512, Math.round(
    8 * Math.sqrt(target / Math.max(1, probe.kept)))));
  let best = probe;
  for (const cells of [estimate, Math.max(8, Math.round(estimate * 0.7)),
                       Math.min(512, Math.round(estimate * 1.4))]) {
    if (cells === best.cells && best !== probe) continue;
    const tried = attempt(cells);
    const better = (a, b) => {
      const aOk = a.kept >= target;
      const bOk = b.kept >= target;
      if (aOk !== bOk) return aOk ? a : b;
      return Math.abs(a.kept - target) < Math.abs(b.kept - target) ? a : b;
    };
    best = better(best, tried);
  }
  const { rebuilt } = best;
  return {
    positions: Float32Array.from(rebuilt.positions),
    colors: Float32Array.from(rebuilt.colors),
    states: states ? Int32Array.from(rebuilt.states) : null,
    simplified: true,
    cells: best.cells,
    dropped: rebuilt.collapsed,
  };
}

// A bounded level of detail for repeated previews. Keep a rebuilt surface;
// never create holes by taking every nth triangle from the existing surface.
export function clusterWithinBudget(positions, states, target) {
  if (positions.length / 9 <= target) return { positions, states };
  const colors = new Float32Array(positions.length);
  for (const cells of [128, 64, 32, 16, 8, 4, 2]) {
    const mesh = rebuild(positions, colors, states, positions.length / 9,
                         weld(positions, cells));
    const count = mesh.positions.length / 9;
    if (count > 0 && count <= target) {
      return { positions: Float32Array.from(mesh.positions),
               states: Int32Array.from(mesh.states) };
    }
  }
  throw new Error("There are too many copies to render a complete thumbnail. Reduce the copy count.");
}
