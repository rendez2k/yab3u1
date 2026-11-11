// Built-in colours (experimental): the preview shows, on every flat face, the same reel the
// export writes into that face's paint, with and without a mirrored placement; the
// shallow-surface pass costs nothing in Slicer blends mode; the nozzle's layer limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readZip, writeZip} from '../zip.js';
import {readProject, exportProject} from '../shared/project.js';
import {applyBuiltInColours} from '../shared/builtInColours.js';
import {builtInExportOptions} from '../shared/builtInWorkflow.js';
import * as paint from '../shared/paint.js';
import {BUILT_IN_LAYERS, BUILT_IN_FIRST_LAYER} from '../shared/builtInColours.js';
import {builtInPlan, defaultBackingSlot, builtInFixed, profileLayerChoice, builtInNozzleProblem} from '../shared/builtInWorkflow.js';
import {buildU1Profile, matchU1Profile, resolveLayerHeight} from '../shared/u1Profiles.js';
import {reelSet} from '../../tools/export-built-in.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const REELS = reelSet('cmyw');
const NOZZLE = 'Built-in colours has only been checked with the 0.4 mm nozzle. Choose the 0.4 mm nozzle.';
const LIMITS = 'Built-in colours uses 0.12 mm layers and a 0.2 mm first layer, which this nozzle profile does not allow. Choose the 0.4 mm nozzle.';

/** Two boxes in one green part: A from 0 to 1 mm, B from 0.5 to 1.5 mm, so flat faces face
 * up at 1 and 1.5 mm and down at 0 and 0.5 mm. Placed by `transform`. */
async function boxes(transform) {
  const vertices = [], triangles = [];
  const box = (x0, x1, z0, z1) => {
    const b = vertices.length;
    for (const z of [z0, z1]) for (const [x, y] of [[x0, 0], [x1, 0], [x1, 10], [x0, 10]]) vertices.push([x, y, z]);
    // Outward winding: bottom (down), top (up), four sides.
    for (const [p, q, r] of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]])
      triangles.push([b + p, b + q, b + r]);
  };
  box(0, 10, 0, 1); box(20, 30, 0.5, 1.5);
  const mesh = `<object id="2" type="model"><mesh><vertices>${vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices>`
    + `<triangles>${triangles.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('')}</triangles></mesh></object>`;
  const model = '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter"><resources>'
    + `${mesh}<object id="1" type="model"><components><component objectid="2"/></components></object></resources>`
    + `<build><item objectid="1" transform="${transform}"/></build></model>`;
  const config = '<config><object id="1"><metadata key="name" value="Steps"/><metadata key="extruder" value="1"/>'
    + '<part id="2" subtype="normal_part"><metadata key="name" value="body"/><metadata key="extruder" value="1"/></part></object>'
    + '<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance></plate></config>';
  return writeZip([
    {name: '3D/3dmodel.model', data: enc.encode(model)},
    {name: 'Metadata/project_settings.config', data: enc.encode(JSON.stringify({filament_colour: ['#00FF00'], filament_type: ['PLA']}))},
    {name: 'Metadata/model_settings.config', data: enc.encode(config)},
  ]);
}

const replies = [];
globalThis.self = {postMessage: message => replies.push(message)};
await import('../shared/recolour-worker.js');
let id = 0;
async function request(data) {
  const n = ++id;
  await self.onmessage({data: {...data, id: n}});
  return replies.findLast(reply => reply.id === n && reply.type !== 'progress');
}

const plan = builtInPlan({1: '#00FF00'}, REELS);
const fixed = builtInFixed();
const spec = {recipes: plan.recipes, mapping: plan.mapping, reels: REELS.map(r => r.color), layerHeight: fixed.layerHeight, firstLayer: fixed.firstLayer};
const options = (extra = {}) => ({target: 'snapmaker', reels: REELS, physical: REELS, mapping: plan.mapping, recipes: [], title: 'Steps', u1Nozzle: 'auto',
  layout: null, preserveSourceSettings: true, layerHeight: null, supportInterface: false, subdivideMixLayer: false, dualWall: null,
  builtIn: {recipes: plan.recipes, backingSlot: defaultBackingSlot(REELS), ...fixed}, ...extra});

/** Reel by flat-face height (mm above the bed): from the preview, and from the exported paint. */
async function flatReels(transform) {
  const bytes = await boxes(transform);
  assert.equal((await request({type: 'load', bytes: bytes.buffer.slice(0)})).type, 'loaded');
  const shown = await request({type: 'preview', plateId: 1, objects: null, mode: 'result', colors: {}, mapping: null, builtIn: spec});
  assert.equal(shown.type, 'preview', shown.message);
  const {positions, colors, pickRanges} = shown.preview;
  let low = Infinity;
  for (let i = 2; i < positions.length; i += 3) low = Math.min(low, positions[i]);
  const hex = f => `#${[0, 1, 2].map(c => Math.round(colors[9 * f + c] * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const preview = new Map();
  assert.equal(pickRanges.length, 1);
  for (let f = 0; f < positions.length / 9; f++) {
    const z = [2, 5, 8].map(k => positions[9 * f + k] - low);
    if (Math.max(...z) - Math.min(...z) > 1e-6) continue;
    const reel = REELS.findIndex(r => r.color.toUpperCase() === hex(f)) + 1;
    assert.ok(reel > 0, `flat face ${f} shows ${hex(f)}, not a single reel`);
    const key = z[0].toFixed(3);
    assert.ok(!preview.has(key) || preview.get(key) === reel, `two reels shown at ${key} mm`);
    preview.set(key, reel);
  }
  const out = await request({type: 'export', plateId: 1, objects: null, options: options()});
  assert.equal(out.type, 'exported', out.message);
  const entries = await readZip(new Uint8Array(out.bytes));
  const exported = new Map();
  for (const [name, data] of entries) {
    if (!name.endsWith('.model')) continue;
    const text = dec.decode(data);
    for (const body of text.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)) {
      const vs = [...body[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map(m => Number(m[3]));
      for (const t of body[1].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"[^>]*?paint_color="([0-9A-F]+)"/g)) {
        const z = [t[1], t[2], t[3]].map(i => vs[Number(i)]);
        if (Math.max(...z) - Math.min(...z) > 1e-6) continue;
        const node = paint.decode(t[4]);
        assert.equal(node.kind, 'leaf');
        const key = z[0].toFixed(3);
        assert.ok(!exported.has(key) || exported.get(key) === node.state, `two reels exported at ${key} mm`);
        exported.set(key, node.state);
      }
    }
  }
  return {preview, exported};
}

test('the flat-face rule matters here: the green recipe alternates reels layer by layer', () => {
  assert.equal(plan.recipes.length, 1);
  const s = plan.recipes[0].sequence;
  assert.ok(s.length >= 2 && new Set(s).size >= 2, s.join());
  // Up at 1 mm tops layer 7, down at 0.5 mm bottoms layer 4; read the other way they would be 8 and 3.
  for (const [a, b] of [[7, 8], [4, 3], [11, 12]]) assert.notEqual(s[a % s.length], s[b % s.length]);
});

test('Slicer blends previews do not measure the shallow share; built-in previews do', async () => {
  const bytes = await boxes('1 0 0 0 1 0 0 0 1 100 100 0');
  assert.equal((await request({type: 'load', bytes: bytes.buffer.slice(0)})).type, 'loaded');
  const plain = await request({type: 'preview', plateId: 1, objects: null, mode: 'result', colors: {1: '#00FF00'}, mapping: null});
  assert.equal(plain.type, 'preview', plain.message);
  assert.equal(plain.preview.builtIn, undefined);
  assert.equal(self.__shallowPasses || 0, 0, 'no shallow pass while built-in colours is off');
  const built = await request({type: 'preview', plateId: 1, objects: null, mode: 'result', colors: {}, mapping: null, builtIn: spec});
  assert.equal(self.__shallowPasses, 1);
  // Four of the twelve faces of each box are flat (top and bottom), by area 200 of 200 + 4 * 10 + 4 * 10 per box.
  assert.ok(Math.abs(built.preview.builtIn.shallowShare - 400 / (400 + 2 * (20 + 20))) < 1e-6, String(built.preview.builtIn.shallowShare));
  await request({type: 'preview', plateId: 1, objects: null, mode: 'result', colors: {}, mapping: null, builtIn: spec});
  assert.equal(self.__shallowPasses, 1, 'measured once per object');
});

for (const [name, transform] of [['unmirrored', '1 0 0 0 1 0 0 0 1 100 100 0'], ['mirrored', '-1 0 0 0 1 0 0 0 1 140 100 0']]) {
  test(`the preview shows the exported reel on every flat face (${name})`, async () => {
    const {preview, exported} = await flatReels(transform);
    assert.deepEqual([...preview.keys()].sort(), ['0.000', '0.500', '1.000', '1.500']);
    assert.deepEqual([...exported.keys()].sort(), ['0.000', '0.500', '1.000', '1.500']);
    for (const [z, reel] of exported) assert.equal(preview.get(z), reel, `${z} mm`);
  });
}

test('only the 0.4 mm nozzle is accepted; layer limits that exclude the heights are refused too', async () => {
  const bytes = await boxes('1 0 0 0 1 0 0 0 1 100 100 0');
  assert.equal((await request({type: 'load', bytes: bytes.buffer.slice(0)})).type, 'loaded');
  for (const nozzle of ['0.8', '0.6', '0.2']) {
    const reply = await request({type: 'export', plateId: 1, objects: null, options: options({u1Nozzle: nozzle})});
    assert.equal(reply.type, 'error', nozzle);
    assert.equal(reply.message, NOZZLE, nozzle);
    assert.equal(builtInNozzleProblem({}, nozzle), NOZZLE);
  }
  for (const nozzle of ['0.4', 'auto']) {
    const reply = await request({type: 'export', plateId: 1, objects: null, options: options({u1Nozzle: nozzle})});
    assert.equal(reply.type, 'exported', `${nozzle}: ${reply.message}`);
    const cfg = JSON.parse(dec.decode((await readZip(new Uint8Array(reply.bytes))).get('Metadata/project_settings.config')));
    assert.deepEqual([...new Set(cfg.nozzle_diameter)], ['0.4']);
    assert.equal(builtInNozzleProblem({}, nozzle), '');
  }
  // `auto` follows the source's own nozzle, as the export does.
  assert.equal(builtInNozzleProblem({nozzle_diameter: ['0.8']}, 'auto'), NOZZLE);
  assert.equal(builtInNozzleProblem({nozzle_diameter: ['0.6']}, 'auto'), NOZZLE);
  assert.equal(builtInNozzleProblem({nozzle_diameter: ['0.4']}, 'auto'), '');

  // A 0.4 mm project whose profile limits still exclude the heights keeps the layer-limit refusal.
  const source = readProject(await readZip(bytes), {allowNegative: true, allowModifiers: true});
  const built = exportProject(source, 1, null, builtInExportOptions(options({u1Nozzle: '0.4'})));
  assert.deepEqual(built.problems, []);
  const name = 'Metadata/project_settings.config', cfg = JSON.parse(dec.decode(built.entries.get(name)));
  cfg.max_layer_height = cfg.max_layer_height.map(() => '0.1');
  built.entries.set(name, enc.encode(JSON.stringify(cfg)));
  const before = new Map(built.entries);
  assert.throws(() => applyBuiltInColours(built.entries, {target: 'snapmaker', reels: REELS, recipes: plan.recipes, backingSlot: 4, ...fixed}), {message: LIMITS});
  assert.deepEqual([...built.entries.keys()], [...before.keys()], 'a refusal changes nothing');
});

test('in built-in mode the hidden layer-height choice is not validated', () => {
  // The page's export settings check: the U1 profile, then each object's layer height.
  const check = builtIn => {
    const choice = profileLayerChoice(builtIn, {mode: 'custom', value: '0.01'});
    const profile = buildU1Profile({layer_height: '0.2'}, ['PLA'], '0.4', {layerHeight: choice});
    return resolveLayerHeight({layer_height: '0.2'}, profile.match, choice);
  };
  assert.throws(() => check(false), /Custom layer height must be/);
  assert.doesNotThrow(() => check(true));
  assert.equal(profileLayerChoice(true, {mode: 'custom', value: '0.01'}), undefined);
  assert.ok(matchU1Profile({}, '0.4').minLayer > 0.01);
});

test('the engine refusal also reaches the multi-plate print jobs', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('./five-colours.3mf', import.meta.url)));
  assert.equal((await request({type: 'load', bytes: bytes.buffer.slice(0), light: true})).type, 'loaded');
  const jobs = [{plateId: 2, name: 'Two', assignmentMode: 'slots', autoSlots: true, layout: {copies: 1, tower: false, spacing: 5}}];
  const run = u1Nozzle => request({type: 'export-plates', format: 'zip', jobs,
    options: {target: 'snapmaker', capacity: 4, carrySettings: false, supportMode: 'off', u1Nozzle, builtIn: {reels: REELS, backingSlot: 4, ...fixed}}});
  const refused = await run('0.8');
  assert.equal(refused.type, 'error');
  assert.equal(refused.message, `Two: ${NOZZLE}`);
  assert.equal((await run('0.4')).type, 'exported-plates');
  assert.equal(BUILT_IN_LAYERS.standard, 0.12);
  assert.equal(BUILT_IN_FIRST_LAYER, 0.2);
});
