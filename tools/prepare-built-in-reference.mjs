// Built-in colours (experimental) reference plate. Modelled on tools/prepare-ordered-wall-test.mjs.
//
//   node tools/prepare-built-in-reference.mjs [output folder]
//   (default deliverables/built-in-colours-reference-2026-11; never the demo folder, which may be in use)
//
// Eight numbered hollow cylinders (10 mm across, 12 mm tall, 1.2 mm wall, open top) on white
// bases with raised numbers, for ELEGOO Rilievo cyan, magenta, yellow and white in slots 1-4.
// Each cylinder is one shade, a layer-by-layer reel sequence built with spreadSequence from the
// layer counts below, and the whole plate goes through the real export path (exportProject with
// builtIn, then applyBuiltInColours) at 0.12 mm layers with a 0.2 mm first layer. Paint covers
// every outside face of a cylinder, the inner face of the wall included, to a depth of 0.45 mm;
// only the core of the 1.2 mm wall between those two shells (about 0.3 mm) is the white backing.
// Every shade is an estimate from the layer-interleaved mixing model, not a measurement, and
// nothing here has been printed.
import {mkdir, writeFile} from 'node:fs/promises';
import {readProject, exportProject, previewSoup, SRC_BBL_PROJECT} from '../web/shared/project.js';
import {renderIso, downscale} from '../web/shared/raster.js';
import {encodePng} from '../web/shared/png.js';
import {writeZip} from '../web/zip.js';
import {wallTestSetup} from '../web/shared/wallComparison.js';
import {spreadSequence} from '../web/shared/builtInRecipes.js';
import {mixManyHex, FDM_MODEL} from '../web/shared/fdmMix.js';
import {applyBuiltInColours, BUILT_IN_LAYERS, BUILT_IN_FIRST_LAYER, BUILT_IN_DEPTH} from '../web/shared/builtInColours.js';

const output = process.argv[2] || 'deliverables/built-in-colours-reference-2026-11';
await mkdir(output, {recursive: true});
const reels = wallTestSetup({height: 0.08}).reels; // ELEGOO Rilievo C, M, Y, W in slots 1-4
const enc = new TextEncoder();
const layer = BUILT_IN_LAYERS.standard, first = BUILT_IN_FIRST_LAYER;
const base = first + 3 * layer;          // 0.56 mm: the white base ends on a layer boundary
const numberHeight = 2 * layer;          // raised numbers, two layers
const height = 12, radius = 5, wall = 1.2;
// [label, layer counts of cyan, magenta, yellow, white]
const definitions = [
  ['Pure cyan', [1, 0, 0, 0]], ['Pure yellow', [0, 0, 1, 0]], ['C1:Y1', [1, 0, 1, 0]], ['C1:Y3', [1, 0, 3, 0]],
  ['C1:M1:Y1', [1, 1, 1, 0]], ['C1:W3', [1, 0, 0, 3]], ['M1:Y1:W2', [0, 1, 1, 2]], ['C1:M1:Y1:W1', [1, 1, 1, 1]],
];
const colours = reels.map(r => r.color);
const recipes = definitions.map(([, counts], i) => ({id: i + 1, counts, sequence: spreadSequence(counts), color: mixManyHex(colours, counts), model: FDM_MODEL}));
const WHITE = definitions.length + 1;     // the base and number shade: white only
recipes.push({id: WHITE, counts: [0, 0, 0, 1], sequence: [4], color: reels[3].color, model: FDM_MODEL});

function box(x, y, z, w, d, h) {
  return {v: [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z], [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]],
    f: [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]};
}
// A watertight, outward-wound annulus (hollow cylinder), centred at (cx, cy).
function ring(cx, cy, ro, ri, z, h, n = 96) {
  const v = [], f = [];
  for (const [r, dz] of [[ro, 0], [ro, h], [ri, 0], [ri, h]]) for (let i = 0; i < n; i++) v.push([cx + r * Math.cos(i * 2 * Math.PI / n), cy + r * Math.sin(i * 2 * Math.PI / n), z + dz]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const [a, b, c, d] of [[i, j, n + j, n + i], [2 * n + j, 2 * n + i, 3 * n + i, 3 * n + j], [n + i, n + j, 3 * n + j, 3 * n + i], [j, i, 2 * n + i, 2 * n + j]]) f.push([a, b, c], [a, c, d]);
  }
  return {v, f};
}
function merge(meshes) { const v = [], f = []; for (const m of meshes) { const o = v.length; v.push(...m.v); f.push(...m.f.map(t => t.map(i => i + o))); } return {v, f}; }
const digits = ['', '010/110/010/010/111', '111/001/111/100/111', '111/001/111/001/111', '101/101/111/001/001', '111/100/111/001/111', '111/100/111/101/111', '111/001/010/010/010', '111/101/111/101/111'];
const number = v => Number(v.toFixed(7));
const meshXml = (id, m) => `<object id="${id}" type="model"><mesh><vertices>${m.v.map(p => `<vertex x="${number(p[0])}" y="${number(p[1])}" z="${number(p[2])}"/>`).join('')}</vertices><triangles>${m.f.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh></object>`;

const objects = [], meta = [], items = [], samples = [];
let next = 1;
for (const [i, [label, counts]] of definitions.entries()) {
  // Base 15 x 20 mm with the cylinder at (7.5, 12) and the number in front of it.
  const baseMesh = [box(0, 0, 0, 15, 20, base)];
  digits[i + 1].split('/').forEach((row, y) => [...row].forEach((on, x) => { if (on === '1') baseMesh.push(box(6.6 + x * 0.6, 4.6 - y * 0.6, base, 0.6, 0.6, numberHeight)); }));
  const parts = [[WHITE, merge(baseMesh), 'White base and number'], [i + 1, ring(7.5, 12, radius, radius - wall, base, height), `Sample ${i + 1} ${label}`]];
  const refs = [], partMeta = [];
  for (const [extruder, mesh, name] of parts) {
    const id = next++;
    objects.push(meshXml(id, mesh));
    refs.push(`<component objectid="${id}"/>`);
    partMeta.push(`<part id="${id}" subtype="normal_part"><metadata key="name" value="${name}"/><metadata key="extruder" value="${extruder}"/></part>`);
  }
  const id = next++, x = 65 + (i % 4) * 23, y = 155 + Math.floor(i / 4) * 28;
  objects.push(`<object id="${id}" type="model"><components>${refs.join('')}</components></object>`);
  items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} 0"/>`);
  meta.push(`<object id="${id}"><metadata key="name" value="${i + 1} ${label}"/><metadata key="extruder" value="${WHITE}"/>${partMeta.join('')}</object>`);
  const recipe = recipes[i];
  samples.push({number: i + 1, label, counts: {cyan: counts[0], magenta: counts[1], yellow: counts[2], white: counts[3]}, sequence: recipe.sequence.join(''),
    estimatedShade: recipe.color, estimated: true, centre: [x + 7.5, y + 12], outerDiameter: 2 * radius, wall, cylinderHeight: height, baseHeight: base,
    firstCylinderLayer: Math.round((base - first) / layer) + 1});
}
const filamentColours = recipes.map(r => r.color);
const input = new Map([
  ['3D/3dmodel.model', enc.encode(`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objects.join('')}</resources><build>${items.join('')}</build></model>`)],
  ['Metadata/model_settings.config', enc.encode(`<config>${meta.join('')}</config>`)],
  [SRC_BBL_PROJECT, enc.encode(JSON.stringify({filament_colour: filamentColours, filament_type: filamentColours.map(() => 'PLA'), layer_height: String(layer)}))],
]);
const project = readProject(input);
const mapping = Object.fromEntries(recipes.map(r => [r.id, r.id]));
const soup = previewSoup(project, 1, null, Object.fromEntries(recipes.map(r => [r.id, r.color])), null, 500000);
const image = renderIso(soup.positions, soup.colors, {size: 512}), small = downscale(image, 128);
const thumbnails = {main: await encodePng(image.data, image.width, image.height), small: await encodePng(small.data, small.width, small.height), plateName: 'Built-in colours reference'};
const built = exportProject(project, 1, null, {target: 'snapmaker', reels, recipes: [], mapping, u1Nozzle: '0.4', builtIn: {shades: recipes.length},
  title: 'Built-in colours reference plate (experimental)', thumbnails});
if (built.problems.length) throw Error(built.problems.join('\n'));
const record = applyBuiltInColours(built.entries, {target: 'snapmaker', reels, recipes, backingSlot: 4, depth: BUILT_IN_DEPTH.standard, layerHeight: layer, firstLayer: first});
const manifest = {version: 1, title: 'Built-in colours reference plate', datePrepared: '2026-11-11', printer: 'Snapmaker U1', nozzle: 0.4,
  status: 'Experimental. Sliced and toolpath-checked only; never printed. Every shade is an estimate from the reels’ nominal display colours, not a measurement. A toolpath check is not a check of printed colour.',
  reels: reels.map((r, i) => ({slot: i + 1, name: r.name, type: r.type, color: r.color})), backingSlot: 4,
  layerHeight: layer, firstLayer: first, outerDepth: BUILT_IN_DEPTH.standard, samples,
  construction: 'Hollow cylinders, open top, 1.2 mm wall: the sample sequence is painted on every outside face, the outer and the inner face of the wall alike, to a depth of 0.45 mm; only the core of the wall between those shells (about 0.3 mm) is white. Each sequence counts layers from the first layer (layer 0, 0.2 mm); a reel is chosen as sequence[layer % length], so the cylinders start part-way into their sequence at the first layer above the 0.56 mm base.'};
const name = `${output}/reference-plate-cmyw-0.12.3mf`;
await writeFile(name, await writeZip([...built.entries].map(([n, data]) => ({name: n, data}))));
await writeFile(`${name}.samples.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({output: name, triangles: record.triangles, layers: record.layers, samples: samples.map(s => `${s.number} ${s.label} ${s.sequence} ${s.estimatedShade}`)}, null, 2));
