// Throwaway spike (built-in colours, Task 2; banding replaced in Task 11). Not wired into the app.
//
//   node tools/built-in-colours-spike.mjs <input.3mf> <layerHeight> <output.3mf> [--whole-splits] [--no-band] [--plate=N]
//   node tools/built-in-colours-spike.mjs --make-test-solid <output.3mf>
//
// The first form exports the input for the Snapmaker U1 with four reels and no
// recipes, limits paint to the outer shell with applyDualWall (inner slot 4,
// depth 0.45 mm), then bands every mesh that carries paint with bandMesh
// (web/shared/paintBands.js): each face is cut into its paint leaves and each leaf
// into strips at the slicer's layer boundaries, joined by vertex index. Strips of
// painted faces get reel [1,2,3][layer % 3]; unpainted faces of a painted mesh are
// cut too, so their edges match, but stay unpainted. The output is indexed as it
// comes from bandMesh; nothing is welded. A JSON report is written next to the
// output.
//
// --whole-splits  band split-painted triangles whole (control: no split midpoints)
// --no-band       export and dual-wall only, no banding (control: the source's own
//                 open edges, for comparing with the banded output)
// --plate=N       export plate N instead of the first plate
// --flat-rule=D   experiment (Task 12 follow-up): a painted piece of a face whose normal is
//                 within D degrees of vertical takes the reel of the layer the face tops
//                 (facing up) or bottoms (facing down), by tools/flatFaceRule.mjs, instead
//                 of its band's; the geometry is unchanged. Faces below the first layer's
//                 slice (0.1 mm) stay in the first layer, so a face on the bed stays there.
// --flat-z=Z      height of a piece used by --flat-rule: centroid (default), min, max, or
//                 extreme (highest point if facing up, lowest if facing down)
// --raw           accepted so that earlier command lines still run; it prints a notice and
//                 has no effect, because there is no weld any more
// Negative volumes are kept (readProject allowNegative); they carry no paint and
// are not banded.
//
// The second form writes a synthetic painted test solid (about 100 mm tall,
// about 200,000 triangles, three painted shades plus split-painted boundaries).
import {readFileSync, writeFileSync} from 'node:fs';
import {readZip, writeZip} from '../web/zip.js';
import {readProject, exportProject, applyMatrix, SRC_BBL_PROJECT} from '../web/shared/project.js';
import {applyDualWall} from '../web/shared/dualWall.js';
import {bandMesh} from '../web/shared/paintBands.js';
import {wallTestSetup} from '../web/shared/wallComparison.js';
import * as paint from '../web/shared/paint.js';
import {placements} from './builtInToolpathCheck.mjs';
import {flatFaceLayer, isNearFlat} from './flatFaceRule.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const FIRST = 0.2, PATTERN = [1, 2, 3];
const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
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

// placements(entries) -- every mesh's world matrix and build item -- lives in
// tools/builtInToolpathCheck.mjs, which the toolpath check shares.

/** Open edges (used by one triangle) and edges used by more than two, by vertex index. */
function edgeStats(tris) {
  const keys = new Float64Array(tris.length * 3);
  let n = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3];
    keys[n++] = a < b ? a * 2 ** 26 + b : b * 2 ** 26 + a;
  }
  keys.sort();
  let edges = 0, open = 0, over = 0;
  for (let i = 0; i < n;) {
    let j = i + 1;
    while (j < n && keys[j] === keys[i]) j++;
    edges += 1;
    if (j - i === 1) open += 1; else if (j - i > 2) over += 1;
    i = j;
  }
  return {edges, openEdges: open, edgesOnMoreThanTwoFaces: over};
}

/**
 * Appended vertices that equal another appended vertex or an input vertex (exact
 * coordinates), and pieces with zero area (exactly zero cross product).
 */
function bandChecks(vertices, inputCount, pieces) {
  const seen = new Set();
  let duplicates = 0, zeroArea = 0, smallest = Infinity;
  vertices.forEach((p, i) => { const k = `${p[0]},${p[1]},${p[2]}`; if (seen.has(k) && i >= inputCount) duplicates += 1; seen.add(k); });
  for (const {v} of pieces) {
    const a = vertices[v[0]], b = vertices[v[1]], c = vertices[v[2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    if (area === 0) zeroArea += 1;
    smallest = Math.min(smallest, area);
  }
  return {duplicates, zeroArea, smallest};
}

/** UTF-8 encoding in chunks, so a model larger than one JS string can be written. */
function chunkedWriter() {
  const chunks = [];
  let buf = [], len = 0, total = 0;
  const flush = () => { if (!buf.length) return; const b = enc.encode(buf.join('')); chunks.push(b); total += b.length; buf = []; len = 0; };
  return {
    push(text) { buf.push(text); len += text.length; if (len > 8e6) flush(); },
    bytes() {
      flush();
      const out = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    },
  };
}

async function spike(input, height, output, {wholeSplits = false, noBand = false, plate = null, flatRule = null} = {}) {
  const started = Date.now();
  const source = await readZip(readFileSync(input));
  // Negative volumes are kept as they are (minimal fix for the owner's Super Man file).
  const project = readProject(source, {allowNegative: true});
  const setup = wallTestSetup({height: 0.08});   // only for the four ELEGOO reels; height is set below
  const reels = setup.reels;
  const mapping = Object.fromEntries(project.colors.map((_, i) => [i + 1, (i % 4) + 1]));
  const plateId = plate ?? project.plates[0]?.id ?? 1;
  const built = exportProject(project, plateId, null, {target: 'snapmaker', reels, recipes: [], mapping, u1Nozzle: '0.4',
    layerHeight: {mode: 'custom', value: String(height)}, subdivideMixLayer: false, title: 'Built-in colours spike'});
  if (built.problems.length) throw Error(built.problems.join('\n'));
  const entries = built.entries;
  const dualWall = applyDualWall(entries, {target: 'snapmaker', innerSlot: 4, depth: 0.45});

  const where = placements(entries);
  // Bed height = world z above the lowest point of the build item.
  const itemMin = new Map(), itemMax = new Map();
  for (const [name, data] of entries) {
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const text = dec.decode(data);
    for (const m of text.matchAll(OBJECT_RE)) {
      if (!m[2].includes('<triangle')) continue;
      const place = where.get(`${name}#${attr(m[1], 'id')}`);
      // Only printed (painted, after dual wall) meshes set the bed height; a negative
      // volume carries no paint and does not touch the bed.
      if (!place || !PAINT_RE.test(m[2])) continue;
      for (const v of m[2].matchAll(VERTEX_RE)) {
        const z = applyMatrix(place.m, [Number(v[1]), Number(v[2]), Number(v[3])])[2];
        itemMin.set(place.item, Math.min(itemMin.get(place.item) ?? Infinity, z)); itemMax.set(place.item, Math.max(itemMax.get(place.item) ?? -Infinity, z));
      }
    }
  }

  const stats = {trianglesBefore: 0, trianglesAfter: 0, paintedBefore: 0, splitPaintedBefore: 0, unpaintedBefore: 0, meshesBanded: 0, meshesKept: 0,
    verticesBefore: 0, verticesAfter: 0, duplicateAppendedVertices: 0, zeroAreaPieces: 0, smallestPieceAreaMm2: Infinity, layersSpanned: [Infinity, -Infinity], wholeSplits, noBand,
    flatRule: {rule: flatRule, flatPieces: 0, movedDown: 0, movedUp: 0, movedMoreThanOne: 0},
    before: {openEdges: 0, edgesOnMoreThanTwoFaces: 0}, after: {openEdges: 0, edgesOnMoreThanTwoFaces: 0}};
  const reelFaces = {1: 0, 2: 0, 3: 0};
  const codes = Object.fromEntries(PATTERN.map(s => [s, paint.encode({kind: 'leaf', state: s})]));
  const unpainted = {kind: 'leaf', state: 0};
  let modelBytes = 0;

  for (const [name, data] of [...entries]) {
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const text = dec.decode(data);
    const writer = chunkedWriter();
    let last = 0, changed = false;
    for (const m of text.matchAll(OBJECT_RE)) {
      const id = attr(m[1], 'id'), place = where.get(`${name}#${id}`);
      if (!place || !m[2].includes('<triangle')) continue;
      const pts = [...m[2].matchAll(VERTEX_RE)].map(v => [Number(v[1]), Number(v[2]), Number(v[3])]);
      // Every triangle of a painted mesh is banded, so an unpainted face beside a painted
      // one is cut at the same points; its pieces stay unpainted.
      const faces = [], rests = [], painted = [];
      for (const t of m[2].matchAll(TRIANGLE_RE)) {
        const a = t[1], found = PAINT_RE.exec(a), hasPaint = Boolean(found && found[1]);
        let node = hasPaint ? paint.decode(found[1]) : unpainted;
        if (hasPaint) { stats.paintedBefore += 1; if (node.kind !== 'leaf') stats.splitPaintedBefore += 1; } else stats.unpaintedBefore += 1;
        // --whole-splits: a split-painted triangle is banded as one leaf (control run with no split midpoints).
        if (wholeSplits && node.kind !== 'leaf') node = {kind: 'leaf', state: 0};
        faces.push({v: ['v1', 'v2', 'v3'].map(k => Number(attr(a, k))), paint: node});
        rests.push(a.replace(/\s(?:v1|v2|v3)="[^"]*"/g, '').replace(PAINT_RE, ''));
        painted.push(hasPaint);
      }
      stats.trianglesBefore += faces.length;
      stats.verticesBefore += pts.length;
      const e0 = edgeStats(faces.map(f => f.v));
      stats.before.openEdges += e0.openEdges; stats.before.edgesOnMoreThanTwoFaces += e0.edgesOnMoreThanTwoFaces;
      // A mesh with no paint (a negative volume), and every mesh under --no-band, is written back unchanged.
      if (noBand || !painted.some(Boolean)) {
        stats.meshesKept += 1; stats.trianglesAfter += faces.length; stats.verticesAfter += pts.length;
        stats.after.openEdges += e0.openEdges; stats.after.edgesOnMoreThanTwoFaces += e0.edgesOnMoreThanTwoFaces;
        continue;
      }
      const zmin = itemMin.get(place.item) ?? 0, M = place.m;
      const banded = bandMesh(pts, faces, {zOf: p => applyMatrix(M, p)[2] - zmin, first: FIRST, height});
      stats.meshesBanded += 1;
      stats.trianglesAfter += banded.pieces.length;
      stats.verticesAfter += banded.vertices.length;
      const check = bandChecks(banded.vertices, pts.length, banded.pieces);
      stats.duplicateAppendedVertices += check.duplicates; stats.zeroAreaPieces += check.zeroArea;
      stats.smallestPieceAreaMm2 = Math.min(stats.smallestPieceAreaMm2, check.smallest);
      const e1 = edgeStats(banded.pieces.map(p => p.v));
      stats.after.openEdges += e1.openEdges; stats.after.edgesOnMoreThanTwoFaces += e1.edgesOnMoreThanTwoFaces;
      writer.push(text.slice(last, m.index));
      writer.push(`<object${m[1]}><mesh><vertices>`);
      for (const p of banded.vertices) writer.push(`<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`);
      writer.push('</vertices><triangles>');
      // --flat-rule: a near-flat face's pieces take the reel of the layer the face tops or bottoms.
      const bedZ = p => applyMatrix(M, p)[2] - zmin;
      const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const flatOf = new Map();
      const faceFlat = f => {
        if (!flatOf.has(f)) {
          const [p, q, r] = faces[f].v.map(i => applyMatrix(M, pts[i]));
          const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]], s = det < 0 ? -1 : 1;
          flatOf.set(f, isNearFlat([s * (u[1] * w[2] - u[2] * w[1]), s * (u[2] * w[0] - u[0] * w[2]), s * (u[0] * w[1] - u[1] * w[0])], flatRule.degrees));
        }
        return flatOf.get(f);
      };
      for (const piece of banded.pieces) {
        const [a, b, c] = piece.v;
        let code = '';
        if (painted[piece.face]) {
          let layer = piece.layer;
          if (flatRule) {
            const {flat, up} = faceFlat(piece.face);
            if (flat) {
              const zs = piece.v.map(i => bedZ(banded.vertices[i]));
              // extreme: an up-facing piece by its highest point, a down-facing one by its lowest, so a
              // piece that reaches the slice plane of its own band keeps its band.
              const mode = flatRule.z === 'extreme' ? (up ? 'max' : 'min') : flatRule.z;
              const z = mode === 'min' ? Math.min(...zs) : mode === 'max' ? Math.max(...zs) : (zs[0] + zs[1] + zs[2]) / 3;
              layer = flatFaceLayer(z, up, FIRST, height);
              stats.flatRule.flatPieces += 1;
              if (layer < piece.layer) stats.flatRule.movedDown += 1; else if (layer > piece.layer) stats.flatRule.movedUp += 1;
              if (Math.abs(layer - piece.layer) > 1) stats.flatRule.movedMoreThanOne += 1;
            }
          }
          const reel = PATTERN[layer % 3];
          reelFaces[reel] += 1; code = ` paint_color="${codes[reel]}"`;
          stats.layersSpanned[0] = Math.min(stats.layersSpanned[0], piece.layer); stats.layersSpanned[1] = Math.max(stats.layersSpanned[1], piece.layer);
        }
        writer.push(`<triangle v1="${a}" v2="${b}" v3="${c}"${code}${rests[piece.face]}/>`);
      }
      writer.push('</triangles></mesh></object>');
      last = m.index + m[0].length;
      changed = true;
    }
    if (!changed) { modelBytes += data.length; continue; }
    writer.push(text.slice(last));
    const bytes = writer.bytes();
    modelBytes += bytes.length;
    entries.set(name, bytes);
  }

  // Process settings for the spike.
  const cfg = JSON.parse(dec.decode(entries.get(SRC_BBL_PROJECT)));
  const spikeSettings = {layer_height: String(height), initial_layer_print_height: String(FIRST), mmu_segmented_region_interlocking_depth: '0',
    dithering_local_z_mode: '0', mixed_filament_advanced_dithering: '0'};
  Object.assign(cfg, spikeSettings);
  if (Array.isArray(cfg.different_settings_to_system) && typeof cfg.different_settings_to_system[0] === 'string')
    cfg.different_settings_to_system[0] = [...new Set([...cfg.different_settings_to_system[0].split(';').filter(Boolean), ...Object.keys(spikeSettings)])].sort().join(';');
  entries.set(SRC_BBL_PROJECT, enc.encode(JSON.stringify(cfg, null, 2)));
  // The export writes a per-object layer height, which would override the global one.
  const ms = 'Metadata/model_settings.config';
  entries.set(ms, enc.encode(dec.decode(entries.get(ms)).replace(/(<metadata key="layer_height" value=")[^"]*(")/g, `$1${height}$2`)));

  const zip = await writeZip([...entries].map(([name, data]) => ({name, data})));
  writeFileSync(output, zip);
  const report = {input, output, plateId, layerHeight: height, firstLayer: FIRST, reels: reels.map(r => r.name || r.color), pattern: 'strip in layer n -> reel [1,2,3][n % 3]; reel 4 inner',
    dualWall: {innerSlot: dualWall.innerSlot, outerDepth: dualWall.outerDepth, facesGivenExplicitPaint: dualWall.facesGivenExplicitPaint, settings: dualWall.settings},
    itemMinWorldZ: Object.fromEntries(itemMin), modelHeightMm: Math.max(...[...itemMax].map(([k, v]) => v - itemMin.get(k))), ...stats, stripsPerReel: reelFaces, uncompressedModelBytes: modelBytes, outputBytes: zip.length,
    processSettings: spikeSettings, seconds: (Date.now() - started) / 1000};
  writeFileSync(output.replace(/\.3mf$/i, '') + '.json', JSON.stringify(report, null, 2));
  return report;
}

const args = process.argv.slice(2);
if (args[0] === '--make-test-solid' && args[1]) console.log(JSON.stringify(await makeTestSolid(args[1]), null, 2));
else if (args.length >= 3 && Number(args[1]) > 0 && args.slice(3).every(a => ['--raw', '--whole-splits', '--no-band'].includes(a) || /^--plate=\d+$/.test(a) || /^--flat-rule=\d+(\.\d+)?$/.test(a) || /^--flat-z=(centroid|min|max|extreme)$/.test(a))) {
  if (args.includes('--raw')) console.error('--raw has no effect: the output is never welded.');
  const flatDegrees = Number(args.find(a => a.startsWith('--flat-rule='))?.slice(12)) || null;
  const flags = new Set(args.slice(3)), plate = Number(args.slice(3).find(a => a.startsWith('--plate='))?.slice(8)) || null;
  const r = await spike(args[0], Number(args[1]), args[2], {wholeSplits: flags.has('--whole-splits'), noBand: flags.has('--no-band'), plate,
    flatRule: flatDegrees ? {degrees: flatDegrees, z: args.find(a => a.startsWith('--flat-z='))?.slice(9) || 'centroid'} : null});
  console.log(JSON.stringify({output: r.output, flatRule: r.flatRule, trianglesBefore: r.trianglesBefore, trianglesAfter: r.trianglesAfter, splitPaintedBefore: r.splitPaintedBefore, modelHeightMm: r.modelHeightMm,
    before: r.before, after: r.after, duplicateAppendedVertices: r.duplicateAppendedVertices, zeroAreaPieces: r.zeroAreaPieces, smallestPieceAreaMm2: r.smallestPieceAreaMm2,
    uncompressedModelBytes: r.uncompressedModelBytes, outputBytes: r.outputBytes, seconds: r.seconds}, null, 2));
} else {
  console.error('usage: node tools/built-in-colours-spike.mjs <input.3mf> <layerHeight> <output.3mf> [--whole-splits] [--no-band] [--plate=N]\n       node tools/built-in-colours-spike.mjs --make-test-solid <output.3mf>');
  process.exitCode = 2;
}
