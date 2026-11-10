// Throwaway spike (built-in colours, Task 2). Not wired into the app.
//
//   node tools/built-in-colours-spike.mjs <input.3mf> <layerHeight> <output.3mf> [--raw]
//   node tools/built-in-colours-spike.mjs --make-test-solid <output.3mf>
//
// The first form exports the input for the Snapmaker U1 with four reels and no
// recipes, limits paint to the outer shell with applyDualWall (inner slot 4,
// depth 0.45 mm), then cuts every painted triangle into strips at the slicer's
// layer boundaries and paints each strip with reel [1,2,3][layer % 3]. Split
// paint is first expanded into its leaf sub-triangles (standard.leafTriangles,
// the exact port of the slicer's own split geometry). Strip corners closer than
// 1e-6 mm are welded into one vertex unless --raw is given (see the findings in
// docs/built-in-colours-spike-2026-11.md). A JSON report is written next to the
// output.
//
// The second form writes a synthetic painted test solid (about 100 mm tall,
// about 200,000 triangles, three painted shades plus split-painted boundaries),
// because no real painted figurine was available for the spike.
import {readFileSync, writeFileSync} from 'node:fs';
import {readZip, writeZip} from '../web/zip.js';
import {readProject, exportProject, matrixFromText, matmul, applyMatrix, SRC_BBL_PROJECT} from '../web/shared/project.js';
import {applyDualWall} from '../web/shared/dualWall.js';
import {bandTriangle} from '../web/shared/layerBands.js';
import {leafTriangles} from '../web/shared/standard.js';
import {wallTestSetup} from '../web/shared/wallComparison.js';
import * as paint from '../web/shared/paint.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const FIRST = 0.2, PATTERN = [1, 2, 3];
const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
const COMPONENT_RE = /<component\b([^>]*?)\/>/g;
const ITEM_RE = /<item\b([^>]*?)\/>/g;
const VERTEX_RE = /<vertex\b[^>]*?x="([^"]+)"[^>]*?y="([^"]+)"[^>]*?z="([^"]+)"[^>]*?\/>/g;
const TRIANGLE_RE = /<triangle\b([^>]*?)\/>/g;
const PAINT_RE = /\s(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"/;
const attr = (text, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(text)?.[1];

// ------------------------------------------------------------ test solid ----

function makeTestSolid(path) {
  const N = 360, ROWS = 277, H = 100, cx = 0, cy = 0;
  const radius = (t, z) => 20 + 2.5 * Math.sin(5 * t) * Math.sin(z / 7) + 1.5 * Math.cos(3 * t + z / 11);
  const v = [];
  for (let r = 0; r <= ROWS; r++) {
    const z = H * r / ROWS;
    for (let i = 0; i < N; i++) { const t = 2 * Math.PI * i / N, R = radius(t, z); v.push([cx + R * Math.cos(t), cy + R * Math.sin(t), z]); }
  }
  const bottom = v.length; v.push([cx, cy, 0]);
  const top = v.length; v.push([cx, cy, H]);
  const leaf = s => ({kind: 'leaf', state: s});
  // Three painted shades by region; state 0 (no paint) leaves the part's own filament (1).
  const region = (i, r) => (r > ROWS * 0.72 ? 4 : i < 120 ? 2 : i < 240 ? 3 : 0);
  const tris = [];
  let split = 0;
  const painted = (a, b, c, i, r, boundary) => {
    let code = '';
    const s = region(i, r);
    if (boundary) {
      // Split paint where two regions meet, as a brush stroke along an edge leaves it.
      const other = region((i + 1) % N, r) || 1, mine = s || 1;
      const node = (i + r) % 3 === 0
        ? {kind: 'split', sides: 3, specialSide: 0, children: [leaf(mine), {kind: 'split', sides: 1, specialSide: 1, children: [leaf(other), leaf(mine)]}, leaf(other), leaf(mine)]}
        : {kind: 'split', sides: 1, specialSide: (i + r) % 3, children: [leaf(mine), leaf(other)]};
      code = paint.encode(node); split += 1;
    } else if (s) code = paint.encode(leaf(s));
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"${code ? ` paint_color="${code}"` : ''}/>`);
  };
  for (let r = 0; r < ROWS; r++) for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, a = r * N + i, b = r * N + j, c = (r + 1) * N + j, d = (r + 1) * N + i;
    const boundary = region(i, r) !== region(j, r);
    painted(a, b, c, i, r, boundary); painted(a, c, d, i, r, boundary);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    tris.push(`<triangle v1="${bottom}" v2="${j}" v3="${i}"/>`);
    tris.push(`<triangle v1="${top}" v2="${ROWS * N + i}" v3="${ROWS * N + j}"/>`);
  }
  const num = x => Number(x.toFixed(6));
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Built-in colours spike test solid</metadata><resources>`
    + `<object id="1" type="model"><mesh><vertices>${v.map(p => `<vertex x="${num(p[0])}" y="${num(p[1])}" z="${num(p[2])}"/>`).join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`
    + `<object id="2" type="model"><components><component objectid="1"/></components></object></resources>`
    + `<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 135 135 0"/></build></model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?><config><object id="2"><metadata key="name" value="Lumpy test solid"/><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="name" value="Lumpy test solid"/><metadata key="extruder" value="1"/></part></object></config>`;
  const project = {filament_colour: ['#F2F2F2', '#C03030', '#3060C0', '#E0B020'], filament_type: ['PLA', 'PLA', 'PLA', 'PLA'], layer_height: '0.2', wall_loops: '2', enable_support: '0'};
  const items = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`],
    ['3D/3dmodel.model', model],
    ['Metadata/model_settings.config', settings],
    [SRC_BBL_PROJECT, JSON.stringify(project, null, 2)],
  ];
  return writeZip(items.map(([name, data]) => ({name, data: enc.encode(data)}))).then(bytes => {
    writeFileSync(path, bytes);
    return {path, vertices: v.length, triangles: tris.length, splitPainted: split, heightMm: H, bytes: bytes.length};
  });
}

// ------------------------------------------------------------- banding ----

/** Every mesh (member, id) -> world matrix of the build item that places it, and the item. */
function placements(entries) {
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
    const obj = objects.get(attr(it[1], 'objectid')), itemM = matrixFromText(attr(it[1], 'transform'));
    item += 1;
    const list = obj.mesh ? [{member: '3D/3dmodel.model', id: attr(it[1], 'objectid'), m: itemM}]
      : obj.comps.map(c => ({member: c.member, id: c.id, m: c.transform ? matmul(matrixFromText(c.transform), itemM) : itemM}));
    for (const p of list) {
      const key = `${p.member}#${p.id}`;
      if (out.has(key)) {
        const o = out.get(key).m;
        if (o.some((row, i) => row.some((x, j) => Math.abs(x - p.m[i][j]) > 1e-9))) throw Error(`${key} is placed twice with different transforms; the spike cannot band it.`);
      }
      out.set(key, {m: p.m, item});
    }
  }
  return out;
}

function edgeStats(tris) {
  const edges = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  let open = 0, over = 0;
  for (const n of edges.values()) { if (n === 1) open += 1; else if (n > 2) over += 1; }
  return {edges: edges.size, openEdges: open, edgesOnMoreThanTwoFaces: over};
}

/** Chunked UTF-8 encoding, so a model larger than one JS string can be written. */
function encodeParts(parts) {
  const chunks = [];
  let buf = [], len = 0, total = 0;
  const flush = () => { if (!buf.length) return; const b = enc.encode(buf.join('')); chunks.push(b); total += b.length; buf = []; len = 0; };
  for (const p of parts) { buf.push(p); len += p.length; if (len > 8e6) flush(); }
  flush();
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const WELD = 1e-6;   // mm; far below any printer resolution

async function spike(input, height, output, raw = false) {
  const started = Date.now();
  const source = await readZip(readFileSync(input));
  const project = readProject(source);
  const setup = wallTestSetup({height: 0.08});   // only for the four ELEGOO reels; height is set below
  const reels = setup.reels;
  const mapping = Object.fromEntries(project.colors.map((_, i) => [i + 1, (i % 4) + 1]));
  const plateId = project.plates[0]?.id ?? 1;
  const built = exportProject(project, plateId, null, {target: 'snapmaker', reels, recipes: [], mapping, u1Nozzle: '0.4',
    layerHeight: {mode: 'custom', value: String(height)}, subdivideMixLayer: false, title: 'Built-in colours spike'});
  if (built.problems.length) throw Error(built.problems.join('\n'));
  const entries = built.entries;
  const dualWall = applyDualWall(entries, {target: 'snapmaker', innerSlot: 4, depth: 0.45});

  const where = placements(entries);
  // Bed height = world z above the lowest point of the build item.
  const itemMin = new Map();
  const meshes = [];
  for (const [name, data] of entries) {
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const text = dec.decode(data);
    for (const m of text.matchAll(OBJECT_RE)) {
      if (!m[2].includes('<triangle')) continue;
      const key = `${name}#${attr(m[1], 'id')}`, place = where.get(key);
      if (!place) continue;
      const pts = [...m[2].matchAll(VERTEX_RE)].map(v => [Number(v[1]), Number(v[2]), Number(v[3])]);
      for (const p of pts) { const z = applyMatrix(place.m, p)[2]; itemMin.set(place.item, Math.min(itemMin.get(place.item) ?? Infinity, z)); }
      meshes.push({name, id: attr(m[1], 'id'), place});
    }
  }

  const stats = {trianglesBefore: 0, trianglesAfter: 0, paintedBefore: 0, splitPaintedBefore: 0, leafSubTriangles: 0, stripsWritten: 0,
    unpaintedKept: 0, stripsCollapsedByWeld: 0, verticesBefore: 0, verticesAfter: 0, layersSpanned: [Infinity, -Infinity], weldMm: raw ? 0 : WELD,
    before: {openEdges: 0, edgesOnMoreThanTwoFaces: 0}, after: {openEdges: 0, edgesOnMoreThanTwoFaces: 0}, afterWithoutWeld: {openEdges: 0, edgesOnMoreThanTwoFaces: 0}};
  const reelFaces = {1: 0, 2: 0, 3: 0};
  const codes = Object.fromEntries(PATTERN.map(s => [s, paint.encode({kind: 'leaf', state: s})]));
  let modelBytes = 0;

  for (const [name, data] of [...entries]) {
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const text = dec.decode(data);
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(OBJECT_RE)) {
      const id = attr(m[1], 'id'), place = where.get(`${name}#${id}`);
      if (!place || !m[2].includes('<triangle')) continue;
      const zmin = itemMin.get(place.item), M = place.m;
      const zOf = p => applyMatrix(M, p)[2] - zmin;
      const pts = [...m[2].matchAll(VERTEX_RE)].map(v => [Number(v[1]), Number(v[2]), Number(v[3])]);
      stats.verticesBefore += pts.length;
      // bandTriangle computes a cut point from whichever polygon edge it is clipping, so
      // the same point reached from two strips (or two triangles) can differ in the last
      // bits. Points within WELD mm are merged unless --raw; both counts are reported.
      const index = new Map(), exact = new Map(), verts = [];
      const exactId = p => { const k = `${p[0]},${p[1]},${p[2]}`; let i = exact.get(k); if (i === undefined) { i = exact.size; exact.set(k, i); } return i; };
      const vid = p => {
        const k = raw ? `${p[0]},${p[1]},${p[2]}` : `${Math.round(p[0] / WELD)},${Math.round(p[1] / WELD)},${Math.round(p[2] / WELD)}`;
        let i = index.get(k); if (i === undefined) { i = verts.length; index.set(k, i); verts.push(p); } return i;
      };
      const beforeTris = [], afterTris = [], exactTris = [], triText = [];
      for (const t of m[2].matchAll(TRIANGLE_RE)) {
        const a = t[1], ids = ['v1', 'v2', 'v3'].map(k => Number(attr(a, k)));
        const corners = ids.map(i => pts[i]);
        const cornerIds = corners.map(vid);
        beforeTris.push(cornerIds);
        stats.trianglesBefore += 1;
        const found = PAINT_RE.exec(a);
        const rest = a.replace(/\s(?:v1|v2|v3)="[^"]*"/g, '').replace(PAINT_RE, '');
        if (!found || !found[1]) { stats.unpaintedKept += 1; afterTris.push(cornerIds); exactTris.push(corners.map(exactId)); triText.push(`<triangle v1="${cornerIds[0]}" v2="${cornerIds[1]}" v3="${cornerIds[2]}"${rest}/>`); continue; }
        stats.paintedBefore += 1;
        const node = paint.decode(found[1]);
        if (node.kind !== 'leaf') stats.splitPaintedBefore += 1;
        const leaves = leafTriangles(corners, node);
        stats.leafSubTriangles += leaves.length;
        for (const leaf of leaves) for (const strip of bandTriangle(leaf.triangle, zOf, FIRST, height)) {
          const reel = PATTERN[strip.layer % 3], s = strip.points.map(vid);
          exactTris.push(strip.points.map(exactId));
          if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) { stats.stripsCollapsedByWeld += 1; continue; }
          reelFaces[reel] += 1; stats.stripsWritten += 1;
          stats.layersSpanned[0] = Math.min(stats.layersSpanned[0], strip.layer); stats.layersSpanned[1] = Math.max(stats.layersSpanned[1], strip.layer);
          afterTris.push(s);
          triText.push(`<triangle v1="${s[0]}" v2="${s[1]}" v3="${s[2]}" paint_color="${codes[reel]}"${rest}/>`);
        }
      }
      stats.trianglesAfter += afterTris.length;
      stats.verticesAfter += verts.length;
      for (const [k, list] of [['before', beforeTris], ['after', afterTris], ['afterWithoutWeld', exactTris]]) {
        const e = edgeStats(list);
        stats[k].openEdges += e.openEdges; stats[k].edgesOnMoreThanTwoFaces += e.edgesOnMoreThanTwoFaces;
      }
      parts.push(text.slice(last, m.index), `<object${m[1]}><mesh><vertices>`);
      for (const p of verts) parts.push(`<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`);
      parts.push('</vertices><triangles>');
      for (const t of triText) parts.push(t);
      parts.push('</triangles></mesh></object>');
      last = m.index + m[0].length;
    }
    if (!parts.length) { modelBytes += data.length; continue; }
    parts.push(text.slice(last));
    const bytes = encodeParts(parts);
    modelBytes += bytes.length;
    entries.set(name, bytes);
  }

  // Process settings for the spike.
  const cfg = JSON.parse(dec.decode(entries.get(SRC_BBL_PROJECT)));
  const process = {layer_height: String(height), initial_layer_print_height: String(FIRST), mmu_segmented_region_interlocking_depth: '0',
    dithering_local_z_mode: '0', mixed_filament_advanced_dithering: '0'};
  Object.assign(cfg, process);
  if (Array.isArray(cfg.different_settings_to_system) && typeof cfg.different_settings_to_system[0] === 'string')
    cfg.different_settings_to_system[0] = [...new Set([...cfg.different_settings_to_system[0].split(';').filter(Boolean), ...Object.keys(process)])].sort().join(';');
  entries.set(SRC_BBL_PROJECT, enc.encode(JSON.stringify(cfg, null, 2)));
  // The export writes a per-object layer height, which would override the global one.
  const ms = 'Metadata/model_settings.config';
  entries.set(ms, enc.encode(dec.decode(entries.get(ms)).replace(/(<metadata key="layer_height" value=")[^"]*(")/g, `$1${height}$2`)));

  const zip = await writeZip([...entries].map(([name, data]) => ({name, data})));
  writeFileSync(output, zip);
  const report = {input, output, layerHeight: height, firstLayer: FIRST, reels: reels.map(r => r.name || r.color), pattern: 'strip in layer n -> reel [1,2,3][n % 3]; reel 4 inner',
    dualWall: {innerSlot: dualWall.innerSlot, outerDepth: dualWall.outerDepth, facesGivenExplicitPaint: dualWall.facesGivenExplicitPaint, settings: dualWall.settings},
    itemMinWorldZ: Object.fromEntries(itemMin), ...stats, stripsPerReel: reelFaces, uncompressedModelBytes: modelBytes, outputBytes: zip.length,
    processSettings: process, seconds: (Date.now() - started) / 1000};
  writeFileSync(output.replace(/\.3mf$/i, '') + '.json', JSON.stringify(report, null, 2));
  return report;
}

const args = process.argv.slice(2);
if (args[0] === '--make-test-solid' && args[1]) console.log(JSON.stringify(await makeTestSolid(args[1]), null, 2));
else if ((args.length === 3 || (args.length === 4 && args[3] === '--raw')) && Number(args[1]) > 0) {
  const r = await spike(args[0], Number(args[1]), args[2], args[3] === '--raw');
  console.log(JSON.stringify({output: r.output, trianglesBefore: r.trianglesBefore, trianglesAfter: r.trianglesAfter, splitPaintedBefore: r.splitPaintedBefore,
    stripsCollapsedByWeld: r.stripsCollapsedByWeld, before: r.before, after: r.after, afterWithoutWeld: r.afterWithoutWeld,
    uncompressedModelBytes: r.uncompressedModelBytes, outputBytes: r.outputBytes, seconds: r.seconds}, null, 2));
} else {
  console.error('usage: node tools/built-in-colours-spike.mjs <input.3mf> <layerHeight> <output.3mf> [--raw]\n       node tools/built-in-colours-spike.mjs --make-test-solid <output.3mf>');
  process.exitCode = 2;
}
