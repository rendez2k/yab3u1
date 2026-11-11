// Throwaway spike checker (built-in colours, Tasks 2 and 12). Modelled on
// tools/check-ordered-wall-toolpaths.mjs.
//
//   node tools/check-built-in-toolpaths.mjs <gcode> --model <exported.3mf> [--every <n>] [--json <out>]
//   node tools/check-built-in-toolpaths.mjs <gcode> <first> <height>
//
// Model mode (Task 12): the G-code is compared with the exported model's own paint
// (tools/builtInToolpathCheck.mjs). Every nth layer above the first (default every
// layer) is cut at mid-layer height and its "Outer wall" moves are judged against the
// reel painted on the outline next to them; walls far from the outline (the inner
// reel's own outer walls, out of sight) are counted but not judged. Prints the summary and
// the ten worst layers, writes the per-layer table as JSON when asked, and exits 1
// when the check does not pass.
//
// Outline guard: outline that lies inside other solid (another part or shell, or a negative
// part) is left out, and walls far from the kept outline are not judged ("hidden"). So
// that a part cannot pass in any reel by losing its outline, the check stops and exits 1
// when, counting only parts and layers with at least 20 mm of raw outline:
// - a part's section, summed over the checked layers, has a signed area that is not
//   positive (the part is wound inside out);
// - a part keeps less than 5% of its outline and printed outer wall lies along more than
//   90% of what was dropped (the slicer saw a surface there). A part keeping under 5%
//   with less wall along it is taken as embedded in another part and only listed;
// - a layer keeps less than 10% of its outline.
// It prints, for information, hidden wall by tool and distance from the kept outline
// (0.35-0.6, 0.6-1, over 1 mm), the hidden 0.35-0.6 mm wall in a reel other than the
// outline's next to it, and outer wall lying along dropped outline by tool.
//
// Alignment stop: it stops when the median distance, over the outline, from each outline
// point to the nearest outer-wall sample is above 0.35 mm (aligned files give about
// 0.215-0.225 mm, half a 0.42 mm line). It also prints the brief's median, from visible
// samples to the outline, but that one cannot show misalignment: a visible sample is by
// definition within 0.35 mm, so its median stays below 0.35 mm (0.205 mm with the model
// 1 mm out). What the stop does not catch, measured on Super Man and Flirty with --offset:
// - x/y shifts up to about 0.5-0.6 mm (Super Man: 0.5 mm in x gives 0.285 mm and 0.6 mm in
//   y 0.325 mm; Flirty: 0.6 mm in x gives 0.335 mm). It stops from 0.6-0.7 mm. Those
//   smaller shifts still fail the check, because coverage falls to 52-64%.
// - Any error in z. The model is dropped onto the bed (its lowest printed point to z = 0)
//   and the median is measured in x/y only. A z error shows only in the reels: on Super
//   Man, 0.06 mm drops matched share to 60% and 0.12 mm (one layer) to 0.1%, but 0.03 mm
//   still passes (it only moves the cut within the layer).
//
// The G-code is read as a stream and the mesh is swept upwards once, so a
// multi-million-triangle model and a multi-hundred-megabyte G-code fit in memory.
// Extra options, for investigation only: --with-overhang also reports coverage with
// "Overhang wall" moves counted; --offset dx,dy,dz moves the model before checking (dz
// after the bed drop), to measure what the alignment stop and the other rules catch.
//
// Fixed-pattern mode (Task 2): for every layer above the first, among extrusions typed
// "Outer wall", the tool with the most extruded length must be [0,1,2][layer % 3], and
// no other tool may exceed 5% of that layer's outer-wall length. Layer n is the one
// whose top is at first + n * height. Prints pass/fail counts and the first ten
// failures, and writes <gcode>.check.json beside the G-code. It assumes one colour per
// layer and a simple outward shape.
import {writeFileSync, readFileSync, createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {crossSection, splitInside, outlineGuard, wallReader, checkLayer, summarise, histogramMedian, SURFACE_BIN, REACH_BIN} from './builtInToolpathCheck.mjs';
import {loadModel, sweeper} from './builtInModelReader.mjs';

const ALIGN_LIMIT = 0.35;
const ALIGN_MESSAGE = 'The model and the G-code do not line up; check the plate and placement.';

// ----------------------------------------------------------- model mode ----

async function modelMode(args) {
  const started = Date.now();
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = args[0], modelPath = opt('--model'), every = Number(opt('--every') ?? 1), jsonOut = opt('--json');
  const withOverhang = args.includes('--with-overhang'), offset = (opt('--offset') ?? '0,0,0').split(',').map(Number);
  if (!file || file.startsWith('--') || !modelPath || !(every >= 1) || !Number.isInteger(every) || offset.length !== 3 || offset.some(x => !Number.isFinite(x))) {
    console.error('usage: node tools/check-built-in-toolpaths.mjs <gcode> --model <exported.3mf> [--every <n>] [--json <out>]\n'
      + 'The alignment stop measures x/y only (median outline-to-wall distance above 0.35 mm). It misses x/y\n'
      + 'shifts up to about 0.5-0.6 mm (coverage then fails instead) and any z error (shown only by matched share).\n'
      + 'Outline guard (exits 1), for parts and layers with at least 20 mm of raw outline: a part whose summed\n'
      + 'section area is not positive (inside out); a part keeping under 5% of its outline with printed outer wall\n'
      + 'along over 90% of the rest; a layer keeping under 10% of its outline. Parts keeping under 5% with less\n'
      + 'wall along them are listed as embedded, not failed.');
    process.exitCode = 2;
    return;
  }
  console.log(`Reading the model ${modelPath} ...`);
  const model = await loadModel(modelPath, offset);
  const sweep = sweeper(model);
  console.log(`  ${model.stats.triangles} triangles in ${model.parts.length} part(s) (${model.parts.filter(p => p.negative).length} negative), read in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  const layers = [], surfaceHist = [], reachHist = [];
  const add = (into, h) => { h.forEach((v, i) => { into[i] = (into[i] || 0) + v; }); };
  let walls = [], prevZ = 0, checkedSoFar = 0, misaligned = false;
  const counts = {lines: 0, M82: 0, M83: 0, layersSeen: 0, overhangWallMm: 0, droppedOutline: 0, nearOtherReel: 0};
  const partOutline = {}, hiddenByTool = {}, alongDropped = {}, alongDroppedHidden = {}, nearOtherExamples = [];
  const reader = wallReader(w => walls.push(w), {types: ['Outer wall', 'Overhang wall']});
  const flush = () => {
    const {layer, z} = reader.state;
    const current = walls;
    walls = [];
    if (layer < 0) return;
    counts.layersSeen = layer + 1;
    const h = z - prevZ;
    prevZ = z;
    if (layer < 1 || (layer - 1) % every !== 0 || misaligned) return;
    const cut = z - h / 2;
    const active = sweep.at(cut);
    const mesh = {vertices: model.vertices, triangles: active.map(i => ({v: [model.tri[3 * i], model.tri[3 * i + 1], model.tri[3 * i + 2]], reel: model.reel[i], part: model.part[i], negative: model.parts[model.part[i]].negative}))};
    const whole = crossSection(mesh, cut);
    // Outline inside another part or another shell (or inside a negative part) is not printed surface.
    const {kept: section, dropped: droppedSegments} = splitInside(whole);
    const segLength = list => list.reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);
    const raw = segLength(whole.filter(s => !s.negative)), dropped = raw - segLength(section);
    counts.droppedOutline += dropped;
    for (const s of whole) if (!s.negative) { const p = partOutline[s.part] ??= {raw: 0, kept: 0, walled: 0, area: 0}; p.raw += Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); p.area += (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2; }
    for (const s of section) partOutline[s.part].kept += Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const outer = current.filter(w => w.type === 'Outer wall'), overhang = current.filter(w => w.type === 'Overhang wall');
    const r = checkLayer(section, outer, {dropped: droppedSegments});
    for (const [tool, h] of Object.entries(r.hiddenByTool)) { const t = hiddenByTool[tool] ??= {near: 0, mid: 0, far: 0}; t.near += h.near; t.mid += h.mid; t.far += h.far; }
    for (const [tool, mm] of Object.entries(r.alongDropped)) alongDropped[tool] = (alongDropped[tool] || 0) + mm;
    for (const [tool, mm] of Object.entries(r.alongDroppedHidden)) alongDroppedHidden[tool] = (alongDroppedHidden[tool] || 0) + mm;
    counts.nearOtherReel += r.nearOtherReel;
    for (const [part, mm] of Object.entries(r.droppedWalled)) partOutline[part].walled += mm;
    if (nearOtherExamples.length < 40) nearOtherExamples.push(...r.examples.nearOtherReel.slice(0, 2).map(e => ({layer, ...e})));
    const overhangMm = overhang.reduce((t, w) => t + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), 0);
    counts.overhangWallMm += overhangMm;
    const row = {layer, z, cut: Number(cut.toFixed(4)), sectionSegments: section.length, rawOutline: raw, droppedOutline: dropped, sectionLength: r.sectionLength, covered: r.covered, visible: r.visible, matched: r.matched, wrong: r.wrong,
      mixed: r.mixed, hidden: r.hidden, hiddenByTool: r.hiddenByTool, nearOtherReel: r.nearOtherReel, alongDropped: r.alongDropped, matchedShare: r.matched + r.wrong ? r.matched / (r.matched + r.wrong) : null, coveredShare: r.sectionLength ? r.covered / r.sectionLength : null,
      overhangWallLength: overhangMm, examples: r.examples};
    if (withOverhang && overhang.length) {
      const o = checkLayer(section, current);
      row.withOverhang = {covered: o.covered, matched: o.matched, wrong: o.wrong, mixed: o.mixed};
    } else if (withOverhang) row.withOverhang = {covered: r.covered, matched: r.matched, wrong: r.wrong, mixed: r.mixed};
    layers.push(row);
    add(surfaceHist, r.surfaceHistogram); add(reachHist, r.reachHistogram);
    checkedSoFar += 1;
    // Stop early when the first layers already show that the model is not where the G-code is.
    if (checkedSoFar === 20 && histogramMedian(reachHist, REACH_BIN) > ALIGN_LIMIT) misaligned = true;
  };
  const lines = createInterface({input: createReadStream(file, {highWaterMark: 1 << 20}), crlfDelay: Infinity});
  for await (const line of lines) {
    counts.lines += 1;
    if (line.startsWith(';LAYER_CHANGE')) flush();
    else if (line.startsWith('M83')) counts.M83 += 1;
    else if (line.startsWith('M82')) counts.M82 += 1;
    reader.line(line);
    if (misaligned) break;
  }
  if (!misaligned) flush();
  const medianSurface = histogramMedian(surfaceHist, SURFACE_BIN), medianReach = histogramMedian(reachHist, REACH_BIN);
  console.log(`  median distance, visible outer-wall samples to the outline: ${medianSurface == null ? 'none' : medianSurface.toFixed(3) + ' mm'}`);
  console.log(`  median distance, outline to the nearest outer-wall sample: ${medianReach == null ? 'none' : medianReach.toFixed(3) + ' mm'}`);
  const guardParts = Object.entries(partOutline).map(([part, o]) => ({part: Number(part), name: model.parts[part]?.id, ...o}));
  const guard = outlineGuard({parts: guardParts, layers: layers.map(l => ({layer: l.layer, raw: l.rawOutline, kept: l.sectionLength}))});
  // A part or layer whose outline was dropped almost entirely would let walls of any reel
  // pass as "hidden": stop before anything else is reported.
  if (!guard.ok && !misaligned) {
    console.log(`Outline guard: FAIL: ${guard.problems.slice(0, 10).join('; ')}${guard.problems.length > 10 ? `; and ${guard.problems.length - 10} more` : ''}`);
    console.log('Almost all of this outline was taken as inside other solid; check the mesh winding and placement.');
    process.exitCode = 1;
    return;
  }
  // Only the outline-to-wall median decides; the visible-sample median is printed for
  // information (it is below 0.35 mm by definition, so it cannot show misalignment).
  if (misaligned || medianReach == null || medianReach > ALIGN_LIMIT) {
    console.log(ALIGN_MESSAGE);
    process.exitCode = 1;
    return;
  }
  const brief = summarise(layers);
  const s = {...brief, pass: brief.pass && guard.ok, briefPass: brief.pass, outlineGuard: guard};
  const total = k => layers.reduce((t, l) => t + l[k], 0);
  const seconds = (Date.now() - started) / 1000;
  const pct = x => (100 * x).toFixed(2) + '%';
  console.log(`${s.layersChecked} layers checked (every ${every} above the first, of ${counts.layersSeen} layers)`);
  console.log(`  matched share ${pct(s.matchedShare)} (${total('matched').toFixed(0)} mm matched, ${total('wrong').toFixed(0)} mm wrong)`);
  console.log(`  worst layer ${s.worstLayer.layer} at ${pct(s.worstLayer.matchedShare)}` + (s.worstSmallLayer ? `; worst layer with 20 mm or less judged: ${s.worstSmallLayer.layer} at ${pct(s.worstSmallLayer.matchedShare)}` : ''));
  console.log(`  covered share ${pct(s.coveredShare)} of ${total('sectionLength').toFixed(0)} mm of outline`);
  console.log(`  mixed share ${pct(s.mixedShare)} of ${total('visible').toFixed(0)} mm visible; hidden (not judged) ${total('hidden').toFixed(0)} mm`);
  console.log(`  outline inside another part or shell, not judged for coverage: ${counts.droppedOutline.toFixed(0)} mm; overhang-wall moves (not counted as outer wall): ${counts.overhangWallMm.toFixed(0)} mm`);
  const mm = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [`T${k}`, typeof v === 'number' ? Number(v.toFixed(1)) : Object.fromEntries(Object.entries(v).map(([b, x]) => [b, Number(x.toFixed(1))]))]));
  console.log(`  hidden by tool and distance from the kept outline (near 0.35-0.6, mid 0.6-1, far over 1 mm): ${JSON.stringify(mm(hiddenByTool))}`);
  console.log(`  hidden 0.35-0.6 mm away in a reel other than the outline's next to it: ${counts.nearOtherReel.toFixed(1)} mm`);
  console.log(`  outer wall along dropped outline, by tool: ${JSON.stringify(mm(alongDropped))}; of it hidden: ${JSON.stringify(mm(alongDroppedHidden))}`);
  console.log(`  outline guard: no part inside out, none lost its outline under printed wall, no layer lost its outline`
    + (guard.embedded.length ? `; parts taken as embedded in others (listed, not judged): ${guard.embedded.join('; ')}` : ''));
  if (withOverhang) console.log(`  with overhang walls counted: covered share ${pct(layers.reduce((t, l) => t + l.withOverhang.covered, 0) / total('sectionLength'))}`);
  console.log(`  ${s.pass ? 'PASS' : 'FAIL'} (matched at least 99%, no layer with over 20 mm judged below 95%, covered at least 90%, and the outline guard)`);
  const judged = l => l.matched + l.wrong;
  const worst = [...layers].filter(l => judged(l) > 0).sort((a, b) => a.matchedShare - b.matchedShare || b.wrong - a.wrong).slice(0, 10);
  console.log('ten worst layers by matched share:');
  for (const l of worst) console.log(`  layer ${l.layer} (z ${l.z}): matched ${pct(l.matchedShare)}, wrong ${l.wrong.toFixed(1)} mm, judged ${judged(l).toFixed(1)} mm, covered ${pct(l.coveredShare ?? 0)}`
    + (l.examples.wrong.length ? `, e.g. ${l.examples.wrong.slice(0, 2).map(e => `(${e.x}, ${e.y}) T${e.tool} on reel ${e.reel}`).join(', ')}` : ''));
  const thin = [...layers].filter(l => l.sectionLength > 0).sort((a, b) => a.coveredShare - b.coveredShare).slice(0, 10);
  console.log('ten least covered layers:');
  for (const l of thin) console.log(`  layer ${l.layer} (z ${l.z}): covered ${pct(l.coveredShare)} of ${l.sectionLength.toFixed(1)} mm` + (l.examples.uncovered.length ? `, e.g. ${l.examples.uncovered.slice(0, 2).map(e => `(${e.x}, ${e.y})`).join(', ')}` : ''));
  console.log(`run time ${seconds.toFixed(1)} s, peak resident memory ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
  if (jsonOut) {
    const r6 = x => typeof x === 'number' ? Number(x.toFixed(6)) : x;
    writeFileSync(jsonOut, JSON.stringify({gcode: file, model: modelPath, every, thresholds: {surface: 0.35, mixed: 0.6, step: 0.2}, checkedAt: new Date().toISOString(), seconds,
      summary: s, medianSurfaceDistance: medianSurface, medianOutlineToWall: medianReach,
      hiddenByTool, nearOtherReel: counts.nearOtherReel, nearOtherReelExamples: nearOtherExamples, alongDropped, alongDroppedHidden, partOutline: guardParts,
      totals: {matched: total('matched'), wrong: total('wrong'), mixed: total('mixed'), visible: total('visible'), hidden: total('hidden'), covered: total('covered'), sectionLength: total('sectionLength'), droppedOutline: counts.droppedOutline, overhangWall: counts.overhangWallMm},
      gcodeReading: {lines: counts.lines, layers: counts.layersSeen, M82: counts.M82, M83: counts.M83, arcs: reader.state.arcs, outerWallArcs: reader.state.extrudingArcs},
      modelReading: {...model.stats, parts: model.parts.map(({member, id, subtype, extruder, droppedBy}) => ({member, id, subtype, extruder, droppedBy})), itemMinWorldZ: model.itemMinWorldZ, offset},
      layers: layers.map(l => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, r6(v)])))}, null, 1));
    console.log(`wrote ${jsonOut}`);
  }
  if (!s.pass) process.exitCode = 1;
}

// ---------------------------------------------------- fixed-pattern mode ----

function fixedPattern() {
  const [file, firstArg, heightArg] = process.argv.slice(2);
  const first = Number(firstArg), height = Number(heightArg);
  if (!file || !(first > 0) || !(height > 0)) {
    console.error('usage: node tools/check-built-in-toolpaths.mjs <gcode> <first> <height>');
    process.exit(2);
  }
  const gcode = readFileSync(file, 'utf8');
  const wantedTool = n => [0, 1, 2][n % 3];

  const layers = new Map();            // layer -> {tool: outer-wall length}
  const segments = new Map();          // layer -> [[tool, midX, midY, length]] of outer-wall moves
  const offGrid = new Set();           // ;Z values that are not on the expected layer grid
  const towerE = {};                   // tool -> mm of filament extruded on the prime tower
  const allE = {};                     // tool -> mm of filament extruded in total
  let x = 0, y = 0, z = 0, tool = -1, type = '', relative = true, lastE = 0, toolChanges = 0, maxLayer = 0;
  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (line.startsWith(';Z:')) {
      z = Number(line.slice(3));
      const exact = (z - first) / height;
      if (Math.abs(exact - Math.round(exact)) > 0.01) offGrid.add(z);
    }
    if (line.startsWith(';TYPE:')) type = line.slice(6).trim();
    const t = /^T(\d+)\b/.exec(line);
    if (t) { const next = Number(t[1]); if (tool >= 0 && next !== tool) toolChanges += 1; tool = next; }
    if (/^M83\b/.test(line)) relative = true;
    if (/^M82\b/.test(line)) relative = false;
    if (/^G92\b/.test(line) && /E/.test(line)) lastE = Number(/E([-\d.]+)/.exec(line)?.[1] || 0);
    if (!/^G[0123]\s/.test(line)) continue;
    const values = Object.fromEntries([...line.split(';')[0].matchAll(/([XYE])([-\d.]+)/g)].map(m => [m[1], Number(m[2])]));
    const nx = values.X ?? x, ny = values.Y ?? y, e = values.E == null ? 0 : relative ? values.E : values.E - lastE;
    if (values.E != null) lastE = values.E;
    const distance = Math.hypot(nx - x, ny - y);
    // Only moves that travel while extruding: pure E moves are retracts and primes.
    if (e > 0 && distance > 0 && tool >= 0) {
      allE[tool] = (allE[tool] || 0) + e;
      if (/prime tower|wipe tower/i.test(type)) towerE[tool] = (towerE[tool] || 0) + e;
    }
    if (e > 0 && distance > 0 && tool >= 0 && type === 'Outer wall') {
      const n = Math.round((z - first) / height);
      maxLayer = Math.max(maxLayer, n);
      if (!layers.has(n)) layers.set(n, {});
      const l = layers.get(n);
      l[tool] = (l[tool] || 0) + distance;
      if (!segments.has(n)) segments.set(n, []);
      // Points every 0.2 mm along the move, so a long chord does not hide behind its midpoint.
      const steps = Math.max(1, Math.ceil(distance / 0.2));
      for (let k = 0; k <= steps; k++) segments.get(n).push([tool, x + (nx - x) * k / steps, y + (ny - y) * k / steps, distance / (steps + 1)]);
    }
    x = nx; y = ny;
  }

  const failures = [], colourFailures = [];
  let checked = 0, passed = 0;
  const missing = [];
  for (let n = 1; n <= maxLayer; n++) {
    const l = layers.get(n);
    if (!l) { missing.push(n); continue; }
    checked += 1;
    const total = Object.values(l).reduce((a, b) => a + b, 0), wanted = wantedTool(n);
    const top = Object.entries(l).sort((a, b) => b[1] - a[1])[0];
    const strays = Object.entries(l).filter(([k, v]) => Number(k) !== wanted && v > 0.05 * total);
    if (Number(top[0]) !== wanted || strays.length) {
      failures.push({layer: n, z: Number((first + n * height).toFixed(4)), wanted, lengths: Object.fromEntries(Object.entries(l).map(([k, v]) => [k, Number(v.toFixed(2))])),
        strayShare: Number((strays.reduce((a, [, v]) => a + v, 0) / total).toFixed(4))});
    } else passed += 1;
    // Colour-only view (not the brief's rule): the same test with the interior reel
    // (T3) left out, so a layer fails only when another *colour* reel strays.
    const c = Object.entries(l).filter(([k]) => Number(k) !== 3), ctotal = c.reduce((a, [, v]) => a + v, 0);
    const cstray = c.filter(([k]) => Number(k) !== wanted).reduce((a, [, v]) => a + v, 0);
    if (ctotal && ((l[wanted] || 0) < cstray || c.some(([k, v]) => Number(k) !== wanted && v > 0.05 * ctotal)))
      colourFailures.push({layer: n, wanted, strayShare: Number((cstray / ctotal).toFixed(4))});
  }

  // Secondary view (not the brief's rule): what is on the visible surface. Around the
  // layer's centroid the layer is cut into 180 two-degree sectors; each sector is owned
  // by the tool of the outer-wall point (sampled every 0.2 mm) lying furthest out. A layer fails
  // when more than 5% of its occupied sectors are owned by another tool, or when fewer
  // than 162 of the 180 sectors are occupied at all. Valid for
  // star-shaped layers (such as the spike's test solid), not for arbitrary models.
  let surfaceChecked = 0, surfacePassed = 0, layersWithAnyForeignSector = 0, minOccupied = Infinity, layersUnder90Percent = 0;
  const MIN_SECTORS = 162;   // 90% of 180: fewer occupied sectors fails the layer, so a sparse layer cannot pass silently
  const surfaceFailures = [];
  for (let n = 1; n <= maxLayer; n++) {
    const segs = segments.get(n);
    if (!segs) continue;
    let w = 0, cx = 0, cy = 0;
    for (const s of segs) { cx += s[1] * s[3]; cy += s[2] * s[3]; w += s[3]; }
    cx /= w; cy /= w;
    const bin = s => Math.floor(((Math.atan2(s[2] - cy, s[1] - cx) + Math.PI) / (2 * Math.PI)) * 180) % 180;
    const far = new Array(180).fill(-1), owner = new Array(180).fill(-1);
    for (const s of segs) { const b = bin(s), r = Math.hypot(s[1] - cx, s[2] - cy); if (r > far[b]) { far[b] = r; owner[b] = s[0]; } }
    const l = {};
    for (const t of owner) if (t >= 0) l[t] = (l[t] || 0) + 1;
    surfaceChecked += 1;
    const total = Object.values(l).reduce((a, b) => a + b, 0), wanted = wantedTool(n), foreign = total - (l[wanted] || 0);
    if (foreign) layersWithAnyForeignSector += 1;
    minOccupied = Math.min(minOccupied, total);
    if (total < MIN_SECTORS) layersUnder90Percent += 1;
    if (foreign > 0.05 * total || total < MIN_SECTORS) surfaceFailures.push({layer: n, wanted, occupiedSectors: total, sectorsPerTool: l});
    else surfacePassed += 1;
  }

  // The slicer's own summary lines (estimated time, filament, tool changes).
  const header = gcode.split('\n').filter(line => /^; (estimated printing time|total filament|filament used|total toolchanges|total filament change|filament_density|filament_diameter|prime_volume|enable_prime_tower|layer_height|initial_layer_print_height|mmu_segmented_region)/.test(line)).map(s => s.trim());
  const density = (/^; filament_density = (.*)$/m.exec(gcode)?.[1] || '').split(',').map(Number);
  const diameter = (/^; filament_diameter = (.*)$/m.exec(gcode)?.[1] || '').split(',').map(Number);
  const grams = (tool, mm) => {
    const d = diameter[tool] || diameter[0] || 1.75, rho = density[tool] || density[0] || 1.24;
    return Math.PI * (d / 2) ** 2 * mm / 1000 * rho;
  };
  const towerGrams = Object.entries(towerE).reduce((a, [k, v]) => a + grams(Number(k), v), 0);
  const report = {file, first, height, checkedAt: new Date().toISOString(), layersWithOuterWall: layers.size, highestLayer: maxLayer,
    layersChecked: checked, layersPassed: passed, layersFailing: failures.length,
    colourOnlyView: {layersFailing: colourFailures.length, worstStrayShare: Math.max(0, ...colourFailures.map(f => f.strayShare)), failingLayers: colourFailures.map(f => f.layer).slice(0, 300)},
    layersAboveFirstWithoutOuterWall: missing.length,
    offGridZValues: [...offGrid].slice(0, 20), toolChangesCounted: toolChanges,
    towerGramsComputed: Number(towerGrams.toFixed(2)), towerFilamentMmPerTool: Object.fromEntries(Object.entries(towerE).map(([k, v]) => [k, Number(v.toFixed(1))])),
    filamentMmPerTool: Object.fromEntries(Object.entries(allE).map(([k, v]) => [k, Number(v.toFixed(1))])),
    slicerSummary: header, firstFailures: failures.slice(0, 10),
    outermostPathView: {layersChecked: surfaceChecked, layersPassed: surfacePassed, layersFailing: surfaceFailures.length, layersWithAnyForeignSector, fewestOccupiedSectors: minOccupied, layersWithFewerThan162Sectors: layersUnder90Percent, failingLayers: surfaceFailures.map(f => f.layer).slice(0, 200), firstFailures: surfaceFailures.slice(0, 10)}};
  writeFileSync(`${file}.check.json`, JSON.stringify(report, null, 2));
  console.log(`${checked} layers checked, ${passed} pass, ${failures.length} fail` + (missing.length ? `, ${missing.length} layers above the first have no outer wall` : ''));
  for (const f of failures.slice(0, 10)) console.log(`  layer ${f.layer} (z ${f.z}): wanted T${f.wanted}, outer-wall mm ${JSON.stringify(f.lengths)}`);
  console.log(`colour-only view (T3 ignored): ${colourFailures.length} of ${checked} layers have another colour reel above 5%` + (colourFailures.length ? `, worst stray share ${Math.max(...colourFailures.map(f => f.strayShare))}` : ''));
  console.log(`outermost-path view (secondary): ${surfaceChecked} checked, ${surfacePassed} pass, ${surfaceFailures.length} fail, ${layersWithAnyForeignSector} with at least one foreign sector, fewest occupied sectors ${minOccupied}/180 (${layersUnder90Percent} layers under ${MIN_SECTORS})`);
  for (const f of surfaceFailures.slice(0, 10)) console.log(`  layer ${f.layer}: wanted T${f.wanted}, ${f.occupiedSectors} sectors occupied, per tool ${JSON.stringify(f.sectorsPerTool)}`);
  console.log(JSON.stringify({toolChangesCounted: toolChanges, towerGramsComputed: report.towerGramsComputed, slicerSummary: header}, null, 2));
  if (failures.length || !checked) process.exitCode = 1;
}

const args = process.argv.slice(2);
if (args.includes('--model')) await modelMode(args);
else fixedPattern();
