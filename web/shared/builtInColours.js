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
import {layerIndex} from './layerBands.js';
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
// Below this many bytes per written triangle no triangle line can be, which makes the
// early size estimate a lower bound.
const MIN_TRIANGLE_BYTES = 40;
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

/** Object names and parts from model_settings.config. */
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

/** Corners of a paint split's children, as standard.splitChildren orders them (paintBands.js uses the same). */
function splitCorners(c, node) {
  const sides = Number(node.sides), s = sides === 3 ? 0 : Number(node.specialSide) % 3;
  const v0 = c[s], v1 = c[(s + 1) % 3], v2 = c[(s + 2) % 3];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  if (sides === 1) { const m = mid(v1, v2); return [[v0, v1, m], [m, v2, v0]]; }
  if (sides === 2) { const a = mid(v0, v1), b = mid(v2, v0); return [[v0, a, b], [a, v1, b], [v1, v2, b]]; }
  const m01 = mid(v0, v1), m12 = mid(v1, v2), m20 = mid(v2, v0);
  return [[v0, m01, m20], [m01, v1, m12], [m12, v2, m20], [m01, m12, m20]];
}

/** Barycentric coordinates of q in the triangle (a, b, c); all points in one plane. */
function barycentric(q, a, b, c) {
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v2 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01;
  if (!(Math.abs(den) > 0)) return [1 / 3, 1 / 3, 1 / 3];
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}

/** The state of the paint leaf a point lies in. The point is given in barycentric coordinates of the face. */
function stateAt(node, point) {
  let corners = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  while (node.kind === 'split') {
    const kids = splitCorners(corners, node);
    let best = 0, score = -Infinity;
    kids.forEach((k, i) => {
      const s = Math.min(...barycentric(point, k[0], k[1], k[2]));
      if (s > score) { best = i; score = s; }
    });
    corners = kids[best]; node = node.children[best];
  }
  return node.state;
}

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
 * `maxMemberBytes` overrides MAX_MEMBER_BYTES (for tests).
 */
export function applyBuiltInColours(entries, {target, reels, recipes, backingSlot, depth = BUILT_IN_DEPTH.standard, layerHeight,
  firstLayer = BUILT_IN_FIRST_LAYER, maxMemberBytes = MAX_MEMBER_BYTES} = {}) {
  const problem = builtInProblem({target, reels, backingSlot, depth, layerHeight});
  if (problem) throw Error(problem);
  if (!(typeof firstLayer === 'number' && Number.isFinite(firstLayer) && firstLayer > 0))
    throw Error('Choose a first-layer height above 0 mm for built-in colours.');
  const byId = recipesById(recipes, reels);
  const height = layerHeight, first = firstLayer;
  if (entries.has(HEIGHT_RANGES) && dec.decode(entries.get(HEIGHT_RANGES)).includes('layer_height'))
    throw Error('This project has height ranges that change the layer height. Built-in colours needs one fixed layer height; remove those ranges and export again.');

  // A copy, so that a refusal at any step leaves the caller's entries as they were.
  const work = new Map(entries);
  const outer = explicitOuterPaint(work, {target, innerSlot: backingSlot, depth});
  const {objects: objectNames, parts} = readSettings(dec.decode(work.get(SETTINGS)));
  const printedPart = id => parts.get(id)?.subtype === 'normal_part';

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
  const otherPaint = {copied: 0, splitByPiece: 0};
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
      const from = body.indexOf('>', open) + 1, faces = [], extras = [];
      let paintName = 'paint_color', at = from, sep = null;
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
        paintName = colour[0];
        let node;
        try { node = paint.decode(values[colour[0]]); } catch (error) { throw Error(`"${name}" has paint that cannot be read (${error.message}).`); }
        for (const s of paint.walkStates(node)) {
          if (s === 0) throw Error(`"${name}" has a face with no colour after the outer paint step, so built-in colours stopped.`);
          if (!byId.has(s)) throw Error(`Shade ${s} has no built-in colour recipe, so "${name}" cannot be coloured.`);
        }
        // Seam and support paint: a whole-face value goes on every piece; a split one is
        // read at each piece's centre. Anything else would be lost, so it is refused.
        let whole = '', splits = null;
        for (const k of other) {
          if (!OTHER_PAINT.test(k)) throw Error(`"${name}" has triangle data (${k}) that built-in colours cannot carry through the layer cuts.`);
          if (!values[k]) { whole += ` ${k}=""`; continue; }
          let tree;
          try { tree = paint.decode(values[k]); } catch (error) { throw Error(`"${name}" has ${k} paint that cannot be read (${error.message}).`); }
          if (tree.kind === 'leaf') { whole += ` ${k}="${values[k]}"`; otherPaint.copied += 1; } else { (splits ||= []).push({k, tree}); otherPaint.splitByPiece += 1; }
        }
        faces.push({v: ix, paint: node});
        if (whole || splits) extras[f] = {whole, splits};
      }
      const tail = body.slice(at, close);
      if (tail.trim()) throw Error(`"${name}" has something in its triangle list that is not a triangle, so built-in colours stopped.`);
      if (faces.length !== count(body, '<triangle', from, close)) throw Error(`"${name}" has a triangle that cannot be read, so built-in colours stopped.`);

      // A lower bound on the member's size, before the cut makes anything.
      // New vertices go straight after the last existing one (or after the opening tag).
      const vOpen = body.indexOf('<vertices'), vClose = body.indexOf('</vertices>'), vLast = body.lastIndexOf('<vertex', vClose);
      const vertexEnd = vLast === vOpen ? body.indexOf('>', vOpen) + 1 : body.indexOf('>', vLast) + 1;
      const vFirst = body.indexOf('<vertex', vOpen + 9);
      const vsep = vLast === vOpen ? '' : body.slice(body.lastIndexOf('>', vFirst) + 1, vFirst);
      let spans = 0;
      for (const face of faces) {
        const zs = face.v.map(i => zOf(pts[i]));
        spans += layerIndex(Math.max(...zs), first, height) - layerIndex(Math.min(...zs), first, height) + 1;
      }
      const lower = writer.size() + (bodyAt + vertexEnd - last) + spans * MIN_TRIANGLE_BYTES + (text.length - (bodyAt + close));
      if (lower > maxMemberBytes) throw tooLarge(need - faces.length + spans);

      let banded;
      try { banded = bandMesh(pts, faces, {zOf, first, height}); } catch (error) { throw Error(`"${name}" could not be cut into layers (${error.message}).`); }
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

      // Write: the vertex list as it was, the new vertices after it, then the pieces.
      writer.push(text.slice(last, bodyAt + vertexEnd));
      for (let j = nv; j < out.length; j++) writer.push(`${vsep}<vertex x="${out[j][0]}" y="${out[j][1]}" z="${out[j][2]}"/>`);
      writer.push(text.slice(bodyAt + vertexEnd, bodyAt + from));
      const tsep = sep ?? '';
      for (const piece of banded.pieces) {
        const [a, b, c] = piece.v, za = zs[a], zb = zs[b], zc = zs[c];
        const layer = pieceLayer({normal: normalOf(piece.face), zHigh: Math.max(za, zb, zc), zLow: Math.min(za, zb, zc), layer: piece.layer}, first, height);
        const sequence = byId.get(piece.state).sequence, reel = sequence[layer % sequence.length];
        layerReels.set(layer, (layerReels.get(layer) || 0) | (1 << (reel - 1)));
        let extra = '';
        const e = extras[piece.face];
        if (e) {
          extra = e.whole;
          if (e.splits) {
            const corners = faces[piece.face].v.map(i => out[i]), centre = [0, 1, 2].map(k => (out[a][k] + out[b][k] + out[c][k]) / 3);
            const where = barycentric(centre, corners[0], corners[1], corners[2]);
            for (const {k, tree} of e.splits) { const s = stateAt(tree, where); if (s) extra += ` ${k}="${leafCode(s)}"`; }
          }
        }
        writer.push(`${tsep}<triangle v1="${a}" v2="${b}" v3="${c}" ${paintName}="${leafCode(reel)}"${extra}/>`);
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
    wall_loops: Number(cfg.wall_loops) >= 2 ? String(cfg.wall_loops) : '2'};
  Object.assign(cfg, settings);
  if (Array.isArray(cfg.different_settings_to_system) && typeof cfg.different_settings_to_system[0] === 'string')
    cfg.different_settings_to_system[0] = [...new Set([...cfg.different_settings_to_system[0].split(';').filter(Boolean), ...Object.keys(settings)])].sort().join(';');
  work.set(PROJECT, enc.encode(JSON.stringify(cfg, null, 2)));
  // A per-object layer height would override the global one and move every band.
  work.set(SETTINGS, enc.encode(dec.decode(work.get(SETTINGS)).replace(/(<metadata(?: type="[^"]*")? key="layer_height" value=")[^"]*(")/g, `$1${height}$2`)));
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
    seamAndSupportPaint: otherPaint, settings, validation: {sliced: false, printed: false}, note: BUILT_IN_NOTE};
  work.set(BUILT_IN_PATH, enc.encode(JSON.stringify(report, null, 2)));

  for (const name of [...entries.keys()]) if (!work.has(name)) entries.delete(name);
  for (const [name, data] of work) entries.set(name, data);
  return report;
}
