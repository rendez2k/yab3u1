import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as paint from '../shared/paint.js';
import {layerIndex} from '../shared/layerBands.js';
import {pieceLayer} from '../shared/flatFaceRule.js';
import {bandMesh} from '../shared/paintBands.js';
import {applyBuiltInColours, builtInProblem, BUILT_IN_PATH, BUILT_IN_DEPTH, BUILT_IN_LAYERS, BUILT_IN_FIRST_LAYER} from '../shared/builtInColours.js';
import {readZip} from '../zip.js';
import {readProject, exportProject, analyse} from '../shared/project.js';
import {planMixtures, mappingFromPlan} from '../shared/mix.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const leaf = n => paint.encode({kind: 'leaf', state: n});
const CMYW = [{color: '#00AEEF', type: 'PLA', name: 'Cyan'}, {color: '#EC008C', type: 'PLA', name: 'Magenta'},
  {color: '#FFF200', type: 'PLA', name: 'Yellow'}, {color: '#FFFFFF', type: 'PLA', name: 'White'}];
// An exported Snapmaker project gives every reel a nozzle size; built-in colours refuses a project without one.
const NOZZLES = ['0.4', '0.4', '0.4', '0.4'];
const RECIPES = [{id: 1, sequence: [1], counts: [1, 0, 0, 0], color: '#00AEEF'}, {id: 2, sequence: [1, 3], counts: [1, 0, 1, 0], color: '#7FD08A'}];
const opts = {target: 'snapmaker', reels: CMYW, recipes: RECIPES, backingSlot: 4, depth: 0.45, layerHeight: 0.1, firstLayer: 0.2};
const MEMBER = '3D/Objects/figure.model';
const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';

// One split facet: its first child (corner 0, corner 1 and the middle of the opposite side) is shade 2,
// the other is left unpainted and so takes the part's own shade (1).
const SPLIT = {kind: 'split', sides: 1, specialSide: 0, children: [{kind: 'leaf', state: 2}, {kind: 'leaf', state: 0}]};

/** The fixture: object "Figure" with a Body (shade 1) and a Hat (shade 2) wall from z = 0 to z = 1, and a modifier. */
function project({bodyExtra = '', supportsOnSplit = '', t1 = null, hatPaint = '', objectMeta = '', bodyMeta = '', projectExtra = {}, items = '<item objectid="10" transform="1 0 0 0 1 0 0 0 1 100 100 0" printable="1"/>', extraObjects = '', extraSettings = '', extraParts = ''} = {}) {
  const main = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources>
<object id="10" type="model"><components><component p:path="/${MEMBER}" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><component p:path="/${MEMBER}" objectid="2"/><component p:path="/${MEMBER}" objectid="3"/></components></object>${extraObjects}
</resources><build>${items}</build></model>`;
  const member = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources>
<object id="1" type="model"><mesh><vertices>
 <vertex x="0" y="0" z="0"/>
 <vertex x="1" y="0" z="0"/>
 <vertex x="1" y="0" z="1"/>
 <vertex x="0" y="0" z="1"/>
 <vertex x="2" y="0" z="0"/>
 <vertex x="2" y="0" z="1"/>
</vertices><triangles>
 <triangle v1="0" v2="1" v3="2"/>
 <triangle v1="0" v2="2" v3="3" ${t1 ?? `paint_color="${paint.encode(SPLIT)}" paint_seam="4"`}${supportsOnSplit}/>
 <triangle v1="1" v2="4" v3="5" paint_color="${leaf(2)}" paint_supports="8"${bodyExtra}/>
</triangles></mesh></object>
<object id="2" type="model"><mesh><vertices>
 <vertex x="3" y="0" z="0"/>
 <vertex x="4" y="0" z="0"/>
 <vertex x="4" y="0" z="1"/>
 <vertex x="3" y="0" z="1"/>
</vertices><triangles>
 <triangle v1="0" v2="1" v3="2"${hatPaint}/>
 <triangle v1="0" v2="2" v3="3"/>
</triangles></mesh></object>
<object id="3" type="model"><mesh><vertices>
 <vertex x="0" y="1" z="0"/>
 <vertex x="1" y="1" z="0"/>
 <vertex x="1" y="1" z="1"/>
</vertices><triangles>
 <triangle v1="0" v2="1" v3="2"/>
</triangles></mesh></object>
</resources><build/></model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?><config>
<object id="10"><metadata key="name" value="Figure"/><metadata key="extruder" value="1"/><metadata key="layer_height" value="0.28"/><metadata key="wall_loops" value="1"/>${objectMeta}
<part id="1" subtype="normal_part"><metadata key="name" value="Body"/><metadata key="extruder" value="1"/>${bodyMeta}</part>
<part id="2" subtype="normal_part"><metadata key="name" value="Hat"/><metadata key="extruder" value="2"/></part>
<part id="3" subtype="modifier_part"><metadata key="name" value="Strong zone"/></part>${extraParts}</object>${extraSettings}
</config>`;
  const cfg = {filament_colour: CMYW.map(r => r.color + 'FF'), filament_type: ['PLA', 'PLA', 'PLA', 'PLA'], nozzle_diameter: NOZZLES, wall_loops: '1', layer_height: '0.2',
    initial_layer_print_height: '0.3', mmu_segmented_region_max_width: '0', mixed_filament_definitions: '1,2,0,0,50', dithering_local_z_mode: '1',
    mixed_filament_advanced_dithering: '1', different_settings_to_system: ['layer_height', '', '', '', '', ''], ...projectExtra};
  return new Map([['3D/3dmodel.model', enc.encode(main)], [MEMBER, enc.encode(member)], ['Metadata/model_settings.config', enc.encode(settings)],
    ['Metadata/project_settings.config', enc.encode(JSON.stringify(cfg))], ['Metadata/layer_heights_profile.txt', enc.encode('object_id=1|0.2|0.08')]]);
}

// The paint leaves of the fixture, in model coordinates, with the shade each one prints.
const LEAVES = {
  1: [{tri: [[0, 0, 0], [1, 0, 0], [1, 0, 1]], shade: 1, face: 0},
    {tri: [[0, 0, 0], [1, 0, 1], [0.5, 0, 1]], shade: 2, face: 1},
    {tri: [[0.5, 0, 1], [0, 0, 1], [0, 0, 0]], shade: 1, face: 1},
    {tri: [[1, 0, 0], [2, 0, 0], [2, 0, 1]], shade: 2, face: 2}],
  2: [{tri: [[3, 0, 0], [4, 0, 0], [4, 0, 1]], shade: 2, face: 0}, {tri: [[3, 0, 0], [4, 0, 1], [3, 0, 1]], shade: 2, face: 1}],
};

const objectsOf = text => new Map([...text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)].map(m => [/\bid="([^"]+)"/.exec(m[1])[1], m[2]]));
const attrOf = (text, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(text)?.[1];
/** Every triangle of one mesh: corners, attributes and decoded paint. */
function triangles(body) {
  const vs = [...body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
  return [...body.matchAll(/<triangle\b([^>]*?)\/>/g)].map(m => {
    const p = ['v1', 'v2', 'v3'].map(k => vs[Number(attrOf(m[1], k))]);
    const code = attrOf(m[1], 'paint_color');
    return {p, attrs: m[1], node: code ? paint.decode(code) : null};
  });
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (u, w) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
const area = p => Math.hypot(...cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2;
const centroid = p => [0, 1, 2].map(k => (p[0][k] + p[1][k] + p[2][k]) / 3);
/** Whether a point of the wall plane y = 0 lies in a triangle of that plane (x, z), with a small tolerance. */
function inside(q, tri) {
  const [a, b, c] = tri, d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
  const l1 = ((b[0] - q[0]) * (c[2] - q[2]) - (c[0] - q[0]) * (b[2] - q[2])) / d;
  const l2 = ((c[0] - q[0]) * (a[2] - q[2]) - (a[0] - q[0]) * (c[2] - q[2])) / d;
  return Math.min(l1, l2, 1 - l1 - l2) > -1e-9;
}
/** Every output strip of the painted meshes with the shade its source leaf had and the single reel it now carries. */
function strips(entries) {
  const objects = objectsOf(dec.decode(entries.get(MEMBER))), out = [];
  for (const id of ['1', '2']) for (const t of triangles(objects.get(id))) {
    const c = centroid(t.p), from = LEAVES[id].filter(l => inside(c, l.tri));
    assert.equal(from.length, 1, `strip at ${c} lies in exactly one source leaf`);
    assert.equal(t.node.kind, 'leaf', 'every strip carries a single reel');
    out.push({...t, id, zMid: c[2], zHigh: Math.max(...t.p.map(p => p[2])), zLow: Math.min(...t.p.map(p => p[2])), shadeBefore: from[0].shade, leaf: from[0], state: t.node.state});
  }
  return out;
}
const paintStates = entries => [...entries].filter(([n]) => /^3D\/.*\.model$/.test(n))
  .flatMap(([, d]) => [...dec.decode(d).matchAll(/paint_color="([0-9A-Fa-f]*)"/g)].flatMap(m => paint.walkStates(paint.decode(m[1]))));
const snapshot = entries => Object.fromEntries([...entries].map(([k, v]) => [k, Buffer.from(v).toString('base64')]));

test('every strip carries the reel its recipe gives for that layer', () => {
  const entries = project();
  const report = applyBuiltInColours(entries, opts);
  const all = strips(entries);
  assert.ok(all.length > 6);
  const shades = new Map(RECIPES.map(r => [r.id, r]));
  for (const t of all) {
    const layer = pieceLayer({normal: cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])), zHigh: t.zHigh, zLow: t.zLow, layer: layerIndex(t.zMid, 0.2, 0.1)}, 0.2, 0.1);
    const sequence = shades.get(t.shadeBefore).sequence;
    assert.equal(t.state, sequence[layer % sequence.length], `strip at z ${t.zMid} of shade ${t.shadeBefore}`);
    assert.ok(t.zHigh - t.zLow <= 0.2 + 1e-9, 'a strip lies within one layer');
  }
  // Both reels of shade 2 are in use, on alternate layers.
  assert.deepEqual([...new Set(all.filter(t => t.shadeBefore === 2).map(t => t.state))].sort(), [1, 3]);
  assert.ok(report.triangles.after > report.triangles.before);
  assert.deepEqual(report.validation, {sliced: false, printed: false});
});

/** A stepped solid in shade 2: a wall from 0 to 1 mm, a ledge top at first + 5 * height + 0.02 and an underside at first + 5 * height + 0.08. */
function stepped(transform = '1 0 0 0 1 0 0 0 1 100 100 0') {
  const main = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources><object id="10" type="model"><components><component p:path="/3D/Objects/step.model" objectid="1"/></components></object></resources><build><item objectid="10" transform="${transform}" printable="1"/></build></model>`;
  const top = 0.2 + 5 * 0.1 + 0.02, under = 0.2 + 5 * 0.1 + 0.08;
  const v = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [1, 0, top], [2, 0, top], [2, 1, top], [1, 1, top], [1, 2, under], [2, 2, under], [2, 3, under], [1, 3, under]];
  const member = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources><object id="1" type="model"><mesh><vertices>${v.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>`
    + '<triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3"/>'                 // steep wall
    + '<triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/>'                 // ledge top, facing up
    + '<triangle v1="8" v2="10" v3="9"/><triangle v1="8" v2="11" v3="10"/>'              // underside, facing down
    + '</triangles></mesh></object></resources><build/></model>';
  const settings = '<config><object id="10"><metadata key="name" value="Step"/><metadata key="extruder" value="2"/><part id="1" subtype="normal_part"><metadata key="name" value="Step"/><metadata key="extruder" value="2"/></part></object></config>';
  const cfg = {filament_colour: CMYW.map(r => r.color + 'FF'), nozzle_diameter: NOZZLES, wall_loops: '2', different_settings_to_system: ['', '', '', '', '', '']};
  return new Map([['3D/3dmodel.model', enc.encode(main)], ['3D/Objects/step.model', enc.encode(member)],
    ['Metadata/model_settings.config', enc.encode(settings)], ['Metadata/project_settings.config', enc.encode(JSON.stringify(cfg))]]);
}
function steppedPieces(entries) {
  const body = objectsOf(dec.decode(entries.get('3D/Objects/step.model'))).get('1');
  return triangles(body).map(t => ({...t, zs: t.p.map(p => p[2]), state: t.node.state}));
}

test('a ledge top in the lower half of a band takes the reel of the layer below; a steep piece keeps its band\'s reel', () => {
  for (const transform of ['1 0 0 0 1 0 0 0 1 100 100 0', '-1 0 0 0 1 0 0 0 1 100 100 0']) {
    const entries = stepped(transform);
    applyBuiltInColours(entries, opts);
    const pieces = steppedPieces(entries), top = 0.2 + 5 * 0.1 + 0.02, under = 0.2 + 5 * 0.1 + 0.08;
    const flatTop = pieces.filter(t => t.zs.every(z => z === top)), flatUnder = pieces.filter(t => t.zs.every(z => z === under));
    assert.ok(flatTop.length >= 2 && flatUnder.length >= 2);
    // The ledge at 0.72 is in band 6 (0.7-0.8) but below its slice at 0.75: it tops layer 5, reel [1,3][5 % 2] = 3.
    assert.equal(layerIndex(top, 0.2, 0.1), 6);
    for (const t of flatTop) assert.equal(t.state, 3, `ledge top piece (${transform})`);
    // The underside at 0.78 is above band 6's slice: it is the bottom of layer 7, reel 3, not band 6's reel 1.
    for (const t of flatUnder) assert.equal(t.state, 3, `underside piece (${transform})`);
    // The wall beside them keeps its band: band 6 prints reel 1, band 5 reel 3.
    const wall = pieces.filter(t => t.p.every(p => p[1] === 0 && p[0] <= 1) && !t.zs.every(z => z === top));
    const band6 = wall.filter(t => Math.min(...t.zs) >= 0.7 - 1e-9 && Math.max(...t.zs) <= 0.8 + 1e-9);
    const band5 = wall.filter(t => Math.min(...t.zs) >= 0.6 - 1e-9 && Math.max(...t.zs) <= 0.7 + 1e-9);
    assert.ok(band6.length && band5.length);
    for (const t of band6) assert.equal(t.state, 1, `steep piece in band 6 (${transform})`);
    for (const t of band5) assert.equal(t.state, 3, `steep piece in band 5 (${transform})`);
  }
});

test('only physical reels remain in the project and the heights are fixed', () => {
  const entries = project();
  const report = applyBuiltInColours(entries, opts);
  const cfg = JSON.parse(dec.decode(entries.get('Metadata/project_settings.config')));
  assert.equal(cfg.filament_colour.length, 4);
  assert.equal(cfg.layer_height, '0.1'); assert.equal(cfg.initial_layer_print_height, '0.2');
  assert.equal(cfg.mixed_filament_definitions, ''); assert.equal(cfg.dithering_local_z_mode, '0'); assert.equal(cfg.mixed_filament_advanced_dithering, '0');
  assert.equal(cfg.mmu_segmented_region_max_width, '0.45'); assert.equal(cfg.mmu_segmented_region_interlocking_depth, '0');
  assert.equal(cfg.wall_loops, '2');
  for (const key of ['layer_height', 'initial_layer_print_height', 'mmu_segmented_region_max_width', 'mmu_segmented_region_interlocking_depth',
    'dithering_local_z_mode', 'mixed_filament_advanced_dithering', 'mixed_filament_definitions', 'wall_loops'])
    assert.ok(cfg.different_settings_to_system[0].split(';').includes(key), key);
  assert.ok(paintStates(entries).every(s => s >= 1 && s <= 4));
  // No variable layer heights and no per-object layer height can move the bands.
  assert.equal(entries.has('Metadata/layer_heights_profile.txt'), false);
  const settings = dec.decode(entries.get('Metadata/model_settings.config'));
  assert.match(settings, /<metadata key="layer_height" value="0.1"\/>/);
  assert.doesNotMatch(settings, /value="0.28"/);
  assert.deepEqual(report.settings, Object.fromEntries(Object.keys(report.settings).map(k => [k, cfg[k]])));
});

test('a filament list longer than the physical reels is cut to them', () => {
  const entries = project(), cfg = JSON.parse(dec.decode(entries.get('Metadata/project_settings.config')));
  cfg.filament_colour.push('#123456FF', '#654321FF'); cfg.filament_type.push('PLA', 'PLA');
  cfg.different_settings_to_system = ['layer_height', 'a', 'b', 'c', 'd', 'e', 'f', 'printer'];
  entries.set('Metadata/project_settings.config', enc.encode(JSON.stringify(cfg)));
  applyBuiltInColours(entries, opts);
  const after = JSON.parse(dec.decode(entries.get('Metadata/project_settings.config')));
  assert.deepEqual(after.filament_colour, CMYW.map(r => r.color + 'FF'));
  assert.deepEqual(after.filament_type, ['PLA', 'PLA', 'PLA', 'PLA']);
  assert.deepEqual(after.different_settings_to_system.slice(1), ['a', 'b', 'c', 'd', 'printer']);
});

test('parts print in the backing reel and no face is left unpainted', () => {
  const entries = project();
  applyBuiltInColours(entries, opts);
  const settings = dec.decode(entries.get('Metadata/model_settings.config'));
  assert.match(settings, /<part id="1" subtype="normal_part"><metadata key="name" value="Body"\/><metadata key="extruder" value="4"\/>/);
  assert.match(settings, /<part id="2" subtype="normal_part"><metadata key="name" value="Hat"\/><metadata key="extruder" value="4"\/>/);
  assert.match(settings, /<object id="10"><metadata key="name" value="Figure"\/><metadata key="extruder" value="4"\/>/);
  const objects = objectsOf(dec.decode(entries.get(MEMBER)));
  for (const id of ['1', '2']) for (const t of triangles(objects.get(id))) {
    assert.ok(t.node, 'every face of a printed part is painted');
    assert.equal(t.node.kind, 'leaf');
    assert.ok([1, 2, 3].includes(t.node.state), `a model reel, never the backing reel or 0 (got ${t.node.state})`);
  }
  // The modifier keeps its mesh, unpainted, exactly as it was.
  assert.equal(objects.get('3'), objectsOf(dec.decode(project().get(MEMBER))).get('3'));
});

test('a split-painted face keeps each sub-face colour through banding', () => {
  const entries = project();
  applyBuiltInColours(entries, opts);
  const all = strips(entries);
  for (const id of ['1', '2']) for (const l of LEAVES[id]) {
    const got = all.filter(t => t.id === id && t.leaf === l).reduce((s, t) => s + area(t.p), 0);
    assert.ok(Math.abs(got - area(l.tri)) < 1e-9, `leaf area ${area(l.tri)} kept (got ${got})`);
  }
  const byShade = s => all.filter(t => t.shadeBefore === s).reduce((a, t) => a + area(t.p), 0);
  assert.ok(Math.abs(byShade(1) - 0.75) < 1e-9); assert.ok(Math.abs(byShade(2) - 1.75) < 1e-9);
});

test('seam and support paint survive on every strip', () => {
  const before = triangles(objectsOf(dec.decode(project().get(MEMBER))).get('1'));
  const entries = project();
  const report = applyBuiltInColours(entries, opts);
  const all = strips(entries).filter(t => t.id === '1');
  const seams = all.filter(t => attrOf(t.attrs, 'paint_seam') !== undefined), supports = all.filter(t => attrOf(t.attrs, 'paint_supports') !== undefined);
  assert.ok(seams.length >= before.filter(t => /paint_seam/.test(t.attrs)).length);
  assert.ok(supports.length >= before.filter(t => /paint_supports/.test(t.attrs)).length);
  // Exactly the strips of the faces that carried them, with the same whole-face value.
  for (const t of all) {
    assert.equal(attrOf(t.attrs, 'paint_seam'), t.leaf.face === 1 ? '4' : undefined);
    assert.equal(attrOf(t.attrs, 'paint_supports'), t.leaf.face === 2 ? '8' : undefined);
  }
  assert.equal('seamAndSupportPaint' in report, false);
});

const node = (sides, kids, specialSide = 0) => ({kind: 'split', sides, specialSide, children: kids.map(k => (typeof k === 'number' ? {kind: 'leaf', state: k} : k))});
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
/** Whether a point lies in a triangle of any plane (barycentric, small tolerance). */
function within(q, [a, b, c]) {
  const v0 = sub(b, a), v1 = sub(c, a), v2 = sub(q, a), dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  return Math.min(1 - v - w, v, w) > -1e-9;
}

/** A 10 x 10 mm flat underside at z = 5 (two faces facing down); `first` holds the first face's extra attributes. */
function underside(first) {
  const main = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources><object id="10" type="model"><components><component p:path="/3D/Objects/under.model" objectid="1"/></components></object></resources><build><item objectid="10" transform="1 0 0 0 1 0 0 0 1 100 100 0" printable="1"/></build></model>`;
  const member = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="5"/><vertex x="10" y="10" z="5"/><vertex x="10" y="0" z="5"/><vertex x="0" y="10" z="5"/></vertices><triangles>`
    + `<triangle v1="0" v2="1" v3="2"${first}/><triangle v1="0" v2="3" v3="1"/></triangles></mesh></object></resources><build/></model>`;
  const settings = '<config><object id="10"><metadata key="name" value="Shelf"/><metadata key="extruder" value="2"/><part id="1" subtype="normal_part"><metadata key="name" value="Shelf"/><metadata key="extruder" value="2"/></part></object></config>';
  const cfg = {filament_colour: CMYW.map(r => r.color + 'FF'), nozzle_diameter: NOZZLES, wall_loops: '2', different_settings_to_system: ['', '', '', '', '', '']};
  return new Map([['3D/3dmodel.model', enc.encode(main)], ['3D/Objects/under.model', enc.encode(member)],
    ['Metadata/model_settings.config', enc.encode(settings)], ['Metadata/project_settings.config', enc.encode(JSON.stringify(cfg))]]);
}

test('a support enforcer on a quarter of a flat underside keeps exactly that quarter', () => {
  const U0 = [[0, 0, 5], [10, 10, 5], [10, 0, 5]], quarter = [U0[0], mid(U0[0], U0[1]), mid(U0[2], U0[0])];
  const entries = underside(` paint_supports="${paint.encode(node(3, [1, 0, 0, 0]))}"`);
  applyBuiltInColours(entries, opts);
  const pieces = triangles(objectsOf(dec.decode(entries.get('3D/Objects/under.model'))).get('1'));
  const enforced = pieces.filter(t => attrOf(t.attrs, 'paint_supports') !== undefined);
  assert.ok(enforced.length >= 1);
  for (const t of enforced) {
    assert.equal(attrOf(t.attrs, 'paint_supports'), leaf(1));
    assert.ok(within(centroid(t.p), quarter), 'support only inside the painted quarter');
  }
  for (const t of pieces.filter(t => !enforced.includes(t))) assert.ok(!within(centroid(t.p), quarter), 'no unsupported piece inside the quarter');
  const got = enforced.reduce((a, t) => a + area(t.p), 0);
  assert.ok(Math.abs(got - area(quarter)) < 1e-9, `support area ${area(quarter)} kept (got ${got})`);
  assert.ok(Math.abs(pieces.reduce((a, t) => a + area(t.p), 0) - 100) < 1e-9);
});

test('a seam split finer than the colour split keeps its own area', () => {
  // Colour: face 1 halved (shade 2 | shade 1). Seam: the shade-2 half split four ways, the child at its second
  // corner painted; that child's inner side is slanted, so no layer cut follows it.
  const seam = paint.encode(node(1, [node(3, [0, 1, 0, 0]), 0]));
  const entries = project({t1: `paint_color="${paint.encode(SPLIT)}" paint_seam="${seam}"`});
  applyBuiltInColours(entries, opts);
  const half = LEAVES[1][1].tri, corner = [mid(half[0], half[1]), half[1], mid(half[1], half[2])];
  const all = strips(entries).filter(t => t.id === '1'), seamed = all.filter(t => attrOf(t.attrs, 'paint_seam') !== undefined);
  assert.ok(seamed.length >= 1);
  for (const t of seamed) { assert.equal(attrOf(t.attrs, 'paint_seam'), leaf(1)); assert.ok(within(centroid(t.p), corner)); }
  for (const t of all.filter(t => !seamed.includes(t))) assert.ok(!within(centroid(t.p), corner));
  const got = seamed.reduce((a, t) => a + area(t.p), 0);
  assert.ok(Math.abs(got - area(corner)) < 1e-9, `seam area ${area(corner)} kept (got ${got})`);
  // The colours are unchanged by the seam split.
  for (const t of all) {
    const sequence = RECIPES[t.shadeBefore - 1].sequence;
    const layer = pieceLayer({normal: cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])), zHigh: t.zHigh, zLow: t.zLow, layer: layerIndex(t.zMid, 0.2, 0.1)}, 0.2, 0.1);
    assert.equal(t.state, sequence[layer % sequence.length]);
  }
});

test('a split colour face with a whole-face support value carries it on every piece', () => {
  const entries = project({supportsOnSplit: ' paint_supports="8"'});
  applyBuiltInColours(entries, opts);
  const face1 = strips(entries).filter(t => t.id === '1' && t.leaf.face === 1);
  assert.ok(face1.length > 2);
  for (const t of face1) assert.equal(attrOf(t.attrs, 'paint_supports'), '8');
  assert.ok(Math.abs(face1.reduce((a, t) => a + area(t.p), 0) - 0.5) < 1e-9);
});

test('colour, support and seam split the same face in different ways: refused by name', () => {
  const t1 = `paint_color="${paint.encode(SPLIT)}" paint_supports="${paint.encode(node(3, [1, 0, 0, 0]))}" paint_seam="${paint.encode(node(2, [1, 0, 0], 1))}"`;
  const entries = project({t1}), before = snapshot(entries);
  assert.throws(() => applyBuiltInColours(entries, opts), /"Figure" has colour, support or seam paint that divides one triangle in different ways/);
  assert.deepEqual(snapshot(entries), before);
});

test('a closed solid with split support paint stays closed by vertex index', () => {
  // A 2 x 2 x 1 mm box; its underside carries a support split two levels deep.
  const v = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0], [0, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const support = paint.encode(node(3, [1, node(1, [0, 1]), 0, 0]));
  const entries = underside('');
  entries.set('3D/Objects/under.model', enc.encode(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources><object id="1" type="model"><mesh><vertices>${v.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>`
    + f.map((t, i) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${i === 0 ? ` paint_supports="${support}"` : ''}/>`).join('') + '</triangles></mesh></object></resources><build/></model>'));
  applyBuiltInColours(entries, opts);
  const body = objectsOf(dec.decode(entries.get('3D/Objects/under.model'))).get('1');
  const tris = [...body.matchAll(/<triangle\b([^>]*?)\/>/g)].map(m => ['v1', 'v2', 'v3'].map(k => Number(attrOf(m[1], k))));
  const edges = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], key = a < b ? `${a}-${b}` : `${b}-${a}`; edges.set(key, (edges.get(key) || 0) + 1); }
  assert.ok(tris.length > 12);
  assert.deepEqual([...new Set(edges.values())], [2], 'every edge is shared by exactly two pieces');
  const pieces = triangles(body), F0 = [v[0], v[2], v[1]];
  const enforcedArea = pieces.filter(t => attrOf(t.attrs, 'paint_supports') === leaf(1)).reduce((a, t) => a + area(t.p), 0);
  assert.ok(Math.abs(enforcedArea - area(F0) * (1 / 4 + 1 / 8)) < 1e-9, `got ${enforcedArea}`);
});

test('each piece is written under its own face\'s colour attribute name', () => {
  const entries = project({hatPaint: ` mmu_segmentation="${leaf(2)}"`});
  applyBuiltInColours(entries, opts);
  const objects = objectsOf(dec.decode(entries.get(MEMBER)));
  const hat = [...objects.get('2').matchAll(/<triangle\b([^>]*?)\/>/g)].map(m => m[1]);
  const named = hat.map(a => /\smmu_segmentation="/.test(a)), plain = hat.map(a => /\spaint_color="/.test(a));
  assert.ok(named.some(Boolean) && plain.some(Boolean));
  hat.forEach((a, i) => assert.ok(named[i] !== plain[i], 'one colour attribute per piece'));
  // The pieces under the old name are exactly those of the first Hat face.
  const geometry = triangles(objects.get('2').replace(/mmu_segmentation=/g, 'paint_color='));
  geometry.forEach((t, i) => assert.equal(named[i], inside(centroid(t.p), LEAVES[2][0].tri)));
  for (const a of [...objects.get('1').matchAll(/<triangle\b([^>]*?)\/>/g)].map(m => m[1])) assert.match(a, /\spaint_color="/);
});

test('support, negative and modifier parts never keep a shade id as their filament', () => {
  const extraParts = '<part id="5" subtype="support_blocker"><metadata key="name" value="No supports"/><metadata key="extruder" value="6"/></part>'
    + '<part id="6" subtype="negative_part"><metadata key="name" value="Hole"/><metadata key="extruder" value="1"/></part>';
  const extraMesh = '<object id="5" type="model"><mesh><vertices><vertex x="0" y="3" z="0"/><vertex x="1" y="3" z="0"/><vertex x="1" y="3" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>'
    + '<object id="6" type="model"><mesh><vertices><vertex x="0" y="4" z="0"/><vertex x="1" y="4" z="0"/><vertex x="1" y="4" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>';
  const make = (mesh = extraMesh) => {
    const entries = project({extraParts});
    entries.set(MEMBER, enc.encode(dec.decode(entries.get(MEMBER)).replace('</resources>', mesh + '</resources>')));
    entries.set('3D/3dmodel.model', enc.encode(dec.decode(entries.get('3D/3dmodel.model')).replace('objectid="3"/>', `objectid="3"/><component p:path="/${MEMBER}" objectid="5"/><component p:path="/${MEMBER}" objectid="6"/>`)));
    return entries;
  };
  const entries = make();
  applyBuiltInColours(entries, opts);
  const settings = dec.decode(entries.get('Metadata/model_settings.config'));
  const extruders = [...settings.matchAll(/<metadata key="extruder" value="(\d+)"\/>/g)].map(m => Number(m[1]));
  assert.ok(extruders.length >= 5 && extruders.every(e => e >= 1 && e <= 4), `extruders ${extruders}`);
  assert.match(settings, /<part id="5" subtype="support_blocker"><metadata key="name" value="No supports"\/><metadata key="extruder" value="4"\/>/);
  assert.match(settings, /<part id="6" subtype="negative_part"><metadata key="name" value="Hole"\/><metadata key="extruder" value="4"\/>/);
  assert.match(settings, /<part id="3" subtype="modifier_part"><metadata key="name" value="Strong zone"\/><\/part>/, 'absent stays absent');
  // Colour paint on a part that prints nothing would keep a shade id: refused by name.
  const painted = extraMesh.replace('<triangle v1="0" v2="1" v3="2"/></triangles></mesh></object><object id="6"', `<triangle v1="0" v2="1" v3="2" paint_color="${leaf(6)}"/></triangles></mesh></object><object id="6"`);
  assert.throws(() => applyBuiltInColours(make(painted), opts), /"No supports" has colour paint/);
});

/** A wall 40 mm round and 6 mm tall, in long thin faces, so that banding multiplies it many times. */
function bigWall() {
  const N = 48, R = 6, pts = [], tris = [];
  for (let r = 0; r <= R; r++) for (let i = 0; i < N; i++) { const t = 2 * Math.PI * i / N; pts.push([+(20 * Math.cos(t)).toFixed(4), +(20 * Math.sin(t)).toFixed(4), r]); }
  for (let r = 0; r < R; r++) for (let i = 0; i < N; i++) { const j = (i + 1) % N, a = r * N + i, b = r * N + j; tris.push([a, b, b + N], [a, b + N, a + N]); }
  const entries = underside('');
  entries.set('3D/Objects/under.model', enc.encode(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" ${NS}><resources><object id="1" type="model"><mesh><vertices>${pts.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>`
    + tris.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('') + '</triangles></mesh></object></resources><build/></model>'));
  return {entries, faces: tris.length};
}

test('a result far too large is refused before any cutting', () => {
  const real = bigWall().entries;
  applyBuiltInColours(real, {...opts, layerHeight: 0.08});
  const size = real.get('3D/Objects/under.model').length;
  let calls = 0;
  const counting = (...args) => { calls += 1; return bandMesh(...args); };
  // At 85 % of the real size the early bound already knows; 40 bytes a band would not have.
  const limit = Math.floor(0.85 * size), {entries, faces} = bigWall();
  const bands = faces * (layerIndex(1, 0.2, 0.08) + 1);
  assert.ok(40 * bands < limit, 'the old bound would have let it through to the cut');
  assert.throws(() => applyBuiltInColours(entries, {...opts, layerHeight: 0.08, maxMemberBytes: limit, band: counting}), /too large to export/);
  assert.equal(calls, 0, 'bandMesh was not called');
  // Just over the real size it goes through, calling bandMesh once.
  applyBuiltInColours(bigWall().entries, {...opts, layerHeight: 0.08, maxMemberBytes: size + 1, band: counting});
  assert.equal(calls, 1);
});

test('per-object and per-part paint depth and layer settings are overwritten and counted', () => {
  const read = entries => dec.decode(entries.get('Metadata/model_settings.config'));
  const widths = text => [...text.matchAll(/key="mmu_segmented_region_max_width" value="([^"]*)"/g)].map(m => m[1]);
  // They Live's object width of 5, and a part of the Body with its own width and interlocking depth.
  const five = project({objectMeta: '<metadata key="mmu_segmented_region_max_width" value="5"/><metadata key="mmu_segmented_region_interlocking_depth" value="0"/>',
    bodyMeta: '<metadata key="mmu_segmented_region_max_width" value="2"/><metadata key="mmu_segmented_region_interlocking_depth" value="1"/>'});
  const a = applyBuiltInColours(five, opts), textA = read(five);
  assert.deepEqual(widths(textA), ['0.45', '0.45']);
  assert.deepEqual([...textA.matchAll(/key="mmu_segmented_region_interlocking_depth" value="([^"]*)"/g)].map(m => m[1]), ['0', '0']);
  // width 5, part width 2, part depth 1, and the object layer height 0.28; the object depth was already 0.
  assert.equal(a.overridesReplaced, 4);
  // Super Man's and Flirty's 0 (unlimited), with per-object layer and blend settings that would move the bands.
  const zero = project({objectMeta: '<metadata key="mmu_segmented_region_max_width" value="0"/><metadata key="initial_layer_print_height" value="0.3"/><metadata key="dithering_local_z_mode" value="1"/>'
    + '<metadata key="mixed_filament_advanced_dithering" value="1"/><metadata key="mixed_filament_definitions" value="1,2,0,0,50"/><metadata key="precise_z_height" value="1"/>'});
  const b = applyBuiltInColours(zero, opts), textB = read(zero);
  assert.deepEqual(widths(textB), ['0.45']);
  for (const [key, value] of [['initial_layer_print_height', '0.2'], ['dithering_local_z_mode', '0'], ['mixed_filament_advanced_dithering', '0'], ['mixed_filament_definitions', ''], ['precise_z_height', '0'], ['layer_height', '0.1']])
    assert.match(textB, new RegExp(`key="${key}" value="${value}"/>`), key);
  assert.equal(b.overridesReplaced, 7);
  const cfg = JSON.parse(dec.decode(zero.get('Metadata/project_settings.config')));
  assert.equal(cfg.precise_z_height, '0');
});

test('a raft is refused, because it lifts every layer of the model', () => {
  assert.throws(() => applyBuiltInColours(project({objectMeta: '<metadata key="raft_layers" value="2"/>'}), opts), /"Figure" prints on a raft/);
  assert.throws(() => applyBuiltInColours(project({projectExtra: {raft_layers: '3'}}), opts), /This project prints on a raft/);
  assert.ok(applyBuiltInColours(project({objectMeta: '<metadata key="raft_layers" value="0"/>'}), opts).triangles.after > 0);
});

test('a colour split whose leaves are all one shade merges with any support split', () => {
  // explicitOuterPaint turns [X, 0] into [X, X]: the same colour on both halves, split along a median.
  const t1 = `paint_color="${paint.encode(node(1, [1, 1]))}" paint_supports="${paint.encode(node(3, [1, 0, 0, 0]))}"`;
  const entries = project({t1});
  applyBuiltInColours(entries, opts);
  const T1 = LEAVES[1][1].tri.slice(0, 2).concat([LEAVES[1][2].tri[1]]);   // corners 0, 2, 3: (0,0,0), (1,0,1), (0,0,1)
  const quarter = [T1[0], mid(T1[0], T1[1]), mid(T1[2], T1[0])];
  const body = objectsOf(dec.decode(entries.get(MEMBER))).get('1');
  const pieces = triangles(body).filter(t => within(centroid(t.p), T1) && Math.abs(t.p[0][1]) < 1e-12);
  const enforced = pieces.filter(t => attrOf(t.attrs, 'paint_supports') === leaf(1));
  for (const t of enforced) assert.ok(within(centroid(t.p), quarter));
  assert.ok(Math.abs(enforced.reduce((s, t) => s + area(t.p), 0) - area(quarter)) < 1e-9);
  assert.ok(pieces.length > 2);
  for (const t of pieces) assert.equal(t.node.state, 1, 'shade 1 is reel 1 on every layer');
});


test('a mesh used twice at different tilts is refused by name', () => {
  const tiltedTwice = () => project({extraObjects: `<object id="11" type="model"><components><component p:path="/${MEMBER}" objectid="1"/></components></object>`,
    items: '<item objectid="10" transform="1 0 0 0 1 0 0 0 1 100 100 0" printable="1"/><item objectid="11" transform="1 0 0 0 0 1 0 -1 0 150 100 0" printable="1"/>',
    extraSettings: '<object id="11"><metadata key="name" value="Figure"/><metadata key="extruder" value="1"/><part id="1" subtype="normal_part"><metadata key="name" value="Body"/><metadata key="extruder" value="1"/></part></object>'});
  assert.throws(() => applyBuiltInColours(tiltedTwice(), opts), /"Figure" is placed more than once at different tilts or heights\. Built-in colours needs each copy to be its own object\./);
  // Nothing is written when it refuses.
  const entries = tiltedTwice(), before = snapshot(entries);
  assert.throws(() => applyBuiltInColours(entries, opts));
  assert.deepEqual(snapshot(entries), before);
});

test('copies side by side at the same height share one banded mesh', () => {
  const entries = project({items: '<item objectid="10" transform="1 0 0 0 1 0 0 0 1 100 100 0" printable="1"/><item objectid="10" transform="1 0 0 0 1 0 0 0 1 150 100 0" printable="1"/><item objectid="10" transform="0 1 0 -1 0 0 0 0 1 150 150 0" printable="1"/>'});
  const single = project();
  applyBuiltInColours(entries, opts); applyBuiltInColours(single, opts);
  assert.equal(dec.decode(entries.get(MEMBER)), dec.decode(single.get(MEMBER)));
});

test('an oversized result is refused with a triangle count', () => {
  assert.throws(() => applyBuiltInColours(project(), {...opts, layerHeight: 0.08, maxMemberBytes: 2000}), /This model would need \d[\d,]* triangles at 0\.08 mm layers, which is too large to export\. Choose a thicker layer height\./);
  // The same model fits under the real limit.
  assert.ok(applyBuiltInColours(project(), {...opts, layerHeight: 0.08}).triangles.after > 0);
});

test('problems are reported in plain words', () => {
  const ok = {target: 'snapmaker', reels: CMYW, backingSlot: 4, depth: 0.45, layerHeight: 0.1};
  assert.equal(builtInProblem(ok), '');
  assert.equal(builtInProblem({...ok, target: 'bambu'}), 'Built-in colours currently exports for the Snapmaker U1 only.');
  assert.equal(builtInProblem({...ok, reels: [CMYW[0], {color: '#FFFFFF', type: 'PETG', role: 'support-interface'}], backingSlot: 1}), 'Built-in colours needs at least two model reels.');
  assert.match(builtInProblem({...ok, layerHeight: 'adaptive'}), /fixed layer height from 0\.08 to 0\.2 mm/);
  assert.equal(builtInProblem({...ok, layerHeight: 0.25}), 'Choose a fixed layer height from 0.08 to 0.2 mm for built-in colours.');
  assert.match(builtInProblem({...ok, reels: [...CMYW.slice(0, 3), {color: '#FFFFFF', type: 'PETG', role: 'support-interface'}]}), /model reels for the interior/);
  assert.equal(builtInProblem({...ok, backingSlot: 5}), 'Choose one of the model reels for the interior.');
  assert.equal(builtInProblem({...ok, depth: 1.3}), 'Choose an outer colour depth from 0.3 to 1.2 mm.');
  assert.deepEqual([BUILT_IN_DEPTH, BUILT_IN_LAYERS, BUILT_IN_FIRST_LAYER], [{min: 0.3, max: 1.2, standard: 0.45}, {min: 0.08, max: 0.2, standard: 0.12}, 0.2]);
  assert.throws(() => applyBuiltInColours(project(), {...opts, target: 'orca'}), /Snapmaker U1 only/);
});

test('recipes are found by shade id, and a shade with no recipe is refused by id', () => {
  const forward = project(), reversed = project();
  applyBuiltInColours(forward, opts);
  applyBuiltInColours(reversed, {...opts, recipes: [...RECIPES].reverse()});
  assert.equal(dec.decode(reversed.get(MEMBER)), dec.decode(forward.get(MEMBER)));
  assert.throws(() => applyBuiltInColours(project(), {...opts, recipes: [RECIPES[0]]}), /shade 2/i);
  assert.throws(() => applyBuiltInColours(project(), {...opts, recipes: [RECIPES[0], {...RECIPES[1], id: 3}]}), /shade 2/i);
});

test('a recipe may only use model reels', () => {
  assert.throws(() => applyBuiltInColours(project(), {...opts, recipes: [RECIPES[0], {...RECIPES[1], sequence: [1, 5]}]}), /reel 5, which is not one of the model reels/);
  const reels = [CMYW[0], CMYW[1], {color: '#FFFFFF', type: 'PETG', role: 'support-interface', name: 'Support'}, CMYW[3]];
  assert.throws(() => applyBuiltInColours(project(), {...opts, reels}), /reel 3, which is not one of the model reels/);
  assert.throws(() => applyBuiltInColours(project(), {...opts, recipes: [RECIPES[0], {...RECIPES[1], sequence: []}]}), /shade 2/i);
});

test('the record is an estimate, stripped of planner fields, and claims no measurement', () => {
  const entries = project();
  const report = applyBuiltInColours(entries, {...opts, recipes: RECIPES.map(r => ({...r, weight: 3, model: 'layer-interleaved'}))});
  const record = JSON.parse(dec.decode(entries.get(BUILT_IN_PATH)));
  assert.deepEqual(record, JSON.parse(JSON.stringify(report)));
  assert.equal(record.schema, 'yab3d-built-in-colours'); assert.equal(record.version, 1); assert.equal(record.target, 'snapmaker');
  assert.deepEqual(record.reels, CMYW.map((r, i) => ({slot: i + 1, name: r.name, type: r.type, color: r.color})));
  assert.deepEqual([record.backingSlot, record.outerDepth, record.layerHeight, record.firstLayer], [4, 0.45, 0.1, 0.2]);
  assert.deepEqual(record.recipes, RECIPES.map(r => ({id: r.id, sequence: r.sequence, counts: r.counts, color: r.color, estimated: true})));
  for (const r of record.recipes) assert.deepEqual(Object.keys(r), ['id', 'sequence', 'counts', 'color', 'estimated']);
  assert.deepEqual(record.validation, {sliced: false, printed: false});
  assert.equal(record.note, 'Colours are built into the model at fixed layer heights. Changing layer height or first-layer height in the slicer will put the wrong reel on each layer. Flat and shallow surfaces print as single-reel bands.');
  assert.doesNotMatch(JSON.stringify(record), /measured|validated|verified|calibrated|accurate/i);
  // Nine layers (0 .. 8) over the 1 mm wall; shade 2 alternates reels 1 and 3, shade 1 is reel 1 throughout,
  // so the five even layers carry one reel and the four odd ones two.
  assert.equal(record.layers, 9);
  assert.deepEqual(record.reelsPerLayer, {max: 2, mean: 1.444});
  assert.equal(record.triangles.before, 6); assert.equal(record.triangles.after, strips(entries).length + 1);
  assert.deepEqual(Object.keys(record), ['schema', 'version', 'target', 'reels', 'backingSlot', 'outerDepth', 'layerHeight', 'firstLayer', 'recipes', 'triangles', 'layers', 'reelsPerLayer', 'settings', 'overridesReplaced', 'validation', 'note']);
  // The fixture's own object-level layer height (0.28) is the one override.
  assert.equal(record.overridesReplaced, 1);
});

test('nothing is silently dropped: unreadable triangles and unplaced parts are refused by name', () => {
  assert.throws(() => applyBuiltInColours(project({bodyExtra: ' face_property="7"'}), opts), /"Figure".*face_property/);
  const broken = project(), text = dec.decode(broken.get(MEMBER)).replace('<triangle v1="1" v2="4" v3="5"', '<triangle v1="1" v2="4" v3="99"');
  broken.set(MEMBER, enc.encode(text));
  assert.throws(() => applyBuiltInColours(broken, opts), /"Figure"/);
  const stray = project({extraParts: '<part id="4" subtype="normal_part"><metadata key="name" value="Loose arm"/><metadata key="extruder" value="1"/></part>'});
  stray.set(MEMBER, enc.encode(dec.decode(stray.get(MEMBER)).replace('</resources>', '<object id="4" type="model"><mesh><vertices><vertex x="0" y="5" z="0"/><vertex x="1" y="5" z="0"/><vertex x="1" y="5" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>')));
  assert.throws(() => applyBuiltInColours(stray, opts), /"Loose arm" is not placed/);
});

test('the same input always gives the same bytes', () => {
  const a = project(), b = project();
  applyBuiltInColours(a, opts); applyBuiltInColours(b, opts);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  for (const [name, data] of a) assert.deepEqual(data, b.get(name), name);
});

// ------------------------------------------------------------- the export path ----

const fourColours = async () => readProject(await readZip(new Uint8Array(readFileSync(new URL('./four-colours.3mf', import.meta.url)))));
/** Runs fn with crypto.randomUUID replaced by a counter, so that an export's bytes are reproducible. */
function counted(fn) {
  const real = crypto.randomUUID;
  let n = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
  try { return fn(); } finally { crypto.randomUUID = real; }
}

test('exportProject with builtIn writes shade ids and no slicer recipes', async () => {
  const source = await fourColours(), plate = source.plates[0].id;
  const mapping = {1: 1, 2: 2, 3: 5, 4: 6};
  const built = exportProject(source, plate, null, {target: 'snapmaker', reels: CMYW, recipes: [], mapping, u1Nozzle: '0.4', builtIn: {shades: 6}});
  assert.deepEqual(built.problems, []);
  assert.equal(built.recipes.length, 0);
  const states = paintStates(built.entries);
  assert.ok(states.length && states.every(s => s >= 1 && s <= 6));
  // Source colour 3 is painted on Beta; it is written as shade 5, beyond the four reels.
  assert.ok(states.includes(5) && !states.includes(3), 'shades beyond the four reels are written');
  // Beta prints in source filament 4, so its part is written as shade 6.
  assert.match(dec.decode(built.entries.get('Metadata/model_settings.config')), /<metadata key="name" value="Beta"\/><metadata key="extruder" value="6"\/>/);
  const cfg = JSON.parse(dec.decode(built.entries.get('Metadata/project_settings.config')));
  assert.equal(cfg.filament_colour.length, 4);
  // The refusals of the option.
  assert.throws(() => exportProject(source, plate, null, {target: 'bambu', reels: CMYW, recipes: [], mapping, builtIn: {shades: 6}}), /Snapmaker U1 only/);
  assert.throws(() => exportProject(source, plate, null, {target: 'snapmaker', reels: CMYW, recipes: [{a: 1, b: 2, percent: 50}], mapping, builtIn: {shades: 6}}), /slicer blends/);
  assert.throws(() => exportProject(source, plate, null, {target: 'snapmaker', reels: CMYW, recipes: [], mapping: {...mapping, 4: 7}, builtIn: {shades: 6}}), /1\.\.6/);
  assert.throws(() => exportProject(source, plate, null, {target: 'snapmaker', reels: CMYW, recipes: [], mapping, builtIn: {shades: 25}}), /1 to 24 shades/);
  // Without the option, shade 5 is not a filament the export writes.
  assert.throws(() => exportProject(source, plate, null, {target: 'snapmaker', reels: CMYW, recipes: [], mapping}), /1\.\.4/);
});

test('an exported built-in project is banded into the four reels end to end', async () => {
  const source = await fourColours();
  const built = exportProject(source, source.plates[0].id, null, {target: 'snapmaker', reels: CMYW, recipes: [], mapping: {1: 1, 2: 2, 3: 5, 4: 6}, u1Nozzle: '0.4', builtIn: {shades: 6}});
  const recipes = [1, 2, 3, 4, 5, 6].map(id => ({id, sequence: id <= 3 ? [id] : [1, id - 3], counts: [0, 0, 0, 0], color: '#808080'}));
  const report = applyBuiltInColours(built.entries, {target: 'snapmaker', reels: CMYW, recipes, backingSlot: 4, layerHeight: 0.12});
  assert.equal(report.firstLayer, BUILT_IN_FIRST_LAYER); assert.equal(report.outerDepth, BUILT_IN_DEPTH.standard);
  assert.throws(() => readProject(new Map(built.entries)), /already a layer pattern/);   // a built-in export is never re-read as a source
  const inspected = new Map(built.entries); inspected.delete(BUILT_IN_PATH);   // read its paint only, to count the reels it uses
  const again = readProject(inspected), used = analyse(again, again.plates[0].id, null).used;
  assert.ok(used.every(id => id >= 1 && id <= 4), `only the four reels are used (${used})`);
  assert.ok(paintStates(built.entries).every(s => s >= 1 && s <= 3));
});

// sha256 of every entry exportProject wrote for four-colours.3mf at base commit 2ff0105, before
// options.builtIn existed (crypto.randomUUID counted from 0 for each export). Made by
// .superpowers/sdd/2026-11-10-built-in-colours-1a/task-5-scratch/base-export-hashes.mjs, run against
// `git archive 2ff0105 web`.
const BASE = {
  snapmaker: {'3D/3dmodel.model': '31a16f9b97743929332d3669f96da7fc74405b2b550ed5768b073167d7857b9d', '3D/Objects/object_inline.model': '9a07ff67005188ce563317462f134f1449b920ebcbf2d32189f7705557e16eb6',
    '3D/Objects/object_shared.model': 'c4583a08b19cd2efb1533e2d84cc43fc9e0b50614c42f41f673479bd5bfdea71', '3D/_rels/3dmodel.model.rels': 'eaf1261be1833612ae3c8f897b502347d1ad0f3661570ecc46fce57ea693a1f8',
    'Metadata/YAB3D_colour_plan.json': 'e44954f1a201bfeab033b7157799f3aa7dee410ac3a74fe6ab2dd4f4cfe057a2', 'Metadata/model_settings.config': 'c13fb6f3c29c74c072dcd389a7628974c212ec4c6ec4a3d6749327ea7aeff18c',
    'Metadata/project_settings.config': 'e9f22ee58424e1e0ce8e4a853d3ce60c3eb54d1ee2c426b898ca192c7feb9797', 'Metadata/slice_info.config': '29e3dc0be7571366baf60dcfb47fb06b3ffb30b320655cd27f86fe51732164c1',
    '[Content_Types].xml': 'c5cae07844ce224b4c9b95ea04278739f21dd57001d86fd16a0af7c7fa7b95e2', '_rels/.rels': 'e5caf6d87ac2653e76bbf51a9ac4912588888f99aa720051f6d2420d6c1e187a'},
  'snapmaker-blends': {'3D/3dmodel.model': '8fc207348adc83d2dc9c2686876ec0fecd9b268da45baf05eee59829b2eae730', '3D/Objects/object_inline.model': 'a7980025fdd5dfef4113ffb1d3b17936dffea3ba0500e02b605993ecd9fafd22',
    '3D/Objects/object_shared.model': '45262186ad2e7ffa3bee0b2f4ab155bdeee11a01dfcf23f13550410749c4707e', '3D/_rels/3dmodel.model.rels': 'eaf1261be1833612ae3c8f897b502347d1ad0f3661570ecc46fce57ea693a1f8',
    'Metadata/YAB3D_colour_plan.json': 'c729683a3fae45d3c50633909116ceace3ee8e308a56727d58e0eb6bc9d6f120', 'Metadata/model_settings.config': '0f21df5a9f51ed28060e26eb513c1c5d23233a75646e4dbc33bd8720e11fc181',
    'Metadata/project_settings.config': 'e7acc8580ea7490398857a29842c2b2e296058a09750a42bccbfa7e650b4e927', 'Metadata/slice_info.config': '29e3dc0be7571366baf60dcfb47fb06b3ffb30b320655cd27f86fe51732164c1',
    '[Content_Types].xml': 'c5cae07844ce224b4c9b95ea04278739f21dd57001d86fd16a0af7c7fa7b95e2', '_rels/.rels': 'e5caf6d87ac2653e76bbf51a9ac4912588888f99aa720051f6d2420d6c1e187a'},
  bambu: {'3D/3dmodel.model': '5df438cdd3ab290e103aebf9408e5801ac99801775e6c6fe824e90b04d6e4380', '3D/Objects/object_inline.model': '9a07ff67005188ce563317462f134f1449b920ebcbf2d32189f7705557e16eb6',
    '3D/Objects/object_shared.model': 'c4583a08b19cd2efb1533e2d84cc43fc9e0b50614c42f41f673479bd5bfdea71', '3D/_rels/3dmodel.model.rels': 'eaf1261be1833612ae3c8f897b502347d1ad0f3661570ecc46fce57ea693a1f8',
    'Metadata/YAB3D_colour_plan.json': 'cd8f4d90c16ecb70cff07bd0df09cc0defcc7784e4bdb5fc081374e118f3255e', 'Metadata/model_settings.config': 'abe01dba5cbc8c76c958233f6f73ca4b7cb6ab0ff915f479406df76dce362c48',
    'Metadata/project_settings.config': '2c3597bca74ba1da5a5afa2b1d0f87b9df1d1522eec246fc5adc279cb7282171', 'Metadata/slice_info.config': '29e3dc0be7571366baf60dcfb47fb06b3ffb30b320655cd27f86fe51732164c1',
    '[Content_Types].xml': 'c5cae07844ce224b4c9b95ea04278739f21dd57001d86fd16a0af7c7fa7b95e2', '_rels/.rels': 'e5caf6d87ac2653e76bbf51a9ac4912588888f99aa720051f6d2420d6c1e187a'},
};

test('without builtIn the four-colour export is byte-for-byte what it was', async () => {
  const source = await fourColours(), plate = source.plates[0].id;
  for (const [label, target, blends] of [['snapmaker', 'snapmaker', false], ['snapmaker-blends', 'snapmaker', true], ['bambu', 'bambu', false]]) {
    let mapping = {1: 1, 2: 2, 3: 3, 4: 4}, recipes = [];
    if (blends) {
      const plan = planMixtures(analyse(source, plate, null).sourceColors, CMYW);
      recipes = plan.recipes; mapping = mappingFromPlan(plan);
      assert.ok(recipes.length > 0, 'the blend case writes slicer blends');
    }
    const built = counted(() => exportProject(source, plate, null, {target, reels: CMYW, recipes, mapping, u1Nozzle: '0.4', title: 'fixture'}));
    const hashes = Object.fromEntries([...built.entries].map(([k, v]) => [k, createHash('sha256').update(v).digest('hex')]));
    assert.deepEqual(hashes, BASE[label], label);
  }
});

test('a built-in export is refused on re-import with a plain reason', () => {
  const entries = project(); applyBuiltInColours(entries, opts);
  assert.ok(entries.has(BUILT_IN_PATH));
  assert.throws(() => readProject(entries), err => err.constructor.name === 'ProjectError');
  assert.throws(() => readProject(entries), {message: 'This file was exported with built-in colours, so its paint is already a layer pattern. Open the original model instead.'});
  assert.throws(() => readProject(entries), /already a layer pattern\. Open the original model instead/);
});

test('the built-in refusal comes before any parsing and only concerns files with that member', async () => {
  // An archive with no 3D/3dmodel.model would otherwise fail with the "not a 3MF" reason.
  const bare = new Map([[BUILT_IN_PATH, enc.encode('{}')]]);
  assert.throws(() => readProject(bare), /built-in colours/);
  assert.throws(() => readProject(new Map()), /not a 3MF/);
  const source = await fourColours();
  assert.doesNotThrow(() => readProject(new Map(source.entries)));
});
