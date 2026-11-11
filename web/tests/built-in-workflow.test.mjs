// Built-in colours (experimental) through the recolour page's worker: the export branch,
// its refusals, a PETG support reel, the preview colours and the shallow-surface share,
// and that slicer-blend exports are unchanged from before the choice existed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readZip} from '../zip.js';
import * as paint from '../shared/paint.js';
import {readProject, analyse, previewSoup} from '../shared/project.js';
import {BUILT_IN_PATH, BUILT_IN_LAYERS, BUILT_IN_FIRST_LAYER, BUILT_IN_DEPTH} from '../shared/builtInColours.js';
import {builtInFaceColour, shallowShare} from '../shared/builtInPreview.js';
import {builtInPlan, defaultBackingSlot, builtInFixed} from '../shared/builtInWorkflow.js';
import {reelSet} from '../../tools/export-built-in.mjs';

const dec = new TextDecoder();
const SOURCE = new Uint8Array(readFileSync(new URL('./four-colours.3mf', import.meta.url)));
const project = readProject(await readZip(SOURCE), {allowNegative: true, allowModifiers: true});
const PLATE = project.plates[0].id;
const sources = analyse(project, PLATE, null).sourceColors;

// Object UUIDs are random per export; a counter (reset for each baseline case, as when the
// baselines were captured) makes whole exports comparable byte for byte.
let uuids = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {value: () => `00000000-0000-4000-8000-${String(++uuids).padStart(12, '0')}`, configurable: true});
const replies = [];
globalThis.self = {postMessage: message => replies.push(message)};
await import('../shared/recolour-worker.js');
let id = 0;
async function request(data) {
  const n = ++id;
  await self.onmessage({data: {...data, id: n}});
  return replies.findLast(reply => reply.id === n && reply.type !== 'progress');
}
const loaded = await request({type: 'load', bytes: SOURCE.buffer.slice(0)});
assert.equal(loaded.type, 'loaded', loaded.message);

const CMYW = reelSet('cmyw');
const PETG = [...CMYW.slice(0, 3), {color: '#FFFFFF', type: 'PETG', name: 'PETG interface', role: 'support-interface'}];

/** The options the page sends for a built-in export with these reels. */
function builtInOptions(reels, extra = {}) {
  const plan = builtInPlan(sources, reels);
  return {plan, options: {target: 'snapmaker', reels, physical: reels, mapping: plan.mapping, recipes: [], title: 'Built-in test',
    u1Nozzle: 'auto', layout: null, bambuSetup: null, preserveSourceSettings: true, calibration: null, layerHeight: null,
    supportInterface: false, subdivideMixLayer: false, dualWall: null,
    builtIn: {recipes: plan.recipes, backingSlot: defaultBackingSlot(reels), ...builtInFixed()}, ...extra}};
}
const states = entries => {
  const found = new Set();
  for (const [name, data] of entries) {
    if (!name.endsWith('.model')) continue;
    for (const m of dec.decode(data).matchAll(/(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/g))
      for (const s of paint.walkStates(paint.decode(m[1]))) found.add(s);
  }
  return found;
};
const settingsOf = entries => JSON.parse(dec.decode(entries.get('Metadata/project_settings.config')));

test('a built-in export holds four filaments, the record, and paint in reels 1 to 4 only', async () => {
  const {plan, options} = builtInOptions(CMYW);
  assert.ok(plan.shades >= 2, 'the four source colours need more than one shade');
  const reply = await request({type: 'export', plateId: PLATE, objects: null, options});
  assert.equal(reply.type, 'exported', reply.message);
  assert.equal(reply.dualWall, null);
  const entries = await readZip(new Uint8Array(reply.bytes));
  const cfg = settingsOf(entries);
  assert.equal(cfg.filament_colour.length, 4);
  assert.equal(cfg.layer_height, String(BUILT_IN_LAYERS.standard));
  assert.equal(cfg.initial_layer_print_height, String(BUILT_IN_FIRST_LAYER));
  const found = states(entries);
  assert.ok(found.size > 1, 'more than one reel is painted');
  assert.ok([...found].every(s => s >= 1 && s <= 4), [...found].join());
  const records = [...entries.keys()].filter(name => name === BUILT_IN_PATH);
  assert.equal(records.length, 1);
  const record = JSON.parse(dec.decode(entries.get(BUILT_IN_PATH)));
  assert.deepEqual(record, reply.builtIn, 'the reply carries the record written into the file');
  assert.equal(record.schema, 'yab3d-built-in-colours');
  assert.equal(record.layerHeight, 0.12);
  assert.equal(record.firstLayer, 0.2);
  assert.equal(record.outerDepth, BUILT_IN_DEPTH.standard);
  assert.equal(record.backingSlot, 4, 'white is the lightest reel');
  assert.deepEqual(record.validation, {sliced: false, printed: false});
  assert.ok(record.recipes.every(r => r.estimated === true));
  // Each source's recipe is the one the plan mapped it to.
  for (const row of plan.rows) assert.deepEqual(record.recipes.find(r => r.id === row.recipe).sequence, row.sequence);
  assert.ok(!entries.has('Metadata/YAB3D_dual_wall.json'));
});

test('built-in and dual-wall are never applied together', async () => {
  const {options} = builtInOptions(CMYW, {dualWall: {slot: 4, depth: 0.45}});
  const reply = await request({type: 'export', plateId: PLATE, objects: null, options});
  assert.equal(reply.type, 'error');
  assert.equal(reply.message, 'Dual-wall mixing is not available with built-in colours yet.');
});

test('a Bambu target is refused in plain words', async () => {
  const {options} = builtInOptions(CMYW, {target: 'bambu'});
  const reply = await request({type: 'export', plateId: PLATE, objects: null, options});
  assert.equal(reply.type, 'error');
  assert.equal(reply.message, 'Built-in colours currently exports for the Snapmaker U1 only.');
});

test('the engine refusal for the interior reel reaches the page as written', async () => {
  const {options} = builtInOptions(PETG, {supportInterface: true});
  options.builtIn = {...options.builtIn, backingSlot: 4};
  const reply = await request({type: 'export', plateId: PLATE, objects: null, options});
  assert.equal(reply.type, 'error');
  assert.equal(reply.message, 'Choose one of the model reels for the interior.');
});

test('with a PETG support reel the bands use only the three model reels', async () => {
  assert.equal(defaultBackingSlot(PETG), 3, 'the lightest model reel, never the PETG one');
  const {plan, options} = builtInOptions(PETG, {supportInterface: true});
  assert.ok(plan.recipes.every(r => !r.sequence.includes(4)), 'no recipe uses the support reel');
  const reply = await request({type: 'export', plateId: PLATE, objects: null, options});
  assert.equal(reply.type, 'exported', reply.message);
  const entries = await readZip(new Uint8Array(reply.bytes));
  const found = states(entries);
  assert.ok(found.size > 0);
  assert.ok(!found.has(4), `no strip in slot 4: ${[...found].join()}`);
  assert.ok([...found].every(s => s >= 1 && s <= 3));
  assert.notEqual(reply.builtIn.backingSlot, 4);
  const parts = dec.decode(entries.get('Metadata/model_settings.config'));
  assert.ok(![...parts.matchAll(/key="extruder" value="(\d+)"/g)].some(m => m[1] === '4'), 'no part prints in the support reel');

  // The same model as a slicer-blend export with the same reels: identical support settings.
  const slicer = await request({type: 'export', plateId: PLATE, objects: null, options: {...options, builtIn: undefined,
    mapping: Object.fromEntries(Object.keys(sources).map(s => [s, 1]))}});
  assert.equal(slicer.type, 'exported', slicer.message);
  const reference = settingsOf(await readZip(new Uint8Array(slicer.bytes)));
  const cfg = settingsOf(entries);
  const support = Object.keys(reference).filter(k => /^(?:enable_support|support_|raft_|wipe_tower_filament|enable_prime_tower)/.test(k));
  assert.ok(support.includes('support_interface_filament'));
  for (const key of support) assert.deepEqual(cfg[key], reference[key], key);
  assert.equal(cfg.support_interface_filament, '4');
});

test('the preview colours each face by its own normal and bed height, and the shallow share is measured', async () => {
  const {plan} = builtInOptions(CMYW);
  const spec = {recipes: plan.recipes, mapping: plan.mapping, reels: CMYW.map(r => r.color), layerHeight: BUILT_IN_LAYERS.standard, firstLayer: BUILT_IN_FIRST_LAYER};
  const reply = await request({type: 'preview', plateId: PLATE, objects: null, mode: 'result', colors: {}, mapping: null, builtIn: spec});
  assert.equal(reply.type, 'preview', reply.message);
  const {positions, colors, sourceStates, pickRanges} = reply.preview;
  const byId = new Map(plan.recipes.map(r => [r.id, r]));
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  let checked = 0;
  for (const range of pickRanges) {
    let low = Infinity;
    for (let v = range.start; v < range.start + range.count; v++) low = Math.min(low, positions[3 * v + 2]);
    for (let f = range.start / 3; f < (range.start + range.count) / 3; f++) {
      const p = [0, 1, 2].map(k => [0, 1, 2].map(c => positions[9 * f + 3 * k + c]));
      const u = p[1].map((x, c) => x - p[0][c]), w = p[2].map((x, c) => x - p[0][c]);
      const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const zs = p.map(q => q[2] - low);
      const recipe = byId.get(plan.mapping[sourceStates[f] || 1]);
      const want = builtInFaceColour({normal, zMid: (zs[0] + zs[1] + zs[2]) / 3, zHigh: Math.max(...zs), zLow: Math.min(...zs), recipe,
        reels: CMYW, firstLayer: BUILT_IN_FIRST_LAYER, layerHeight: BUILT_IN_LAYERS.standard});
      const got = [0, 1, 2].map(c => colors[9 * f + c]);
      rgb(want).forEach((x, c) => assert.ok(Math.abs(x - got[c]) < 1e-6, `face ${f}: ${want}`));
      checked += 1;
    }
  }
  assert.ok(checked > 0);
  // The share comes from the whole selection's own faces, before preview simplification.
  const soup = previewSoup(project, PLATE, null, {}, null, Infinity, {full: true});
  const faces = [];
  for (let f = 0; f < soup.triangles; f++) {
    if (soup.states[f] < 0) continue;
    const q = [0, 1, 2].map(k => [0, 1, 2].map(c => soup.positions[9 * f + 3 * k + c]));
    const u = q[1].map((x, c) => x - q[0][c]), w = q[2].map((x, c) => x - q[0][c]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    faces.push({normal: n, area: Math.hypot(...n) / 2});
  }
  assert.ok(Math.abs(reply.preview.builtIn.shallowShare - shallowShare(faces)) < 1e-9);

  // Slicer-blend previews carry no built-in fields.
  const plain = await request({type: 'preview', plateId: PLATE, objects: null, mode: 'result', colors: {1: '#00FF00'}, mapping: null});
  assert.equal(plain.type, 'preview', plain.message);
  assert.equal(plain.preview.builtIn, undefined);
});

test('slicer-blend export options produce the same bytes as before this change', async () => {
  // The baseline files were written by the worker at commit 0b4d051 from these same
  // requests, by tools/capture-slicer-blend-baseline.mjs run on `git archive 0b4d051 web`
  // (see slicer-blend-baseline.json). The ZIP container carries the time of writing, so
  // every member is compared, name for name and byte for byte.
  const spec = JSON.parse(readFileSync(new URL('./slicer-blend-baseline.json', import.meta.url), 'utf8'));
  assert.equal(spec.cases.length, 2);
  for (const c of spec.cases) {
    uuids = 0;
    const thumb = await request({type: 'thumbnail', plateId: c.plateId, objects: c.objects, colors: c.thumbnail.colors, mapping: c.thumbnail.mapping, size: 512, small: 128});
    assert.equal(thumb.type, 'thumbnail', thumb.message);
    const reply = await request({type: 'export', plateId: c.plateId, objects: c.objects, options: {...c.options, thumbnails: {main: thumb.main, small: thumb.small}}});
    assert.equal(reply.type, 'exported', reply.message);
    assert.equal(reply.builtIn, null, c.name);
    const now = await readZip(new Uint8Array(reply.bytes));
    const before = await readZip(new Uint8Array(readFileSync(new URL(`./${c.file}`, import.meta.url))));
    assert.deepEqual([...now.keys()], [...before.keys()], c.name);
    for (const [name, data] of before) assert.ok(Buffer.from(now.get(name)).equals(Buffer.from(data)), `${c.name}: ${name} changed`);
  }
});

test('a session saved before built-in colours restores as Slicer blends with no backing reel', async () => {
  const {sessionBuiltInSettings} = await import('../shared/builtInWorkflow.js');
  assert.deepEqual(sessionBuiltInSettings({target: 'snapmaker'}), {construction: 'slicer', builtInBacking: null});
  assert.deepEqual(sessionBuiltInSettings(undefined), {construction: 'slicer', builtInBacking: null});
  assert.deepEqual(sessionBuiltInSettings({construction: 'built-in', builtInBacking: 3}), {construction: 'built-in', builtInBacking: 3});
  assert.deepEqual(sessionBuiltInSettings({construction: 'something else', builtInBacking: 'x'}), {construction: 'slicer', builtInBacking: null});
  // The page applies it after the saved state, so whatever mode is current is not kept.
  const page = readFileSync(new URL('../recolour.js', import.meta.url), 'utf8');
  const restore = page.slice(page.indexOf('export function workbenchRestoreSettings'));
  assert.match(restore.slice(0, restore.indexOf('\n')), /Object\.assign\(state,saved\.state,sessionBuiltInSettings\(saved\.state\)\)/);
});
