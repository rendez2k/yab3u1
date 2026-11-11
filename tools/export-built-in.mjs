// Built-in colours (experimental) from the command line, through the real export path:
// readProject -> builtInPlan (the page's planBuiltIn + alignPhases) -> exportProject (builtIn) -> applyBuiltInColours.
//
//   node tools/export-built-in.mjs <input.3mf> <output.3mf> --reels=cmyw|cmyk [--plate=<n>]
//        [--objects=<name or id, comma separated>] [--backing=<slot>] [--layer-height=<mm>]
//
// Reel sets, slots 1-4: cmyw is ELEGOO Rilievo cyan, magenta, yellow and white (the
// repository's own definitions); cmyk is the same cyan, magenta and yellow with a generic
// black PLA (#000000) in slot 4, because the repository has no ELEGOO Rilievo black. The
// interior (backing) reel defaults to the lightest model reel, as in the app: white in cmyw,
// yellow in cmyk.
// The layer height is 0.12 mm (BUILT_IN_LAYERS.standard), with a 0.2 mm first layer and a
// 0.45 mm outer colour shell. --layer-height is an unchecked experiment: only 0.12 mm has been
// toolpath-checked, and the app always uses 0.12 mm.
//
// Writes <output>.plan.json beside the output: each source colour's hex, the recipe
// sequence written for it, the estimated shade, the estimated ΔE2000 error, all marked
// estimated. Every shade is an estimate from the layer-interleaved mixing model, never a
// measurement; nothing here has been printed.
//
// Archives that expand past the reader's total limit (a project of many large objects)
// are read in two passes: everything but the mesh members first, then only the mesh
// members of the objects on the chosen plate.
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {readZip, writeZip} from '../web/zip.js';
import {readProject, exportProject, analyse, ProjectError} from '../web/shared/project.js';
import {builtInPlan, defaultBackingSlot, builtInModelSlots} from '../web/shared/builtInWorkflow.js';
import {applyBuiltInColours, BUILT_IN_LAYERS, BUILT_IN_FIRST_LAYER, BUILT_IN_DEPTH} from '../web/shared/builtInColours.js';
import {wallTestSetup} from '../web/shared/wallComparison.js';
import {norm} from '../web/shared/colour.js';

export const REEL_SETS = ['cmyw', 'cmyk'];

/** A refusal: the export code (or this tool) declined these inputs, with a message for the user. */
export class Refusal extends Error {}
// The export modules refuse with ProjectError or a plain Error; anything else (a TypeError, a file
// system error with a code) is a fault, not a refusal, and is passed on unchanged.
const asRefusal = error => (error instanceof Refusal ? error
  : (error instanceof ProjectError || error?.constructor === Error) && !error.code ? new Refusal(error.message, {cause: error}) : error);
export const GENERIC_BLACK = {name: 'black (generic, estimate)', brand: 'generic', type: 'PLA', color: '#000000',
  swatchSource: 'nominal display colour', calibration: 'unmeasured'};

/** The four reels, slots 1-4, of a reel set. */
export function reelSet(name) {
  if (!REEL_SETS.includes(name)) throw new Refusal(`Choose --reels=cmyw or cmyk (not "${name}").`);
  const elegoo = wallTestSetup({height: 0.08}).reels; // ELEGOO Rilievo cyan, magenta, yellow, white
  return name === 'cmyw' ? elegoo.map(r => ({...r})) : [...elegoo.slice(0, 3).map(r => ({...r})), {...GENERIC_BLACK}];
}

/**
 * The plan for these source colours with a reel set. sourceColours is an array of hex
 * (sources 1..n) or an object {source: hex}; weights (by source) steer the phase alignment.
 * Pure: no files.
 */
export function planFor(sourceColours, set, {weights = {}, backing} = {}) {
  const reels = reelSet(set);
  const colours = Array.isArray(sourceColours) ? Object.fromEntries(sourceColours.map((hex, i) => [i + 1, hex])) : {...sourceColours};
  // The page's own plan and default interior (builtInWorkflow.js): the lightest model reel.
  const {rows: planned, recipes} = builtInPlan(colours, reels, weights);
  const backingSlot = backing ?? defaultBackingSlot(reels);
  if (!builtInModelSlots(reels).includes(backingSlot)) throw new Refusal(`Choose a backing slot from 1 to ${reels.length}.`);
  const rows = planned.map(r => ({source: r.source, hex: norm(r.original), sequence: [...r.sequence], counts: [...r.counts],
    shade: norm(r.shade), error: r.error, recipe: r.recipe, estimated: true}));
  return {reelSet: set, reels, backingSlot, rows, recipes};
}

export const PLAN_NOTE = 'Experimental and never printed. Every shade and error below is an estimate from the layer-interleaved mixing model, '
  + 'computed from the reels’ nominal display colours, not a measurement; the real reels differ and no mixed shade has been measured. '
  + 'Flat and gently sloped areas print as single-reel bands, and beside near-flat ledges a layer’s wall can take the neighbouring layer’s reel. '
  + 'A toolpath check shows which reel the slicer puts where; it is not a check of printed colour. '
  + 'Layer heights are fixed: changing them in the slicer puts the wrong reel on each layer.';

const mm = v => Number(Number(v).toFixed(3));

/** Read a project, mesh members of the chosen objects only when the whole archive is too large. */
export async function readSource(bytes, {plate, objects} = {}) {
  let entries, partial = false;
  try {
    entries = await readZip(bytes);
  } catch (error) {
    if (!/expands to more than/.test(error.message)) throw error;
    partial = true;
    entries = await readZip(bytes, {include: n => !n.startsWith('3D/Objects/')});
  }
  let project = readProject(entries, {allowNegative: true});
  const pick = choose(project, {plate, objects});
  if (partial) {
    // The export reads every object on the plate (to place and assess the selection), so
    // the whole plate's meshes are needed, not only the chosen objects'.
    const need = new Set();
    for (const id of project.plates.find(p => p.id === pick.plateId).objectIds)
      for (const c of project.objects.get(String(id))?.components || []) if (c.path) need.add(c.path.replace(/^\//, ''));
    entries = await readZip(bytes, {include: n => !n.startsWith('3D/Objects/') || need.has(n)});
    project = readProject(entries, {allowNegative: true});
  }
  return {project, ...pick, partial};
}

function choose(project, {plate, objects}) {
  let objectIds = null;
  if (objects) {
    const names = String(objects).split(',').map(s => s.trim()).filter(Boolean);
    objectIds = names.map(name => {
      if (project.meta.has(name) || project.objects.has(name)) return name;
      const hits = [...project.meta].filter(([, m]) => m.name === name).map(([id]) => id);
      if (hits.length !== 1) throw new Refusal(hits.length ? `More than one object is called "${name}"; give its id.` : `There is no object called "${name}".`);
      return hits[0];
    });
  }
  let plateId = plate != null ? Number(plate) : null;
  if (plateId == null) {
    const found = objectIds && project.plates.find(p => (p.objectIds || []).map(String).includes(String(objectIds[0])));
    plateId = found ? found.id : project.plates[0].id;
  }
  if (!project.plates.some(p => p.id === plateId)) throw new Refusal(`There is no plate ${plateId}.`);
  return {plateId, objectIds};
}

/** The whole export: returns the zip bytes, the plan file contents and the built-in record. */
export async function exportBuiltIn(bytes, options = {}) {
  try { return await exportBuiltInUnchecked(bytes, options); } catch (error) { throw asRefusal(error); }
}

async function exportBuiltInUnchecked(bytes, {reels: set, plate, objects, backing, layerHeight = BUILT_IN_LAYERS.standard, title} = {}) {
  const {project, plateId, objectIds} = await readSource(bytes, {plate, objects});
  const analysis = analyse(project, plateId, objectIds);
  const weights = {};
  for (const o of analysis.objects.filter(o => o.selected)) for (const c of o.colours) weights[c.extruder] = (weights[c.extruder] || 0) + c.painted_triangles;
  const plan = planFor(analysis.sourceColors, set, {weights, backing});
  const mapping = Object.fromEntries(plan.rows.map(r => [r.source, r.recipe]));
  const built = exportProject(project, plateId, objectIds, {target: 'snapmaker', reels: plan.reels, recipes: [], mapping, u1Nozzle: '0.4',
    builtIn: {shades: plan.recipes.length}, title: title || `Built-in colours (experimental, ${set})`});
  if (built.problems.length) throw new Refusal(built.problems.join('\n'));
  const record = applyBuiltInColours(built.entries, {target: 'snapmaker', reels: plan.reels, recipes: plan.recipes, backingSlot: plan.backingSlot,
    depth: BUILT_IN_DEPTH.standard, layerHeight, firstLayer: BUILT_IN_FIRST_LAYER});
  const zip = await writeZip([...built.entries].map(([name, data]) => ({name, data})));
  const selected = analysis.objects.filter(o => o.selected).map(o => ({id: o.id, name: o.name, parts: o.parts, triangles: o.triangles}));
  const planFile = {
    note: PLAN_NOTE,
    reelSet: set, plate: plateId, objects: selected,
    reels: plan.reels.map((r, i) => ({slot: i + 1, name: r.name, type: r.type, color: norm(r.color)})),
    backingSlot: plan.backingSlot, layerHeight, firstLayer: BUILT_IN_FIRST_LAYER, outerDepth: BUILT_IN_DEPTH.standard,
    rows: plan.rows.map(r => ({source: r.source, hex: r.hex, sequence: r.sequence.join(''), shade: r.shade, error: r.error, recipe: r.recipe, estimated: true})),
    recipes: plan.recipes.map(r => ({id: r.id, sequence: r.sequence.join(''), color: norm(r.color), estimated: true})),
    triangles: record.triangles, layers: record.layers, reelsPerLayer: record.reelsPerLayer, overridesReplaced: record.overridesReplaced,
  };
  return {zip, plan: planFile, record};
}

function parseArgs(argv) {
  const positional = [], options = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (m) options[m[1]] = m[2];
    else if (arg.startsWith('--')) throw Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  return {positional, options};
}

async function main() {
  const usage = 'usage: node tools/export-built-in.mjs <input.3mf> <output.3mf> --reels=cmyw|cmyk [--plate=<n>] '
    + '[--objects=<name or id, comma separated>] [--backing=<slot>] [--layer-height=<mm>]\n'
    + '  --layer-height is an unchecked experiment: only 0.12 mm has been toolpath-checked, and the app always uses 0.12 mm.';
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${error.message}\n${usage}`); process.exitCode = 2; return; }
  const {positional: [input, output], options} = args;
  if (!input || !output || !options.reels) { console.error(usage); process.exitCode = 2; return; }
  const started = Date.now();
  try {
    const {zip, plan, record} = await exportBuiltIn(new Uint8Array(readFileSync(input)), {
      reels: options.reels, plate: options.plate, objects: options.objects,
      backing: options.backing != null ? Number(options.backing) : undefined,
      layerHeight: options['layer-height'] != null ? Number(options['layer-height']) : BUILT_IN_LAYERS.standard,
    });
    writeFileSync(output, zip);
    writeFileSync(`${output}.plan.json`, JSON.stringify(plan, null, 2));
    for (const r of plan.rows) console.log(`${r.hex} -> ${r.sequence} -> ${r.shade} (estimated ΔE2000 ${r.error})`);
    console.log(JSON.stringify({output, bytes: zip.length, triangles: record.triangles, layers: record.layers, recipes: record.recipes.length,
      backingSlot: record.backingSlot, layerHeight: record.layerHeight, seconds: mm((Date.now() - started) / 1000)}));
  } catch (error) {
    console.error(error instanceof Refusal ? `Refused: ${error.message}` : `Error: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
