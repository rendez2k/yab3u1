import test from 'node:test';
import assert from 'node:assert/strict';
import * as paint from '../shared/paint.js';
import { findSpecks, applySpeckCleanup, speckProblem, SPECK_PATH } from '../shared/paintSpecks.js';

const enc = new TextEncoder(), dec = new TextDecoder();
// A flat grid of squares, two faces each; `state(x, y)` gives each square's filament (null = fine paint).
function grid(n, size, state) {
  const faces = [];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const a = [x * size, y * size, 0], b = [(x + 1) * size, y * size, 0], c = [(x + 1) * size, (y + 1) * size, 0], d = [x * size, (y + 1) * size, 0], s = state(x, y);
    faces.push({ points: [a, b, c], state: s }, { points: [a, c, d], state: s });
  }
  return faces;
}
const at = (n, x, y) => [2 * (y * n + x), 2 * (y * n + x) + 1];

test('a speck narrower than a printed line takes the colour around it', () => {
  // 5 x 5 squares of 0.2 mm: the middle square is another colour.
  const faces = grid(5, 0.2, (x, y) => x === 2 && y === 2 ? 3 : 1), changes = findSpecks(faces, 0.5);
  assert.deepEqual([...changes.keys()].sort((a, b) => a - b), at(5, 2, 2)); assert.deepEqual([...new Set(changes.values())], [1]);
});
test('a patch a line or more wide is kept', () => {
  const faces = grid(5, 1, (x, y) => x === 2 && y === 2 ? 3 : 1);
  assert.equal(findSpecks(faces, 0.5).size, 0);
  // The same patch goes once the width asked for is larger than it.
  assert.equal(findSpecks(faces, 1.5).size, 2);
});
test('a speck is left alone when its surroundings are not one known colour', () => {
  // Two different colours around it.
  assert.equal(findSpecks(grid(5, 0.2, (x, y) => x === 2 && y === 2 ? 3 : x < 2 ? 1 : 2), 0.5).size, 0);
  // Fine paint next to it.
  assert.equal(findSpecks(grid(5, 0.2, (x, y) => x === 2 && y === 2 ? 3 : x === 3 && y === 2 ? null : 1), 0.5).size, 0);
  // On the open edge of the mesh.
  assert.equal(findSpecks(grid(5, 0.2, (x, y) => x === 0 && y === 2 ? 3 : 1), 0.5).size, 0);
  // The surrounding colour itself is never treated as a speck, however small the whole mesh.
  assert.equal(findSpecks(grid(3, 0.1, () => 1), 0.5).size, 0);
});
test('touching faces of one colour are judged together, even with vertices stored twice', () => {
  // A 0.2 x 0.4 mm speck across two squares: still narrow, both go.
  const faces = grid(6, 0.2, (x, y) => y === 2 && (x === 2 || x === 3) ? 4 : 2), changes = findSpecks(faces, 0.5);
  assert.equal(changes.size, 4); assert.deepEqual([...new Set(changes.values())], [2]);
  // A long thin sliver is narrow too.
  assert.equal(findSpecks(grid(12, 0.2, (x, y) => y === 5 && x > 1 && x < 10 ? 4 : 2), 0.5).size, 16);
});

function project(state) {
  const n = 5, size = 0.2, vertices = [], triangles = [];
  for (const face of grid(n, size, state)) {
    const base = vertices.length; vertices.push(...face.points);
    const text = face.state === null ? paint.encode({ kind: 'split', sides: 3, specialSide: 0, children: [1, 2, 1, 2].map(s => ({ kind: 'leaf', state: s })) }) : face.state === 6 ? '' : paint.encode({ kind: 'leaf', state: face.state });
    triangles.push(`<triangle v1="${base}" v2="${base + 1}" v3="${base + 2}"${text ? ` paint_color="${text}"` : ''}/>`);
  }
  const mesh = `<object id="1" type="model"><mesh><vertices>${vertices.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
  return new Map([['3D/3dmodel.model', enc.encode(`<model><resources>${mesh}</resources><build><item objectid="1"/></build></model>`)],
    ['Metadata/model_settings.config', enc.encode('<config><object id="1"><part id="1" subtype="normal_part"><metadata key="extruder" value="6"/></part></object></config>')]]);
}
const states = entries => [...dec.decode(entries.get('3D/3dmodel.model')).matchAll(/<triangle\b([^>]*)\/>/g)].map(m => { const p = /paint_color="([0-9A-F]+)"/i.exec(m[1]); return p ? [...new Set(paint.walkStates(paint.decode(p[1])))].join('+') : 'own'; });

test('the export rewrite repaints the speck and nothing else, and leaves geometry alone', () => {
  // The part's own filament (6, unpainted) surrounds a painted speck of 3.
  const entries = project((x, y) => x === 2 && y === 2 ? 3 : 6), before = dec.decode(entries.get('3D/3dmodel.model'));
  const report = applySpeckCleanup(entries, { width: 0.5 }), got = states(entries);
  assert.deepEqual([report.meshes, report.faces, report.specks, report.facesRepainted], [1, 50, 1, 2]);
  assert.deepEqual(at(5, 2, 2).map(i => got[i]), ['6', '6']);
  assert.equal(got.filter(s => s === 'own').length, 48);
  const strip = text => text.replace(/ paint_color="[^"]*"/g, '');
  assert.equal(strip(dec.decode(entries.get('3D/3dmodel.model'))), strip(before));
  assert.deepEqual(JSON.parse(dec.decode(entries.get(SPECK_PATH))).validation, { sliced: false, printed: false });
  // Nothing to do: the model file is untouched.
  const clean = project(() => 6), same = dec.decode(clean.get('3D/3dmodel.model'));
  assert.equal(applySpeckCleanup(clean).facesRepainted, 0); assert.equal(dec.decode(clean.get('3D/3dmodel.model')), same);
  // Fine paint beside the speck protects it.
  const guarded = project((x, y) => x === 2 && y === 2 ? 3 : x === 3 && y === 2 ? null : 6);
  assert.equal(applySpeckCleanup(guarded).facesRepainted, 0);
  assert.match(speckProblem({ width: 9 }), /0.2 to 2 mm/); assert.throws(() => applySpeckCleanup(new Map()), /native slicer project/);
});
