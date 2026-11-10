// Throwaway spike checker (built-in colours, Task 2). Modelled on
// tools/check-ordered-wall-toolpaths.mjs.
//
//   node tools/check-built-in-toolpaths.mjs <gcode> <first> <height>
//
// For every layer above the first, among extrusions typed "Outer wall", the tool
// with the most extruded length must be [0,1,2][layer % 3], and no other tool may
// exceed 5% of that layer's outer-wall length. Layer n is the one whose top is at
// first + n * height. Prints pass/fail counts and the first ten failures, and
// writes <gcode>.check.json beside the G-code.
import {readFileSync, writeFileSync} from 'node:fs';

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
