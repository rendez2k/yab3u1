import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeZip} from '../zip.js';
import * as paint from '../shared/paint.js';
import {loadModel} from '../../tools/builtInModelReader.mjs';
import {crossSection, dropInside} from '../../tools/builtInToolpathCheck.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'tools', 'check-built-in-toolpaths.mjs');
const enc = new TextEncoder();

// A size x size x height box (outward winding), painted one reel, placed by `transform`.
async function boxModel(path, {size = 10, height = 10, reel = 1, transform = '1 0 0 0 1 0 0 0 1 0 0 0', insideOut = false} = {}) {
  const s = size / 2, v = [];
  for (const z of [0, height]) for (const [x, y] of [[-s, -s], [s, -s], [s, s], [-s, s]]) v.push([x, y, z]);
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const code = paint.encode({kind: 'leaf', state: reel});
  const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]).map(t => (insideOut ? [t[0], t[2], t[1]] : t)).map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" paint_color="${code}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>`
    + `<object id="1" type="model"><mesh><vertices>${v.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`
    + `</resources><build><item objectid="1" transform="${transform}"/></build></model>`;
  const settings = '<?xml version="1.0" encoding="UTF-8"?><config><object id="1"><metadata key="extruder" value="4"/></object></config>';
  const bytes = await writeZip([{name: '3D/3dmodel.model', data: enc.encode(model)}, {name: 'Metadata/model_settings.config', data: enc.encode(settings)}]);
  writeFileSync(path, bytes);
}

// G-code for that box at (cx, cy): first layer 0.2, then 0.2 mm layers; each layer one
// outer-wall loop 0.21 mm inside the outline, in `tool`.
function boxGcode(path, {size = 10, height = 10, cx = 100, cy = 100, tool = 0, toolAt = () => tool} = {}) {
  const lines = ['M83'];
  const s = size / 2 - 0.21, loop = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s], [cx - s, cy - s]];
  for (let n = 0, z = 0.2; z <= height + 1e-9; n++, z = Math.round((z + 0.2) * 1000) / 1000) {
    lines.push(';LAYER_CHANGE', `;Z:${z}`, `T${toolAt(n)}`, ';TYPE:Outer wall', `G1 X${loop[0][0]} Y${loop[0][1]} F3000`);
    for (const p of loop.slice(1)) lines.push(`G1 X${p[0]} Y${p[1]} E0.5`);
  }
  writeFileSync(path, lines.join('\n') + '\n');
}

const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8'});
const dir = mkdtempSync(join(tmpdir(), 'toolpath-check-'));
test.after(() => rmSync(dir, {recursive: true, force: true}));

test('a mirrored placement keeps the solid on the left of the section', async () => {
  const plain = join(dir, 'plain.3mf'), mirrored = join(dir, 'mirrored.3mf');
  await boxModel(plain, {transform: '1 0 0 0 1 0 0 0 1 100 100 0'});
  await boxModel(mirrored, {transform: '-1 0 0 0 1 0 0 0 1 100 100 0'});
  const kept = async path => {
    const m = await loadModel(path), n = m.tri.length / 3;
    const triangles = Array.from({length: n}, (_, i) => ({v: [m.tri[3 * i], m.tri[3 * i + 1], m.tri[3 * i + 2]], reel: m.reel[i], part: m.part[i]}));
    return dropInside(crossSection({vertices: m.vertices, triangles}, 5)).reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);
  };
  assert.ok(Math.abs(await kept(plain) - 40) < 1e-6);
  assert.ok(Math.abs(await kept(mirrored) - 40) < 1e-6, 'the mirrored cube keeps its whole outline');
});

test('the command line exits 0 on a pass, 1 on a fail and 2 on bad arguments', async () => {
  const model = join(dir, 'box.3mf'), good = join(dir, 'good.gcode'), bad = join(dir, 'bad.gcode');
  await boxModel(model, {transform: '1 0 0 0 1 0 0 0 1 100 100 0'});
  boxGcode(good, {tool: 0});
  boxGcode(bad, {toolAt: n => (n === 20 ? 1 : 0)});                    // one whole layer in reel 2
  const ok = run(good, '--model', model, '--json', join(dir, 'good.json'));
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PASS/);
  const fail = run(bad, '--model', model);
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.match(fail.stdout, /FAIL/);
  assert.match(fail.stdout, /layer 20 .*matched 0\.00%/);
  assert.equal(run(good).status, 2, 'fixed-pattern mode without its heights is a usage error');
  assert.equal(run(good, '--model').status, 2);
  assert.equal(run(good, '--model', model, '--every', '0').status, 2);
});

test('the command line stops when model and G-code do not line up', async () => {
  const model = join(dir, 'box2.3mf'), gcode = join(dir, 'box2.gcode');
  await boxModel(model, {transform: '1 0 0 0 1 0 0 0 1 100 100 0'});
  boxGcode(gcode, {tool: 0, cx: 101.5});                               // printed 1.5 mm to the side
  const r = run(gcode, '--model', model);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /The model and the G-code do not line up; check the plate and placement\./);
  assert.doesNotMatch(r.stdout, /PASS/);
  // The same through --offset, and back in line.
  const back = run(gcode, '--model', model, '--offset', '1.5,0,0');
  assert.equal(back.status, 0, back.stdout);
});

test('the command line fails when a part loses almost all of its outline', async () => {
  // A box wound inside out in the file itself: every outline point looks inside solid, so
  // the outline is dropped and every wall would be "hidden". The guard must fail it.
  const model = join(dir, 'inside-out.3mf'), gcode = join(dir, 'inside-out.gcode');
  await boxModel(model, {transform: '1 0 0 0 1 0 0 0 1 100 100 0', insideOut: true});
  boxGcode(gcode, {tool: 1});                                          // the wrong reel throughout
  const r = run(gcode, '--model', model);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /outline guard/i);
  assert.match(r.stdout, /part 0/);
});
