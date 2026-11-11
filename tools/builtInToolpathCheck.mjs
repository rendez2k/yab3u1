// Model-aware toolpath check for built-in colours (spike, Task 12). Not wired into the app.
//
// The sliced G-code is compared with the exported model's own paint: each checked
// layer of the model is cut at mid-layer height, giving the outline the slicer works
// from, with the reel each triangle is painted. Every "Outer wall" extrusion of that
// layer is sampled along its length; a sample close to the outline is on the visible
// surface and is judged against the reel of the outline next to it, and a sample far
// from it is counted but not judged. On the spike's test solid the far ones are the
// inner reel's own walls, which Orca also types "Outer wall" (about 0.66 mm in), and the
// inner edge of the 0.45 mm colour shell is a second loop about 0.24 mm in, in the colour
// reel, and is judged. On other files the far walls can be other things (a deeper colour
// region's inner edge, boundaries of overlapping parts); checkLayer reports them by tool
// and distance so they can be looked at. All lengths are in millimetres, in bed coordinates.
//
// A toolpath check only shows where the slicer puts each reel. It says nothing about
// the colour of a printed part.
import {matrixFromText, matmul} from '../web/shared/project.js';

const dec = new TextDecoder();
const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
const COMPONENT_RE = /<component\b([^>]*?)\/>/g;
const ITEM_RE = /<item\b([^>]*?)\/>/g;
const attr = (text, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(text)?.[1];

// ------------------------------------------------------------ placements ----

/**
 * Every mesh (member, id) -> world matrix of the build item that places it, the item's
 * number (from 1) and the build item's own object id. Moved here from
 * tools/built-in-colours-spike.mjs, which imports it.
 */
export function placements(entries) {
  const main = dec.decode(entries.get('3D/3dmodel.model'));
  const objects = new Map();
  for (const m of main.matchAll(OBJECT_RE)) {
    const id = attr(m[1], 'id'), comps = [];
    for (const c of m[2].matchAll(COMPONENT_RE))
      comps.push({member: (attr(c[1], 'p:path') || '/3D/3dmodel.model').replace(/^\//, ''), id: attr(c[1], 'objectid'), transform: attr(c[1], 'transform')});
    objects.set(id, {comps, mesh: m[2].includes('<mesh')});
  }
  const out = new Map();
  let item = 0;
  for (const it of main.matchAll(ITEM_RE)) {
    const object = attr(it[1], 'objectid'), obj = objects.get(object), itemM = matrixFromText(attr(it[1], 'transform'));
    item += 1;
    const list = obj.mesh ? [{member: '3D/3dmodel.model', id: object, m: itemM}]
      : obj.comps.map(c => ({member: c.member, id: c.id, m: c.transform ? matmul(matrixFromText(c.transform), itemM) : itemM}));
    for (const p of list) {
      const key = `${p.member}#${p.id}`;
      if (out.has(key)) {
        const o = out.get(key).m;
        if (o.some((row, i) => row.some((x, j) => Math.abs(x - p.m[i][j]) > 1e-9))) throw Error(`${key} is placed twice with different transforms; the spike cannot band it.`);
      }
      out.set(key, {m: p.m, item, object});
    }
  }
  return out;
}

// --------------------------------------------------------- cross-section ----

/**
 * The mesh cut by the plane at height z, as segments carrying their triangle's reel
 * (and its `part` and `negative`, when the triangle has them). `mesh.vertices` is an
 * array of [x, y, z] or a flat typed array x0 y0 z0 x1 ...; a triangle gives a segment
 * only when z lies strictly between its lowest and highest corner, so a triangle that
 * only touches the plane gives nothing.
 */
export function crossSection(mesh, z) {
  const V = mesh.vertices, flat = ArrayBuffer.isView(V);
  const at = flat ? (i, k) => V[3 * i + k] : (i, k) => V[i][k];
  const out = [];
  for (const t of mesh.triangles) {
    const [i0, i1, i2] = t.v;
    const z0 = at(i0, 2), z1 = at(i1, 2), z2 = at(i2, 2);
    if (!(Math.min(z0, z1, z2) < z && Math.max(z0, z1, z2) > z)) continue;
    const ids = [i0, i1, i2], zs = [z0, z1, z2], pts = [];
    for (let k = 0; k < 3; k++) {
      const p = ids[k], q = ids[(k + 1) % 3], dp = zs[k] - z, dq = zs[(k + 1) % 3] - z;
      if (dp === 0) pts.push([at(p, 0), at(p, 1)]);                  // a corner on the plane
      else if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const f = dp / (dp - dq);
        pts.push([at(p, 0) + f * (at(q, 0) - at(p, 0)), at(p, 1) + f * (at(q, 1) - at(p, 1))]);
      }
    }
    if (pts.length !== 2) continue;
    // Orient the segment so that the solid is on its left: the triangle's outward normal
    // (by its winding) points to the segment's right.
    const ux = at(i1, 0) - at(i0, 0), uy = at(i1, 1) - at(i0, 1), uz = z1 - z0;
    const vx = at(i2, 0) - at(i0, 0), vy = at(i2, 1) - at(i0, 1), vz = z2 - z0;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz;
    if ((pts[1][1] - pts[0][1]) * nx - (pts[1][0] - pts[0][0]) * ny < 0) pts.reverse();
    const seg = {a: pts[0], b: pts[1], reel: t.reel};
    if (t.part !== undefined) seg.part = t.part;
    if (t.negative) seg.negative = true;
    out.push(seg);
  }
  return out;
}

/** Winding number of oriented segments (solid on their left) round a point, with y bins. */
function windingIndex(edges, bin = 0.5) {
  const bins = new Map();
  edges.forEach((e, i) => {
    for (let k = Math.floor(Math.min(e.a[1], e.b[1]) / bin); k <= Math.floor(Math.max(e.a[1], e.b[1]) / bin); k++) {
      let list = bins.get(k);
      if (!list) bins.set(k, list = []);
      list.push(i);
    }
  });
  return (x, y) => {
    let w = 0;
    for (const i of bins.get(Math.floor(y / bin)) || []) {
      const {a, b} = edges[i];
      const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);   // > 0: point on the left
      if (a[1] <= y && b[1] > y && side > 0) w += 1;
      else if (b[1] <= y && a[1] > y && side < 0) w -= 1;
    }
    return w;
  };
}

/**
 * Keeps only the parts of section segments that are on the printed surface: a piece is
 * dropped when the point just outside it (by `offset` mm, to the segment's right) is
 * still inside solid -- another part, or another shell of the same mesh, by the non-zero
 * winding rule -- or when it lies inside a negative part. Negative parts' own segments
 * are dropped (they carry no paint). Segments must run with the solid on their left, as
 * crossSection makes them; they are tested in pieces of at most `piece` mm.
 */
export function dropInside(segments, options = {}) {
  return splitInside(segments, options).kept;
}

/** As dropInside, but also returns the dropped pieces: {kept, dropped}. */
export function splitInside(segments, {piece = 0.25, offset = 0.05} = {}) {
  const solid = segments.filter(s => !s.negative), negative = segments.filter(s => s.negative);
  const solidWinding = windingIndex(solid), negativeWinding = negative.length ? windingIndex(negative) : () => 0;
  const kept = [], dropped = [];
  for (const s of solid) {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const n = Math.max(1, Math.ceil(length / piece)), ox = dy / length * offset, oy = -dx / length * offset;
    const pt = f => [s.a[0] + f * dx, s.a[1] + f * dy];
    let start = 0, state = null;
    const close = k => {
      if (state === null || k === start) return;
      (state ? kept : dropped).push(start === 0 && k === n ? s : {...s, a: pt(start / n), b: pt(k / n)});
    };
    for (let k = 0; k < n; k++) {
      const [x, y] = pt((k + 0.5) / n);
      const keep = solidWinding(x + ox, y + oy) === 0 && negativeWinding(x, y) === 0;
      if (keep !== state) { close(k); start = k; state = keep; }
    }
    close(n);
  }
  return {kept, dropped};
}

/**
 * Stops a check where walls of any reel could pass unjudged as "hidden" because the
 * outline was lost: a part wound inside out, or one whose outline was taken as inside
 * other solid although the slicer printed walls along it. `parts` give, over the checked
 * layers, the raw outline (mm, solid parts only), the length kept by splitInside, the
 * dropped length with printed outer wall within 0.35 mm (`walled`) and the summed signed
 * area of the raw outline (`area`, mm^2, positive with the solid on the left); `layers`
 * give raw and kept per layer. With at least `minRaw` mm of raw outline:
 * - a part whose signed area is not positive is wound inside out, and fails;
 * - a part keeping less than `partKeep` of its outline fails when printed outer wall lies
 *   along more than `walledShare` of what was dropped; otherwise (a part embedded in
 *   another) it is only listed in `embedded`;
 * - a layer keeping less than `layerKeep` of its outline fails.
 */
export function outlineGuard({parts = [], layers = []}, {minRaw = 20, partKeep = 0.05, walledShare = 0.9, layerKeep = 0.1} = {}) {
  const problems = [], embedded = [];
  for (const p of parts) {
    if (!(p.raw >= minRaw)) continue;
    const name = `part ${p.part}${p.name ? ` (${p.name})` : ''}`;
    if (p.area !== undefined && !(p.area > 0)) { problems.push(`${name} is wound inside out (signed area ${p.area.toFixed(1)} mm²)`); continue; }
    if (p.kept < partKeep * p.raw) {
      const dropped = p.raw - p.kept, walled = p.walled ?? dropped;
      const text = `${name} keeps ${p.kept.toFixed(1)} of ${p.raw.toFixed(1)} mm of outline, printed outer wall along ${(100 * walled / dropped).toFixed(0)}% of the rest`;
      (walled > walledShare * dropped ? problems : embedded).push(text);
    }
  }
  for (const l of layers) if (l.raw >= minRaw && l.kept < layerKeep * l.raw)
    problems.push(`layer ${l.layer} keeps ${l.kept.toFixed(1)} of ${l.raw.toFixed(1)} mm of outline`);
  return {ok: problems.length === 0, problems, embedded};
}

// ----------------------------------------------------------------- G-code ----

/**
 * A line-by-line G-code reader. `onWall` receives every extruding move typed
 * `;TYPE:<type>` (default "Outer wall") as {layer, z, tool, a, b, type}: layer counts
 * ;LAYER_CHANGE lines from 0, z is the last ;Z: value, tool is the last T<n> (zero-based).
 * Relative (M83) and absolute (M82) extrusion and G92 E are followed; a move extrudes
 * when it travels in X/Y and E goes up. Moves between ;WIPE_START and ;WIPE_END are
 * never walls. G2/G3 arcs that extrude are split into chords of at most 0.2 mm.
 */
export function wallReader(onWall, {types = ['Outer wall']} = {}) {
  const wanted = new Set(types);
  const s = {x: 0, y: 0, z: 0, layer: -1, tool: -1, type: '', relative: true, lastE: 0, wipe: false, arcs: 0, extrudingArcs: 0};
  const emit = (a, b) => onWall({layer: s.layer, z: s.z, tool: s.tool, a, b, ...(types.length > 1 ? {type: s.type} : {})});
  const line = raw => {
    const text = raw.trim();
    if (text.startsWith(';')) {
      if (text.startsWith(';LAYER_CHANGE')) s.layer += 1;
      else if (text.startsWith(';Z:')) s.z = Number(text.slice(3));
      else if (text.startsWith(';TYPE:')) s.type = text.slice(6).trim();
      else if (text.startsWith(';WIPE_START')) s.wipe = true;
      else if (text.startsWith(';WIPE_END')) s.wipe = false;
      return;
    }
    const c0 = text.charCodeAt(0);
    if (c0 === 84) { const t = /^T(\d+)\b/.exec(text); if (t) s.tool = Number(t[1]); return; }    // T
    if (c0 !== 71 && c0 !== 77) return;                                                         // G, M
    if (text.startsWith('M83')) { s.relative = true; return; }
    if (text.startsWith('M82')) { s.relative = false; return; }
    const g = /^G([0-3]|92)(?=\s|$)/.exec(text);
    if (!g) return;
    const words = {};
    for (const m of text.split(';')[0].matchAll(/([XYEIJ])(-?[\d.]+)/g)) words[m[1]] = Number(m[2]);
    if (g[1] === '92') { if (words.E !== undefined) s.lastE = words.E; return; }
    const nx = words.X ?? s.x, ny = words.Y ?? s.y;
    let e = 0;
    if (words.E !== undefined) { e = s.relative ? words.E : words.E - s.lastE; s.lastE = s.relative ? s.lastE : words.E; }
    const arc = g[1] === '2' || g[1] === '3';
    if (arc) s.arcs += 1;
    const extruding = e > 0 && !s.wipe && wanted.has(s.type) && s.tool >= 0;
    if (extruding && arc) {
      s.extrudingArcs += 1;
      const cx = s.x + (words.I ?? 0), cy = s.y + (words.J ?? 0), r = Math.hypot(s.x - cx, s.y - cy);
      const a0 = Math.atan2(s.y - cy, s.x - cx);
      let sweep = Math.atan2(ny - cy, nx - cx) - a0;
      if (g[1] === '3') { if (sweep <= 0) sweep += 2 * Math.PI; } else if (sweep >= 0) sweep -= 2 * Math.PI;
      const n = Math.max(8, Math.ceil(Math.abs(sweep) * r / 0.2));
      let prev = [s.x, s.y];
      for (let k = 1; k <= n; k++) {
        const next = k === n ? [nx, ny] : [cx + r * Math.cos(a0 + sweep * k / n), cy + r * Math.sin(a0 + sweep * k / n)];
        emit(prev, next); prev = next;
      }
    } else if (extruding && (nx !== s.x || ny !== s.y)) emit([s.x, s.y], [nx, ny]);
    s.x = nx; s.y = ny;
  };
  return {line, state: s};
}

/** Every extruding outer-wall move of a G-code text, with the active tool and layer. */
export function outerWalls(gcode) {
  const out = [], reader = wallReader(w => out.push(w));
  for (const line of gcode.split('\n')) reader.line(line);
  return out;
}

// --------------------------------------------------------------- checking ----

/** A uniform grid of items with a bounding box, for near-neighbour queries. */
function grid(cell) {
  const cells = new Map();
  const key = (i, j) => i * 1048576 + j;
  return {
    add(index, x0, y0, x1, y1) {
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
        for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) {
          const k = key(i, j);
          let list = cells.get(k);
          if (!list) cells.set(k, list = []);
          list.push(index);
        }
    },
    /** Calls visit(index) for every item in a cell within r of (x, y); an item may repeat. */
    near(x, y, r, visit) {
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++)
        for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) {
          const list = cells.get(key(i, j));
          if (list) for (const index of list) visit(index);
        }
    },
  };
}

function pointSegment(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const f = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - a[0] - f * dx, py - a[1] - f * dy);
}

/** Midpoints of n equal pieces of a segment no longer than step, with the piece length. */
function samples(a, b, step, visit) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(length > 0)) return;
  const n = Math.max(1, Math.ceil(length / step)), w = length / n;
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n;
    visit(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), w);
  }
}

export const SURFACE_BIN = 0.001, REACH_BIN = 0.01, REACH = 2;

/**
 * Judges one layer's outer walls against its section (see the brief's rules). Besides
 * the brief's fields it returns `surfaceHistogram` (visible samples' distance to the
 * section, in SURFACE_BIN mm bins, weighted by length), `reachHistogram` (section
 * points' distance to the nearest wall sample, in REACH_BIN mm bins up to REACH mm,
 * the last bin holding everything beyond) and a few example points. A visible sample
 * whose nearest segment's reel is unknown (0) counts as mixed. `onSample`, when given,
 * receives every judged sample as {kind: 'matched' | 'wrong' | 'mixed', x, y, length,
 * tool, reel} (for investigation).
 */
export function checkLayer(section, walls, {surface = 0.35, mixed = 0.6, step = 0.2, onSample = null, dropped = []} = {}) {
  const r = {visible: 0, matched: 0, wrong: 0, mixed: 0, hidden: 0, covered: 0, sectionLength: 0,
    surfaceHistogram: new Float64Array(Math.ceil(surface / SURFACE_BIN) + 1), reachHistogram: new Float64Array(Math.round(REACH / REACH_BIN) + 1),
    hiddenByTool: {}, nearOtherReel: 0, alongDropped: {}, alongDroppedHidden: {},
    examples: {wrong: [], uncovered: [], nearOtherReel: []}};
  const reach = Math.max(surface, mixed);
  const dropGrid = grid(0.5);
  dropped.forEach((s, i) => dropGrid.add(i, Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])));
  const segGrid = grid(Math.max(reach, 0.5));
  section.forEach((s, i) => segGrid.add(i, Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])));
  const stamp = new Int32Array(section.length).fill(-1);
  let query = 0;
  const xs = [], ys = [];
  for (const w of walls) samples(w.a, w.b, step, (x, y, len) => {
    xs.push(x); ys.push(y);
    query += 1;
    let best = Infinity, nearest = -1;
    const reels = new Set();
    segGrid.near(x, y, reach, i => {
      if (stamp[i] === query) return;
      stamp[i] = query;
      const d = pointSegment(x, y, section[i].a, section[i].b);
      if (d <= mixed) reels.add(section[i].reel);
      if (d < best) { best = d; nearest = i; }
    });
    let alongDropped = false;
    if (dropped.length) dropGrid.near(x, y, surface, i => { if (!alongDropped && pointSegment(x, y, dropped[i].a, dropped[i].b) <= surface) alongDropped = true; });
    if (alongDropped) r.alongDropped[w.tool] = (r.alongDropped[w.tool] || 0) + len;
    if (!(best <= surface)) {
      r.hidden += len;
      if (alongDropped) r.alongDroppedHidden[w.tool] = (r.alongDroppedHidden[w.tool] || 0) + len;
      // How far: 0.35-0.6 mm (near), 0.6-1 mm (mid) or over 1 mm (far) from the kept outline.
      if (best > mixed) segGrid.near(x, y, 1, i => { const d = pointSegment(x, y, section[i].a, section[i].b); if (d < best) { best = d; nearest = i; } });
      const band = best <= mixed ? 'near' : best <= 1 ? 'mid' : 'far';
      const h = r.hiddenByTool[w.tool] ??= {near: 0, mid: 0, far: 0};
      h[band] += len;
      if (band === 'near' && section[nearest].reel && section[nearest].reel !== w.tool + 1) {
        r.nearOtherReel += len;
        if (r.examples.nearOtherReel.length < 5) r.examples.nearOtherReel.push({x: round(x), y: round(y), tool: w.tool, reel: section[nearest].reel, distance: round(best)});
      }
      return;
    }
    r.visible += len;
    r.surfaceHistogram[Math.min(r.surfaceHistogram.length - 1, Math.floor(best / SURFACE_BIN))] += len;
    const reel = section[nearest].reel;
    let kind;
    if (reels.size > 1 || !reel) { r.mixed += len; kind = 'mixed'; }
    else if (w.tool + 1 === reel) { r.matched += len; kind = 'matched'; }
    else {
      r.wrong += len; kind = 'wrong';
      if (r.examples.wrong.length < 5) r.examples.wrong.push({x: round(x), y: round(y), tool: w.tool, reel});
    }
    onSample?.({kind, x, y, length: len, tool: w.tool, reel});
  });
  // Coverage: section points (every step / 2) with a wall sample within `surface`; the
  // distance to the nearest sample is kept up to REACH mm for the alignment check.
  const wallGrid = grid(0.5);
  for (let i = 0; i < xs.length; i++) wallGrid.add(i, xs[i], ys[i], xs[i], ys[i]);
  const last = r.reachHistogram.length - 1;
  let gap = null;
  for (const s of section) samples(s.a, s.b, step / 2, (x, y, len) => {
    r.sectionLength += len;
    let best = Infinity;
    const look = i => { const d = Math.hypot(xs[i] - x, ys[i] - y); if (d < best) best = d; };
    wallGrid.near(x, y, surface, look);
    if (best > surface) wallGrid.near(x, y, REACH, look);
    if (best <= surface) { r.covered += len; gap = null; }
    else if (r.examples.uncovered.length < 5 && !gap) { gap = true; r.examples.uncovered.push({x: round(x), y: round(y), reel: s.reel}); }
    r.reachHistogram[Math.min(last, Math.floor(best / REACH_BIN))] += len;
  });
  // Dropped outline with an outer-wall sample within `surface`, by part: printed wall
  // along outline that the check took as inside other solid.
  r.droppedWalled = {};
  r.droppedLength = {};
  for (const s of dropped) samples(s.a, s.b, step / 2, (x, y, len) => {
    const key = s.part ?? 0;
    r.droppedLength[key] = (r.droppedLength[key] || 0) + len;
    let near = false;
    wallGrid.near(x, y, surface, i => { if (!near && Math.hypot(xs[i] - x, ys[i] - y) <= surface) near = true; });
    if (near) r.droppedWalled[key] = (r.droppedWalled[key] || 0) + len;
  });
  return r;
}

const round = x => Math.round(x * 1000) / 1000;

/** The length-weighted median of a histogram with bins of `bin` mm (the bin's middle). */
export function histogramMedian(hist, bin) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let run = 0;
  for (let i = 0; i < hist.length; i++) { run += hist[i]; if (run >= total / 2) return (i + 0.5) * bin; }
  return null;
}

/** Totals over checked layers, and the brief's pass rule. */
export function summarise(layers) {
  let matched = 0, wrong = 0, covered = 0, sectionLength = 0, mixed = 0, visible = 0;
  let worst = null, worstSmall = null, badLarge = false;
  for (const l of layers) {
    matched += l.matched; wrong += l.wrong; covered += l.covered; sectionLength += l.sectionLength; mixed += l.mixed; visible += l.visible;
    const judged = l.matched + l.wrong;
    if (!judged) continue;
    const share = l.matched / judged, entry = {layer: l.layer, matchedShare: share};
    if (judged > 20) {
      if (share < 0.95) badLarge = true;
      if (!worst || share < worst.matchedShare) worst = entry;
    } else if (!worstSmall || share < worstSmall.matchedShare) worstSmall = entry;
  }
  const matchedShare = matched + wrong ? matched / (matched + wrong) : 0;
  const coveredShare = sectionLength ? covered / sectionLength : 0;
  return {layersChecked: layers.length, matchedShare, worstLayer: worst ?? worstSmall ?? {layer: null, matchedShare: 0},
    worstSmallLayer: worstSmall, coveredShare, mixedShare: visible ? mixed / visible : 0,
    pass: layers.length > 0 && matched + wrong > 0 && matchedShare >= 0.99 && !badLarge && coveredShare >= 0.9};
}
