// Built-in colours (experimental): every source colour is written into the model as a
// repeating layer-by-layer sequence of reels (its recipe, from builtInRecipes.js), as
// paint. An exported project (exportProject with options.builtIn) carries shade ids;
// this rewrites it in place:
//   1. every outside face gets explicit paint and paint depth is limited to an outer
//      shell, with the interior in one backing reel (explicitOuterPaint, dualWall.js);
//   2. every painted mesh is cut at the slicer's layer boundaries (bandMesh,
//      paintBands.js) and each piece is painted the one reel its shade's recipe gives
//      for its layer, a near-flat piece by the layer it tops or bottoms (pieceLayer,
//      flatFaceRule.js);
//   3. the layer heights the pattern was cut for are fixed in the project settings.
// The colours are estimates from the recipes; nothing here has been sliced or printed.
import * as paint from './paint.js';
import {explicitOuterPaint} from './dualWall.js';
import {bandMesh} from './paintBands.js';
import {layerPosition, layerPlane} from './layerBands.js';
import {pieceLayer} from './flatFaceRule.js';
import {matrixFromText, matmul} from './project.js';
import {norm} from './colour.js';
import {MAX_MEMBER_BYTES} from '../zip.js';

export const BUILT_IN_PATH = 'Metadata/YAB3D_built_in_colours.json';
export const BUILT_IN_DEPTH = {min: 0.3, max: 1.2, standard: 0.45};
export const BUILT_IN_LAYERS = {min: 0.08, max: 0.2, standard: 0.12};
export const BUILT_IN_FIRST_LAYER = 0.2;
export const BUILT_IN_NOTE = 'Colours are built into the model at fixed layer heights. Changing layer height or first-layer height '
  + 'in the slicer will put the wrong reel on each layer. Flat and shallow surfaces print as single-reel bands.';

const MAIN = '3D/3dmodel.model', SETTINGS = 'Metadata/model_settings.config', PROJECT = 'Metadata/project_settings.config';
const HEIGHTS_PROFILE = 'Metadata/layer_heights_profile.txt', HEIGHT_RANGES = 'Metadata/layer_config_ranges.xml';
const enc = new TextEncoder(), dec = new TextDecoder();
const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
const COMPONENT_RE = /<component\b([^>]*?)\/>/g;
const ITEM_RE = /<item\b([^>]*?)\/>/g;
const VERTEX_RE = /<vertex\b([^>]*?)\/>/g;
const VERTEX_XYZ = /^\s*x="([^"]*)"\s+y="([^"]*)"\s+z="([^"]*)"\s*$/;
const TRIANGLE_STEP = /\s*<triangle\b([^>]*?)\/>/y;
const ATTRIBUTE_STEP = /\s*([A-Za-z_][\w:.-]*)="([^"]*)"/y;
const COLOUR_ATTRS = new Set(['paint_color', 'mmu_segmentation', 'slic3rpe:mmu_segmentation']);
// Seam, support and any other per-face paint: trees in the same format as the colour paint.
const OTHER_PAINT = /^(?:slic3rpe:)?(?:paint|custom)_[\w]+$/;
const EPS = 1e-9;

const attr = (text, name) => new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, '\\$&')}="([^"]*)"`).exec(text)?.[1];
const unescape = text => String(text).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const isModelReel = reel => Boolean(reel) && reel.role !== 'support-interface';
const modelSlots = reels => (Array.isArray(reels) ? reels.map((reel, i) => (isModelReel(reel) ? i + 1 : 0)).filter(Boolean) : []);
const inRange = (value, {min, max}) => typeof value === 'number' && value >= min - EPS && value <= max + EPS;
const count = (text, needle, from = 0, to = text.length) => {
  let n = 0;
  for (let i = text.indexOf(needle, from); i !== -1 && i < to; i = text.indexOf(needle, i + needle.length)) n += 1;
  return n;
};
const grouped = n => n.toLocaleString('en-GB');

/** The reason built-in colours cannot be exported with these choices, or '' when they are fine. */
export function builtInProblem({target, reels, backingSlot, depth, layerHeight} = {}) {
  if (target !== 'snapmaker') return 'Built-in colours currently exports for the Snapmaker U1 only.';
  const slots = modelSlots(reels);
  if (slots.length < 2) return 'Built-in colours needs at least two model reels.';
  if (!slots.includes(backingSlot)) return 'Choose one of the model reels for the interior.';
  if (!inRange(depth, BUILT_IN_DEPTH)) return `Choose an outer colour depth from ${BUILT_IN_DEPTH.min} to ${BUILT_IN_DEPTH.max} mm.`;
  if (!inRange(layerHeight, BUILT_IN_LAYERS)) return `Choose a fixed layer height from ${BUILT_IN_LAYERS.min} to ${BUILT_IN_LAYERS.max} mm for built-in colours.`;
  return '';
}

/** Every toolpath check of built-in colours used the 0.4 mm nozzle profile; a wider line than the colour shell is untested. */
export const BUILT_IN_NOZZLE = '0.4';
export const BUILT_IN_NOZZLE_PROBLEM = 'Built-in colours has only been checked with the 0.4 mm nozzle. Choose the 0.4 mm nozzle.';
/** The refusal when the project's nozzle size is missing or cannot be read for every reel. */
export const BUILT_IN_NOZZLE_UNREAD = 'Built-in colours could not read the nozzle size from this project. Choose the 0.4 mm nozzle and export again.';

/** The refusal when a nozzle profile's layer limits exclude the pattern's layer or first-layer height, or ''. */
export function builtInLayerProblem({minLayer, maxLayer}, layerHeight, firstLayer) {
  const inside = v => !(Number.isFinite(minLayer) && v < minLayer - EPS) && !(Number.isFinite(maxLayer) && v > maxLayer + EPS);
  if (inside(layerHeight) && inside(firstLayer)) return '';
  return `Built-in colours uses ${layerHeight} mm layers and a ${firstLayer} mm first layer, which this nozzle profile does not allow. Choose the 0.4 mm nozzle.`;
}

/** Recipes by shade id, each using model reels only. */
function recipesById(recipes, reels) {
  if (!Array.isArray(recipes) || !recipes.length) throw Error('Built-in colours needs a recipe for every shade.');
  const slots = new Set(modelSlots(reels)), byId = new Map();
  for (const recipe of recipes) {
    const id = recipe?.id;
    if (!Number.isInteger(id) || id < 1) throw Error(`A built-in colour recipe has the shade id ${id}, which is not a whole number from 1.`);
    if (byId.has(id)) throw Error(`Shade ${id} has more than one built-in colour recipe.`);
    if (!Array.isArray(recipe.sequence) || !recipe.sequence.length) throw Error(`The recipe for shade ${id} has no layers.`);
    for (const reel of recipe.sequence)
      if (!slots.has(reel)) throw Error(`The recipe for shade ${id} uses reel ${reel}, which is not one of the model reels.`);
    byId.set(id, recipe);
  }
  return byId;
}

/**
 * Object names and parts from model_settings.config. Parts are keyed by id alone, as
 * explicitOuterPaint keys them: the exporter writes each mesh object id once, so an id
 * names one part across all model members.
 */
function readSettings(text) {
  const objects = new Map(), parts = new Map();
  for (const m of text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attr(m[1], 'id'), head = m[2].split(/<part\b/)[0];
    const name = unescape(/<metadata(?: type="[^"]*")? key="name" value="([^"]*)"/.exec(head)?.[1] ?? `object ${id}`);
    objects.set(id, name);
    for (const p of m[2].matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
      const partId = attr(p[1], 'id');
      if (partId === undefined || parts.has(partId)) continue;
      parts.set(partId, {object: id, objectName: name, subtype: attr(p[1], 'subtype') || 'normal_part',
        name: unescape(/<metadata(?: type="[^"]*")? key="name" value="([^"]*)"/.exec(p[2])?.[1] ?? name)});
    }
  }
  return {objects, parts};
}

/** The vertices of a mesh body as x0 y0 z0 x1 ..., or a refusal naming the object. */
function readVertices(body, name) {
  const open = body.indexOf('<vertices'), close = body.indexOf('</vertices>');
  if (open === -1) throw Error(`"${name}" has a mesh with no vertex list, so built-in colours cannot read it.`);
  if (close === -1) return new Float64Array(0);           // <vertices/>
  const from = body.indexOf('>', open) + 1, section = body.slice(from, close);
  const expected = count(section, '<vertex'), out = new Float64Array(3 * expected);
  let n = 0;
  for (const m of section.matchAll(VERTEX_RE)) {
    const fast = VERTEX_XYZ.exec(m[1]);
    const xyz = fast ? [fast[1], fast[2], fast[3]] : ['x', 'y', 'z'].map(k => attr(m[1], k));
    for (let k = 0; k < 3; k++) {
      const v = Number(xyz[k]);
      if (xyz[k] === undefined || xyz[k] === '' || !Number.isFinite(v)) throw Error(`"${name}" has a vertex that cannot be read, so built-in colours stopped.`);
      out[3 * n + k] = v;
    }
    n += 1;
  }
  if (n !== expected) throw Error(`"${name}" has a vertex that cannot be read, so built-in colours stopped.`);
  return out;
}

/** Whether two split nodes cut their triangle the same way (paintBands.js reads the special side modulo 3 and ignores it for a three-sided split). */
const sameSplit = (a, b) => Number(a.sides) === Number(b.sides) && (Number(a.sides) === 3 || Number(a.specialSide) % 3 === Number(b.specialSide) % 3);

/**
 * The common refinement of two paint trees on one triangle (colour, support and seam
 * trees all use the same subdivision), with leaves combine(a, b); null when the two
 * split one triangle in different ways, which no single tree can describe.
 */
function mergeTrees(a, b, combine) {
  if (a.kind === 'leaf' && b.kind === 'leaf') return {kind: 'leaf', state: combine(a.state, b.state)};
  if (a.kind !== 'leaf' && b.kind !== 'leaf' && !sameSplit(a, b)) return null;
  const like = a.kind === 'leaf' ? b : a, children = [];
  for (let i = 0; i < like.children.length; i++) {
    const kid = mergeTrees(a.kind === 'leaf' ? a : a.children[i], b.kind === 'leaf' ? b : b.children[i], combine);
    if (!kid) return null;
    children.push(kid);
  }
  return {kind: 'split', sides: like.sides, specialSide: like.specialSide, children};
}

/** A split whose leaves all hold one state is that state (explicitOuterPaint turns [X, 0] into [X, X]). */
function collapse(node) {
  if (node.kind === 'leaf') return node;
  const children = node.children.map(collapse);
  if (children.every(c => c.kind === 'leaf' && c.state === children[0].state)) return children[0];
  return {kind: 'split', sides: node.sides, specialSide: node.specialSide, children};
}

const mapLeaves = (node, f) => (node.kind === 'leaf' ? {kind: 'leaf', state: f(node.state)}
  : {kind: 'split', sides: node.sides, specialSide: node.specialSide, children: node.children.map(c => mapLeaves(c, f))});
const digits = n => String(n).length;

/** UTF-8 in chunks, so that a member larger than one string can be written; refuses past the byte limit. */
function memberWriter(limit, refuse) {
  const chunks = [];
  let parts = [], pending = 0, bytes = 0;
  const flush = () => {
    if (!parts.length) return;
    const b = enc.encode(parts.join(''));
    parts = []; pending = 0; bytes += b.length; chunks.push(b);
    if (bytes > limit) refuse();
  };
  return {
    push(text) { parts.push(text); pending += text.length; if (pending > 4e6) flush(); },
    size: () => bytes + pending,
    bytes() {
      flush();
      const out = new Uint8Array(bytes);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      chunks.length = 0;
      return out;
    },
  };
}

/**
 * Write built-in colour recipes into an exported Snapmaker project (see the module
 * note). `recipes` is the planner's list, `id` = shade id. Rewrites `entries` in place
 * and returns the record also written to BUILT_IN_PATH; on a refusal nothing is changed.
 * `maxMemberBytes` overrides MAX_MEMBER_BYTES and `band` replaces bandMesh (both for tests).
 */
export function applyBuiltInColours(entries, {target, reels, recipes, backingSlot, depth = BUILT_IN_DEPTH.standard, layerHeight,
  firstLayer = BUILT_IN_FIRST_LAYER, maxMemberBytes = MAX_MEMBER_BYTES, band = bandMesh} = {}) {
  const problem = builtInProblem({target, reels, backingSlot, depth, layerHeight});
  if (problem) throw Error(problem);
  if (!(typeof firstLayer === 'number' && Number.isFinite(firstLayer) && firstLayer > 0))
    throw Error('Choose a first-layer height above 0 mm for built-in colours.');
  const byId = recipesById(recipes, reels);
  const height = layerHeight, first = firstLayer;
  if (entries.has(HEIGHT_RANGES) && dec.decode(entries.get(HEIGHT_RANGES)).includes('layer_height'))
    throw Error('This project has height ranges that change the layer height. Built-in colours needs one fixed layer height; remove those ranges and export again.');

  // The slicer clamps (or refuses) a layer height outside its nozzle profile's limits, which
  // would move every band: check each model reel's nozzle and limits in the project. A
  // nozzle size that is missing, not one per reel, or unreadable is refused, never skipped.
  if (!entries.has(PROJECT)) throw Error(BUILT_IN_NOZZLE_UNREAD);
  const limits = JSON.parse(dec.decode(entries.get(PROJECT)));
  const at = (key, slot) => { const v = limits[key]; return Number(Array.isArray(v) ? v[slot - 1] : v); };
  const nozzles = limits.nozzle_diameter;
  if (!Array.isArray(nozzles) || nozzles.length < reels.length) throw Error(BUILT_IN_NOZZLE_UNREAD);
  for (const slot of modelSlots(reels)) {
    const nozzle = Number(nozzles[slot - 1]);
    if (!Number.isFinite(nozzle)) throw Error(BUILT_IN_NOZZLE_UNREAD);
    if (Math.abs(nozzle - Number(BUILT_IN_NOZZLE)) > EPS) throw Error(BUILT_IN_NOZZLE_PROBLEM);
  }
  for (const slot of modelSlots(reels)) {
    const problem = builtInLayerProblem({minLayer: at('min_layer_height', slot), maxLayer: at('max_layer_height', slot)}, height, first);
    if (problem) throw Error(problem);
  }

  // A copy, so that a refusal at any step leaves the caller's entries as they were.
  const work = new Map(entries);
  const outer = explicitOuterPaint(work, {target, innerSlot: backingSlot, depth});
  const {objects: objectNames, parts} = readSettings(dec.decode(work.get(SETTINGS)));
  const printedPart = id => parts.get(id)?.subtype === 'normal_part';
  // A raft lifts the model by the raft's own height, so the bands would no longer meet the
  // slicer's layers; the exporter carries the source's raft setting onto each object.
  const raft = ' prints on a raft, which lifts every layer of the model. Built-in colours needs the model on the bed; turn the raft off and export again.';
  if (Number(JSON.parse(dec.decode(work.get(PROJECT))).raft_layers) > 0) throw Error(`This project${raft}`);
  for (const m of dec.decode(work.get(SETTINGS)).matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g))
    if ([...m[2].matchAll(/<metadata(?: type="[^"]*")? key="raft_layers" value="([^"]*)"/g)].some(r => Number(r[1]) > 0))
      throw Error(`"${objectNames.get(attr(m[1], 'id')) ?? `object ${attr(m[1], 'id')}`}"${raft}`);

  // ---- every object of every model member; the printed meshes' vertices ----
  const members = [...work.keys()].filter(name => /^3D\/.*\.model$/i.test(name));
  if (!work.has(MAIN)) throw Error('The project has no main model, so built-in colours cannot place its parts.');
  const objects = new Map();        // `${member}#${id}` -> {member, id, mesh, comps, vertices}
  let trianglesBefore = 0;
  const memberTriangles = new Map();
  for (const member of members) {
    const text = dec.decode(work.get(member));
    let triangles = 0;
    for (const m of text.matchAll(OBJECT_RE)) {
      const id = attr(m[1], 'id'), body = m[2], mesh = body.includes('<mesh');
      const comps = mesh ? [] : [...body.matchAll(COMPONENT_RE)].map(c => ({
        member: (attr(c[1], 'p:path') || `/${member}`).replace(/^\//, ''), id: attr(c[1], 'objectid'), m: matrixFromText(attr(c[1], 'transform'))}));
      const n = mesh ? count(body, '<triangle') - count(body, '<triangles') : 0;
      triangles += n;
      const key = `${member}#${id}`, printed = mesh && n > 0 && printedPart(id);
      // A part that prints nothing (support blocker or enforcer, modifier, cutter) gets no
      // bands, so colour paint on it would keep a shade id that names no reel.
      if (mesh && !printed && /\s(?:slic3rpe:)?(?:paint_color|mmu_segmentation)="[0-9A-Fa-f]+"/.test(body))
        throw Error(`"${parts.get(id)?.name ?? `object ${id}`}" has colour paint on a part that prints nothing, which built-in colours cannot carry. Remove that paint and export again.`);
      objects.set(key, {member, id, mesh, comps, printed, name: parts.get(id)?.name ?? `object ${id}`, vertices: printed ? readVertices(body, parts.get(id).objectName) : null});
    }
    memberTriangles.set(member, triangles);
    trianglesBefore += triangles;
  }

  // ---- placements: build items, through components, to meshes ----
  const placed = new Map();         // mesh key -> [{m, item, root}]
  let item = 0;
  const visit = (key, m, root, depthLeft) => {
    const object = objects.get(key);
    if (!object) throw Error(`The model refers to ${key.replace('#', ' object ')}, which is not in the project, so built-in colours cannot place it.`);
    if (depthLeft < 0) throw Error('The model nests its parts too deeply for built-in colours.');
    if (object.mesh) { if (!placed.has(key)) placed.set(key, []); placed.get(key).push({m, item, root}); }
    for (const c of object.comps) visit(`${c.member}#${c.id}`, matmul(c.m, m), root, depthLeft - 1);
  };
  for (const it of dec.decode(work.get(MAIN)).matchAll(ITEM_RE)) {
    item += 1;
    const root = attr(it[1], 'objectid');
    visit(`${MAIN}#${root}`, matrixFromText(attr(it[1], 'transform')), root, 16);
  }
  const printed = [...objects.entries()].filter(([, o]) => o.printed);
  for (const [key, o] of printed) if (!placed.has(key))
    throw Error(`"${o.name}" is not placed on the plate, so built-in colours cannot tell its height. Place it or remove it, and export again.`);
  const nameOf = key => objectNames.get(placed.get(key)[0].root) ?? objects.get(key).name;

  // The slicer sets each build item on the bed by its lowest printed point.
  const itemMin = new Map();
  for (const [key, o] of printed) for (const {m, item: i} of placed.get(key)) {
    const c0 = m[0][2], c1 = m[1][2], c2 = m[2][2], t = m[3][2], v = o.vertices;
    let low = itemMin.get(i) ?? Infinity;
    for (let j = 0; j < v.length; j += 3) { const z = v[j] * c0 + v[j + 1] * c1 + v[j + 2] * c2 + t; if (z < low) low = z; }
    itemMin.set(i, low);
  }
  // One mesh, one height function: copies may differ by a move or turn on the bed, not by tilt, height or scale.
  const same = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
  const gram = m => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => m[i][0] * m[j][0] + m[i][1] * m[j][1] + m[i][2] * m[j][2]));
  const heightOf = p => [p.m[0][2], p.m[1][2], p.m[2][2], p.m[3][2] - itemMin.get(p.item), ...gram(p.m)];
  for (const [key] of printed) {
    const [first0, ...rest] = placed.get(key), want = heightOf(first0);
    for (const p of rest) if (!heightOf(p).every((x, i) => same(x, want[i])))
      throw Error(`"${nameOf(key)}" is placed more than once at different tilts or heights. Built-in colours needs each copy to be its own object.`);
  }

  // ---- band every printed mesh, member by member ----
  const codes = new Map();
  const leafCode = state => { if (!codes.has(state)) codes.set(state, paint.encode({kind: 'leaf', state})); return codes.get(state); };
  const layerReels = new Map();     // layer -> bit mask of reels painted on it
  let trianglesAfter = trianglesBefore;
  for (const member of members) {
    const keys = printed.filter(([, o]) => o.member === member);
    if (!keys.length) continue;
    const text = dec.decode(work.get(member));
    let need = memberTriangles.get(member);
    const tooLarge = n => Error(`This model would need ${grouped(n)} triangles at ${height} mm layers, which is too large to export. Choose a thicker layer height.`);
    const writer = memberWriter(maxMemberBytes, () => { throw tooLarge(need); });
    let last = 0;
    for (const m of text.matchAll(OBJECT_RE)) {
      const key = `${member}#${attr(m[1], 'id')}`, o = objects.get(key);
      if (!o?.printed) continue;
      const name = nameOf(key), body = m[2], bodyAt = m.index + m[0].length - '</object>'.length - body.length;
      if (count(body, '<mesh') !== 1) throw Error(`"${name}" has a part with more than one mesh, which built-in colours cannot read.`);
      const p0 = placed.get(key)[0], M = p0.m, zmin = itemMin.get(p0.item);
      const c0 = M[0][2], c1 = M[1][2], c2 = M[2][2], t = M[3][2];
      const zOf = p => (p[0] * c0 + p[1] * c1 + p[2] * c2 + t) - zmin;
      const v = o.vertices, nv = v.length / 3, pts = new Array(nv);
      for (let j = 0; j < nv; j++) pts[j] = [v[3 * j], v[3 * j + 1], v[3 * j + 2]];

      // Triangles, read one after another so that nothing between them goes unseen.
      const open = body.indexOf('<triangles'), close = body.lastIndexOf('</triangles>');
      const from = body.indexOf('>', open) + 1, faces = [], colourNames = [], others = [], otherNames = [];
      let at = from, sep = null;
      TRIANGLE_STEP.lastIndex = from;
      for (let tm; at < close && (tm = TRIANGLE_STEP.exec(body)) && TRIANGLE_STEP.lastIndex <= close; at = TRIANGLE_STEP.lastIndex) {
        if (sep === null) sep = tm[0].slice(0, tm[0].indexOf('<'));
        const f = faces.length, a = tm[1], values = {}, other = [];
        ATTRIBUTE_STEP.lastIndex = 0;
        let end = 0;
        for (let am; (am = ATTRIBUTE_STEP.exec(a)); end = ATTRIBUTE_STEP.lastIndex) {
          if (am[1] in values) throw Error(`"${name}" has a triangle with two ${am[1]} values, which built-in colours cannot read.`);
          values[am[1]] = am[2];
          if (!['v1', 'v2', 'v3'].includes(am[1]) && !COLOUR_ATTRS.has(am[1])) other.push(am[1]);
        }
        if (a.slice(end).trim()) throw Error(`"${name}" has a triangle that cannot be read, so built-in colours stopped.`);
        const ix = ['v1', 'v2', 'v3'].map(k => Number(values[k]));
        if (!ix.every(i => Number.isInteger(i) && i >= 0 && i < nv) || ['v1', 'v2', 'v3'].some(k => !/^\d+$/.test(values[k] ?? '')))
          throw Error(`"${name}" has a triangle that does not name three of its vertices, so built-in colours stopped.`);
        const colour = [...COLOUR_ATTRS].filter(k => k in values);
        if (colour.length !== 1 || !values[colour[0]]) throw Error(`"${name}" has a face with no colour after the outer paint step, so built-in colours stopped.`);
        let node;
        try { node = paint.decode(values[colour[0]]); } catch (error) { throw Error(`"${name}" has paint that cannot be read (${error.message}).`); }
        for (const s of paint.walkStates(node)) {
          if (s === 0) throw Error(`"${name}" has a face with no colour after the outer paint step, so built-in colours stopped.`);
          if (!byId.has(s)) throw Error(`Shade ${s} has no built-in colour recipe, so "${name}" cannot be coloured.`);
        }
        // Seam and support paint (and any other per-face paint tree). An empty value is no paint.
        let trees = null;
        for (const k of other) {
          if (!OTHER_PAINT.test(k)) throw Error(`"${name}" has triangle data (${k}) that built-in colours cannot carry through the layer cuts.`);
          if (!values[k]) continue;
          let tree;
          try { tree = paint.decode(values[k]); } catch (error) { throw Error(`"${name}" has ${k} paint that cannot be read (${error.message}).`); }
          if (!otherNames.includes(k)) otherNames.push(k);
          (trees ||= new Map()).set(k, tree);
        }
        faces.push({v: ix, paint: node});
        colourNames[f] = colour[0];
        if (trees) others[f] = trees;
      }
      const tail = body.slice(at, close);
      if (tail.trim()) throw Error(`"${name}" has something in its triangle list that is not a triangle, so built-in colours stopped.`);
      if (faces.length !== count(body, '<triangle', from, close)) throw Error(`"${name}" has a triangle that cannot be read, so built-in colours stopped.`);

      // Each face's colour, support and seam trees become one tree whose leaves stand for
      // (shade, support state, seam state, ...): bandMesh cuts that, so every piece lies in
      // one leaf of each, exactly.
      const tuples = [null], keyOf = new Map(), leafOf = [];
      const keyFor = tuple => {
        const text = tuple.join(',');
        let k = keyOf.get(text);
        if (k === undefined) { k = tuples.push(tuple) - 1; keyOf.set(text, k); leafOf[k] = {kind: 'leaf', state: k}; }
        return k;
      };
      const none = otherNames.map(() => 0), noPaint = {kind: 'leaf', state: 0};
      faces.forEach((face, f) => {
        const trees = others[f];
        if (!trees && face.paint.kind === 'leaf') { face.paint = leafOf[keyFor([face.paint.state, ...none])]; return; }
        let tree = mapLeaves(collapse(face.paint), s => [s]);
        for (const k of otherNames) {
          tree = mergeTrees(tree, collapse(trees?.get(k) ?? noPaint), (tuple, s) => [...tuple, s]);
          if (!tree) throw Error(`"${name}" has colour, support or seam paint that divides one triangle in different ways. Built-in colours cannot combine them exactly; repaint so that they match, or remove the support or seam paint there, and export again.`);
        }
        face.paint = mapLeaves(tree, keyFor);
      });
      const extraOf = tuples.map(tuple => (tuple ? otherNames.map((k, i) => (tuple[i + 1] ? ` ${k}="${leafCode(tuple[i + 1])}"` : '')).join('') : ''));

      // A lower bound on the member's size, before the cut makes anything. Each layer a face
      // touches is a convex strip whose outline holds at least the points where its edges
      // cross the strip's two planes and its corners strictly inside, so it is cut into at
      // least that many points less two triangles (and at least one), none with an index
      // below the face's smallest. Each boundary an edge crosses makes one new vertex, at
      // the very point bandMesh computes (from the edge's lower index), so those vertex
      // lines are counted exactly. Split leaves only add to both.
      // New vertices go straight after the last existing one (or after the opening tag).
      const vOpen = body.indexOf('<vertices'), vClose = body.indexOf('</vertices>'), vLast = body.lastIndexOf('<vertex', vClose);
      const vertexEnd = vLast === vOpen ? body.indexOf('>', vOpen) + 1 : body.indexOf('>', vLast) + 1;
      const vFirst = body.indexOf('<vertex', vOpen + 9);
      const vsep = vLast === vOpen ? '' : body.slice(body.lastIndexOf('>', vFirst) + 1, vFirst);
      const tsep = sep ?? '', pos = new Float64Array(nv), zv = new Float64Array(nv);
      for (let j = 0; j < nv; j++) { zv[j] = zOf(pts[j]); pos[j] = layerPosition(zv[j], first, height); }
      const crossed = (p, q, k) => { const lo = Math.min(pos[p], pos[q]), hi = Math.max(pos[p], pos[q]); return k >= Math.floor(lo / 2) + 1 && k <= Math.ceil(hi / 2) - 1; };
      let pieces = 0, bytes = 0;
      const edges = new Float64Array(3 * faces.length);
      faces.forEach((face, f) => {
        const [a, b, c] = face.v, lo = Math.min(pos[a], pos[b], pos[c]), hi = Math.max(pos[a], pos[b], pos[c]);
        const low = Math.floor(lo / 2) + 1, high = Math.max(low, Math.ceil(hi / 2));
        let n = 0;
        for (let layer = low; layer <= high; layer++) {
          let points = 0;
          for (let k = 0; k < 3; k++) {
            const p = face.v[k], q = face.v[(k + 1) % 3];
            points += crossed(p, q, layer - 1) + crossed(p, q, layer) + (pos[p] === 2 * layer - 1);
          }
          n += Math.max(1, points - 2);
        }
        pieces += n;
        bytes += n * (`${tsep}<triangle v1="" v2="" v3="" ${colourNames[f]}=""/>`.length + 1 + 3 * digits(Math.min(a, b, c)));
        for (let k = 0; k < 3; k++) { const p = face.v[k], q = face.v[(k + 1) % 3]; edges[3 * f + k] = p < q ? p * 2 ** 26 + q : q * 2 ** 26 + p; }
      });
      edges.sort();
      const vertexLine = `${vsep}<vertex x="" y="" z=""/>`.length;
      for (let i = 0; i < edges.length; i++) {
        if (i && edges[i] === edges[i - 1]) continue;
        const p = Math.floor(edges[i] / 2 ** 26), q = edges[i] - p * 2 ** 26, P = pts[p], Q = pts[q];
        for (let k = Math.floor(Math.min(pos[p], pos[q]) / 2) + 1, top = Math.ceil(Math.max(pos[p], pos[q]) / 2) - 1; k <= top; k++) {
          const s = (layerPlane(k, first, height) - zv[p]) / (zv[q] - zv[p]);
          bytes += vertexLine + String(P[0] + s * (Q[0] - P[0])).length + String(P[1] + s * (Q[1] - P[1])).length + String(P[2] + s * (Q[2] - P[2])).length;
        }
      }
      const lower = writer.size() + (bodyAt + vertexEnd - last) + bytes + (text.length - (bodyAt + close));
      if (lower > maxMemberBytes) throw tooLarge(need - faces.length + pieces);

      let banded;
      try { banded = band(pts, faces, {zOf, first, height}); } catch (error) { throw Error(`"${name}" could not be cut into layers (${error.message}).`); }
      need += banded.pieces.length - faces.length;
      trianglesAfter += banded.pieces.length - faces.length;

      // Bed heights of every point, and each face's normal in bed orientation.
      const out = banded.vertices, zs = new Float64Array(out.length);
      for (let j = 0; j < out.length; j++) zs[j] = zOf(out[j]);
      const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const sign = det < 0 ? -1 : 1, normals = new Float64Array(3 * faces.length).fill(NaN);
      const world = p => [0, 1, 2].map(k => p[0] * M[0][k] + p[1] * M[1][k] + p[2] * M[2][k] + M[3][k]);
      const normalOf = f => {
        if (Number.isNaN(normals[3 * f])) {
          const [p, q, r] = faces[f].v.map(i => world(pts[i]));
          const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
          normals[3 * f] = sign * (u[1] * w[2] - u[2] * w[1]); normals[3 * f + 1] = sign * (u[2] * w[0] - u[0] * w[2]); normals[3 * f + 2] = sign * (u[0] * w[1] - u[1] * w[0]);
        }
        return [normals[3 * f], normals[3 * f + 1], normals[3 * f + 2]];
      };

      // Write: the vertex list as it was, the new vertices after it, then the pieces, each
      // under its own face's colour attribute name.
      writer.push(text.slice(last, bodyAt + vertexEnd));
      for (let j = nv; j < out.length; j++) writer.push(`${vsep}<vertex x="${out[j][0]}" y="${out[j][1]}" z="${out[j][2]}"/>`);
      writer.push(text.slice(bodyAt + vertexEnd, bodyAt + from));
      for (const piece of banded.pieces) {
        const [a, b, c] = piece.v, za = zs[a], zb = zs[b], zc = zs[c];
        const layer = pieceLayer({normal: normalOf(piece.face), zHigh: Math.max(za, zb, zc), zLow: Math.min(za, zb, zc), layer: piece.layer}, first, height);
        const sequence = byId.get(tuples[piece.state][0]).sequence, reel = sequence[layer % sequence.length];
        layerReels.set(layer, (layerReels.get(layer) || 0) | (1 << (reel - 1)));
        writer.push(`${tsep}<triangle v1="${a}" v2="${b}" v3="${c}" ${colourNames[piece.face]}="${leafCode(reel)}"${extraOf[piece.state]}/>`);
      }
      last = bodyAt + at;
    }
    writer.push(text.slice(last));
    work.set(member, writer.bytes());
  }

  // ---- project settings: the physical reels and the heights the pattern was cut for ----
  const cfg = JSON.parse(dec.decode(work.get(PROJECT)));
  const filaments = (cfg.filament_colour || []).length;
  if (filaments < reels.length) throw Error('The project lists fewer filaments than the reels chosen for built-in colours.');
  if (filaments > reels.length) {
    for (const [key, value] of Object.entries(cfg)) {
      if (key === 'different_settings_to_system') {
        if (Array.isArray(value) && value.length === filaments + 2) cfg[key] = [value[0], ...value.slice(1, 1 + reels.length), value[value.length - 1]];
      } else if (Array.isArray(value) && value.length === filaments) cfg[key] = value.slice(0, reels.length);
    }
  }
  const settings = {...outer.process, layer_height: String(height), initial_layer_print_height: String(first), mmu_segmented_region_max_width: String(depth),
    mmu_segmented_region_interlocking_depth: '0', dithering_local_z_mode: '0', mixed_filament_advanced_dithering: '0', mixed_filament_definitions: '',
    wall_loops: Number(cfg.wall_loops) >= 2 ? String(cfg.wall_loops) : '2', precise_z_height: '0'};
  Object.assign(cfg, settings);
  if (Array.isArray(cfg.different_settings_to_system) && typeof cfg.different_settings_to_system[0] === 'string')
    cfg.different_settings_to_system[0] = [...new Set([...cfg.different_settings_to_system[0].split(';').filter(Boolean), ...Object.keys(settings)])].sort().join(';');
  work.set(PROJECT, enc.encode(JSON.stringify(cfg, null, 2)));
  // A per-object layer height would override the global one and move every band. Parts
  // that print nothing carry a shade id as their filament from the export; they take the
  // backing reel, so that no filament number beyond the reels is left.
  // The same for per-object and per-part copies of the other settings the bands depend on.
  let overrides = outer.overridesReplaced, modelSettings = dec.decode(work.get(SETTINGS));
  for (const [k, value] of Object.entries({layer_height: String(height), initial_layer_print_height: String(first), dithering_local_z_mode: '0',
    mixed_filament_advanced_dithering: '0', mixed_filament_definitions: '', precise_z_height: '0'}))
    modelSettings = modelSettings.replace(new RegExp(`(<metadata(?: type="[^"]*")? key="${k}" value=")([^"]*)(")`, 'g'), (all, a, old, c) => (old === value ? all : (overrides += 1, `${a}${value}${c}`)));
  modelSettings = modelSettings.replace(/<part\b([^>]*)>([\s\S]*?)<\/part>/g, (whole, partAttrs, body) => ((attr(partAttrs, 'subtype') || 'normal_part') === 'normal_part' ? whole
    : `<part${partAttrs}>${body.replace(/(<metadata(?: type="[^"]*")? key="extruder" value=")(\d+)(")/g, (all, a, value, c) => (Number(value) ? `${a}${backingSlot}${c}` : all))}</part>`));
  for (const m of modelSettings.matchAll(/<metadata(?: type="[^"]*")? key="extruder" value="(\d+)"/g))
    if (Number(m[1]) > reels.length) throw Error(`The project still names filament ${m[1]}, beyond the ${reels.length} reels, so built-in colours stopped.`);
  work.set(SETTINGS, enc.encode(modelSettings));
  work.delete(HEIGHTS_PROFILE);

  // ---- the record ----
  const layers = layerReels.size ? Math.max(...layerReels.keys()) + 1 : 0;
  const perLayer = [...layerReels.values()].map(mask => { let n = 0; for (let b = mask; b; b &= b - 1) n += 1; return n; });
  const report = {schema: 'yab3d-built-in-colours', version: 1, target,
    reels: reels.map((reel, i) => ({slot: i + 1, name: String(reel.name || ''), type: String(reel.type || 'PLA'), color: norm(reel.color) || String(reel.color || '')})),
    backingSlot, outerDepth: depth, layerHeight: height, firstLayer: first,
    recipes: [...byId.values()].sort((a, b) => a.id - b.id).map(r => ({id: r.id, sequence: [...r.sequence], counts: Array.isArray(r.counts) ? [...r.counts] : [], color: String(r.color || ''), estimated: true})),
    triangles: {before: trianglesBefore, after: trianglesAfter}, layers,
    reelsPerLayer: {max: perLayer.length ? Math.max(...perLayer) : 0, mean: perLayer.length ? Math.round(1000 * perLayer.reduce((a, b) => a + b, 0) / perLayer.length) / 1000 : 0},
    settings, overridesReplaced: overrides, validation: {sliced: false, printed: false}, note: BUILT_IN_NOTE};
  work.set(BUILT_IN_PATH, enc.encode(JSON.stringify(report, null, 2)));

  for (const name of [...entries.keys()]) if (!work.has(name)) entries.delete(name);
  for (const [name, data] of work) entries.set(name, data);
  return report;
}
