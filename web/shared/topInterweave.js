// Top surface interweave (experimental).
//
// Blended colours are made by alternating whole layers of two filaments. Seen
// edge-on, on a wall, the layers merge into one colour. Seen from above, on a
// flat top or a shallow slope, each layer is a wide band. This rewrites the
// paint on those faces: a blended colour becomes narrow stripes of its two or
// three filaments in the XY plane, in proportion to the blend, so the mixing
// happens within the surface instead of between layers. A blend that is nearly
// all one filament prints as that filament alone there: one stray stripe in
// eight shows more than the small shift in colour does.
//
// It works on a finished export and only changes paint. No vertex or triangle
// is added, moved or reordered; the chequer is the slicer's own facet
// subdivision, the same encoding its paint brush writes.
import * as paint from './paint.js';
import { splitChildren } from './standard.js';

export const INTERWEAVE_PATH = 'Metadata/YAB3D_top_interweave.json';
export const INTERWEAVE_TARGETS = ['snapmaker', 'bambu', 'orca'];
// The width of one stripe. Half a millimetre is about one printed line of a 0.4 mm nozzle.
export const INTERWEAVE_CELL = { min: 0.4, max: 1.6, standard: 0.5 };
// Faces within about 30 degrees of horizontal.
export const INTERWEAVE_MIN_UP = 0.866;
const ROOT = '3D/3dmodel.model', SETTINGS = 'Metadata/model_settings.config';
const enc = new TextEncoder(), dec = new TextDecoder();
const PAINT = /\s((?:slic3rpe:)?(?:mmu_segmentation|paint_color))="([0-9A-Fa-f]*)"/;
// Stripes, not squares. A first print showed that a chequer of 1.2 mm squares prints as
// separate blobs: each square is its own start, stop and retraction. A stripe is one
// continuous line of filament, so the pattern is narrow diagonal stripes, running the
// way top-surface lines are laid. Ordered so that any share is spread evenly: at 50%
// the reels alternate stripe by stripe.
const ORDER = [0, 4, 2, 6, 1, 5, 3, 7];
const MAX_TREE_DEPTH = 11, LARGE_FACE_LEAVES = 20000;
// At or above this share, the leading filament prints the shallow face on its own.
export const INTERWEAVE_SOLID_SHARE = 80;

export function interweaveProblem({ target, cell }) {
  if (!INTERWEAVE_TARGETS.includes(target)) return 'Top surface interweave exports to Snapmaker Orca, Bambu Studio or OrcaSlicer.';
  if (!Number.isFinite(cell) || cell < INTERWEAVE_CELL.min || cell > INTERWEAVE_CELL.max)
    return `Choose a stripe width from ${INTERWEAVE_CELL.min} to ${INTERWEAVE_CELL.max} mm.`;
  return '';
}

/** Which filament stripe number `i` prints in, for a blend with `percent` of filament b. */
export function stripeFilament(i, recipe) {
  const threshold = (ORDER[((i % 8) + 8) % 8] + 0.5) / 8, b = recipe.percent / 100;
  if (threshold < b) return recipe.b;
  // A third filament takes the next stripes in the same even order.
  return recipe.c && threshold < b + recipe.percentC / 100 ? recipe.c : recipe.a;
}
/** The filament that prints a shallow face alone, or 0 when the blend should be striped. */
export function solidFilament(recipe) {
  const shares = [[recipe.a, 100 - recipe.percent - (recipe.c ? recipe.percentC : 0)], [recipe.b, recipe.percent], ...(recipe.c ? [[recipe.c, recipe.percentC]] : [])];
  const lead = shares.reduce((best, part) => part[1] > best[1] ? part : best);
  return lead[1] >= INTERWEAVE_SOLID_SHARE ? lead[0] : 0;
}
/** A point's distance across the stripes: they run diagonally in the bed plane. */
const across = (x, y) => (x + y) * Math.SQRT1_2;

/** Paint one triangle (world coordinates) as stripes of the recipe's two filaments. */
export function weave(triangle, recipe, cell, depth, budget) {
  const solid = solidFilament(recipe);
  if (solid) { budget.solid = true; return { kind: 'leaf', state: solid }; }
  const us = triangle.map(p => across(p[0], p[1]));
  const i0 = Math.floor(Math.min(...us) / cell), i1 = Math.floor(Math.max(...us) / cell);
  const leaf = () => ({ kind: 'leaf', state: stripeFilament(Math.floor((us[0] + us[1] + us[2]) / 3 / cell), recipe) });
  if (i0 === i1) return leaf();
  // Every stripe this triangle touches may already be the same filament.
  let same = i1 - i0 < 64; const first = stripeFilament(i0, recipe);
  for (let i = i0; i <= i1 && same; i += 1) if (stripeFilament(i, recipe) !== first) same = false;
  if (same) return { kind: 'leaf', state: first };
  const longest = Math.max(...[0, 1, 2].map(k => Math.hypot(triangle[k][0] - triangle[(k + 1) % 3][0], triangle[k][1] - triangle[(k + 1) % 3][1], triangle[k][2] - triangle[(k + 1) % 3][2])));
  // Refine stripe edges to half a stripe; finer than that is below what a nozzle can show.
  if (depth >= MAX_TREE_DEPTH || longest < cell / 2) return leaf();
  const node = { kind: 'split', sides: 3, specialSide: 0 };
  budget.leaves += 3;
  node.children = splitChildren(triangle, node).map(child => weave(child, recipe, cell, depth + 1, budget));
  return node;
}

/** Replace blended leaves of an existing paint tree with a chequer. Returns null when nothing changed. */
export function interweaveNode(triangle, node, recipes, cell, depth = 0, budget = { leaves: 1 }) {
  if (node.kind === 'leaf') {
    const recipe = recipes.get(node.state);
    return recipe ? weave(triangle, recipe, cell, depth, budget) : null;
  }
  const children = splitChildren(triangle, node);
  let changed = false;
  const next = node.children.map((child, index) => { const out = interweaveNode(children[index], child, recipes, cell, depth + 1, budget); if (out) changed = true; return out || child; });
  return changed ? { ...node, children: next } : null;
}

const numbers = text => String(text || '').trim().split(/\s+/).map(Number);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
/** 3MF row-vector transforms: apply `first`, then `second`. */
function compose(first, second) {
  const a = first, b = second, out = [];
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 3; c += 1) {
    const row = r < 3 ? [a[r * 3], a[r * 3 + 1], a[r * 3 + 2], 0] : [a[9], a[10], a[11], 1];
    out.push(row[0] * b[c] + row[1] * b[3 + c] + row[2] * b[6 + c] + row[3] * b[9 + c]);
  }
  return out;
}
const apply = (m, p) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9], p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10], p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];
const transformOf = attrs => { const m = /\btransform="([^"]+)"/.exec(attrs); const values = m ? numbers(m[1]) : IDENTITY; return values.length === 12 && values.every(Number.isFinite) ? values : IDENTITY; };

/** Rewrite exported entries in place. `recipes` are the export's blends, numbered after the physical filaments. */
export function applyTopInterweave(entries, { target, cell = INTERWEAVE_CELL.standard, recipes = [], physical = 0, minUp = INTERWEAVE_MIN_UP }) {
  const problem = interweaveProblem({ target, cell });
  if (problem) throw Error(problem);
  if (!entries.has(ROOT) || !entries.has(SETTINGS)) throw Error('Top surface interweave needs a native slicer project. Choose a printer project export.');
  // Blends of two or three filaments; gradients change with height and are left to the slicer.
  const blends = new Map();
  recipes.forEach((r, index) => {
    if (r.gradient || !Number.isInteger(r.a) || !Number.isInteger(r.b) || !(r.percent > 0)) return;
    const third = r.c != null;
    if (third && !(Number.isInteger(r.c) && r.percentC > 0)) return;
    if (!(r.percent + (third ? r.percentC : 0) < 100)) return;
    blends.set(physical + index + 1, third ? { a: r.a, b: r.b, percent: r.percent, c: r.c, percentC: r.percentC } : { a: r.a, b: r.b, percent: r.percent });
  });
  const report = { schema: 'yab3d-top-interweave', version: 2, target, cellMm: cell, solidAtSharePercent: INTERWEAVE_SOLID_SHARE, maxSlopeDegrees: Math.round(Math.acos(minUp) * 180 / Math.PI), blends: blends.size, threeFilamentBlends: [...blends.values()].filter(b => b.c).length, meshes: 0, faces: 0, facesInterwoven: 0, facesSolid: 0, cells: 0, facesAtDetailLimit: 0, validation: { sliced: false, printed: false } };
  if (!blends.size) { entries.set(INTERWEAVE_PATH, enc.encode(JSON.stringify(report, null, 2))); return report; }

  // Where each mesh sits in the world: its component transform, then its first build item's.
  const root = dec.decode(entries.get(ROOT)), items = new Map(), world = new Map();
  for (const m of root.matchAll(/<item\b([^>]*)\/>/g)) { const id = /\bobjectid="([^"]+)"/.exec(m[1])?.[1]; if (id && !items.has(id)) items.set(id, transformOf(m[1])); }
  for (const m of root.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[1])?.[1], item = items.get(id);
    if (!id || !item) continue;
    for (const c of m[2].matchAll(/<component\b([^>]*)\/>/g)) {
      const ref = /\bobjectid="([^"]+)"/.exec(c[1])?.[1], path = (/\bp:path="([^"]+)"/.exec(c[1])?.[1] || `/${ROOT}`).replace(/^\//, '');
      if (ref && !world.has(`${path}#${ref}`)) world.set(`${path}#${ref}`, compose(transformOf(c[1]), item));
    }
    if (/<mesh\b/.test(m[2]) && !world.has(`${ROOT}#${id}`)) world.set(`${ROOT}#${id}`, item);
  }
  // The filament an unpainted face prints in.
  const own = new Map();
  for (const m of dec.decode(entries.get(SETTINGS)).matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[1])?.[1], subtype = /\bsubtype="([^"]+)"/.exec(m[1])?.[1] || 'normal_part';
    const extruder = /<metadata(?: type="[^"]*")? key="extruder" value="(\d+)"/.exec(m[2]);
    if (id && subtype === 'normal_part' && extruder) own.set(id, Number(extruder[1]));
  }

  for (const [name, data] of entries) {
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const before = dec.decode(data);
    const after = before.replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/g, (whole, attrs, body) => {
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1], matrix = world.get(`${name}#${id}`);
      if (!matrix || !own.has(id) || !body.includes('<triangle')) return whole;
      const vertices = [];
      for (const v of body.matchAll(/<vertex\b([^>]*)\/>/g)) {
        const x = /\bx="([^"]+)"/.exec(v[1]), y = /\by="([^"]+)"/.exec(v[1]), z = /\bz="([^"]+)"/.exec(v[1]);
        vertices.push(apply(matrix, [Number(x?.[1]), Number(y?.[1]), Number(z?.[1])]));
      }
      report.meshes += 1;
      const base = own.get(id);
      return `<object${attrs}>${body.replace(/<triangle\b([^>]*?)\/>/g, (triangle, tri) => {
        report.faces += 1;
        const corner = key => vertices[Number(new RegExp(`\\b${key}="(\\d+)"`).exec(tri)?.[1])];
        const points = [corner('v1'), corner('v2'), corner('v3')];
        if (points.some(p => !p || !p.every(Number.isFinite))) return triangle;
        const u = points[1].map((v, i) => v - points[0][i]), w = points[2].map((v, i) => v - points[0][i]);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], length = Math.hypot(...n);
        // Flat tops and shallow upward slopes only. Faces that look down are left alone:
        // on the bed they are the first layer, and a first layer cut into small
        // squares of two reels does not stick.
        if (!(length > 1e-12) || n[2] / length < minUp) return triangle;
        const found = PAINT.exec(tri);
        const node = found && found[2] ? paint.decode(found[2]) : { kind: 'leaf', state: 0 };
        const filled = node.kind === 'leaf' && node.state === 0 ? { kind: 'leaf', state: base } : node;
        const budget = { leaves: 1 }, woven = interweaveNode(points, filled, blends, cell, 0, budget);
        if (!woven) return triangle;
        const text = paint.encode(woven);
        paint.decode(text);                      // never write a tree the reader would refuse
        report.facesInterwoven += 1; report.cells += budget.leaves;
        if (budget.solid && budget.leaves === 1) report.facesSolid += 1;
        if (budget.leaves >= LARGE_FACE_LEAVES) report.facesAtDetailLimit += 1;
        return found ? `<triangle${tri.replace(found[0], ` ${found[1]}="${text}"`)}/>` : `<triangle${tri} paint_color="${text}"/>`;
      })}</object>`;
    });
    if (after !== before) entries.set(name, enc.encode(after));
  }
  entries.set(INTERWEAVE_PATH, enc.encode(JSON.stringify(report, null, 2)));
  return report;
}
