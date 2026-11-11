// Top surface interweave (experimental).
//
// Blended colours are made by alternating whole layers of two filaments. Seen
// edge-on, on a wall, the layers merge into one colour. Seen from above, on a
// flat top or a shallow slope, each layer is a wide band. This rewrites the
// paint on those faces: a blended colour becomes a fine chequer of its two
// filaments in the XY plane, in proportion to the blend, so the mixing happens
// within the surface instead of between layers.
//
// It works on a finished export and only changes paint. No vertex or triangle
// is added, moved or reordered; the chequer is the slicer's own facet
// subdivision, the same encoding its paint brush writes.
import * as paint from './paint.js';
import { splitChildren } from './standard.js';

export const INTERWEAVE_PATH = 'Metadata/YAB3D_top_interweave.json';
export const INTERWEAVE_TARGETS = ['snapmaker', 'bambu', 'orca'];
export const INTERWEAVE_CELL = { min: 0.8, max: 2.4, standard: 1.2 };
// Faces within about 30 degrees of horizontal.
export const INTERWEAVE_MIN_UP = 0.866;
const ROOT = '3D/3dmodel.model', SETTINGS = 'Metadata/model_settings.config';
const enc = new TextEncoder(), dec = new TextDecoder();
const PAINT = /\s((?:slic3rpe:)?(?:mmu_segmentation|paint_color))="([0-9A-Fa-f]*)"/;
// Ordered dither: at 50% this is an exact chequer, and other shares spread evenly.
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const MAX_TREE_DEPTH = 11, LARGE_FACE_LEAVES = 20000;

export function interweaveProblem({ target, cell }) {
  if (!INTERWEAVE_TARGETS.includes(target)) return 'Top surface interweave exports to Snapmaker Orca, Bambu Studio or OrcaSlicer.';
  if (!Number.isFinite(cell) || cell < INTERWEAVE_CELL.min || cell > INTERWEAVE_CELL.max)
    return `Choose a pattern size from ${INTERWEAVE_CELL.min} to ${INTERWEAVE_CELL.max} mm.`;
  return '';
}

/** Which filament a chequer cell prints in, for a blend with `share` of filament b. */
export function cellFilament(i, j, recipe) {
  const threshold = (BAYER[((i % 4) + 4) % 4][((j % 4) + 4) % 4] + 0.5) / 16;
  return threshold < recipe.percent / 100 ? recipe.b : recipe.a;
}

/** Paint one triangle (world coordinates) as a chequer of the recipe's two filaments. */
export function weave(triangle, recipe, cell, depth, budget) {
  const xs = triangle.map(p => p[0]), ys = triangle.map(p => p[1]);
  const i0 = Math.floor(Math.min(...xs) / cell), i1 = Math.floor(Math.max(...xs) / cell);
  const j0 = Math.floor(Math.min(...ys) / cell), j1 = Math.floor(Math.max(...ys) / cell);
  const centre = [(xs[0] + xs[1] + xs[2]) / 3, (ys[0] + ys[1] + ys[2]) / 3];
  const leaf = () => ({ kind: 'leaf', state: cellFilament(Math.floor(centre[0] / cell), Math.floor(centre[1] / cell), recipe) });
  if (i0 === i1 && j0 === j1) return leaf();
  // Every cell this triangle touches may already be the same filament.
  let same = true; const first = cellFilament(i0, j0, recipe);
  for (let i = i0; i <= i1 && same; i += 1) for (let j = j0; j <= j1; j += 1) if (cellFilament(i, j, recipe) !== first) { same = false; break; }
  if (same && (i1 - i0 + 1) * (j1 - j0 + 1) <= 64) return { kind: 'leaf', state: first };
  const longest = Math.max(...[0, 1, 2].map(k => Math.hypot(triangle[k][0] - triangle[(k + 1) % 3][0], triangle[k][1] - triangle[(k + 1) % 3][1], triangle[k][2] - triangle[(k + 1) % 3][2])));
  // Refine cell edges to half a cell; finer than that is below what a nozzle can show.
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
  // Two-filament blends only; gradients change with height and are left to the slicer.
  const blends = new Map();
  recipes.forEach((r, index) => { if (!r.c && !r.gradient && Number.isInteger(r.a) && Number.isInteger(r.b) && r.percent > 0 && r.percent < 100) blends.set(physical + index + 1, { a: r.a, b: r.b, percent: r.percent }); });
  const report = { schema: 'yab3d-top-interweave', version: 1, target, cellMm: cell, maxSlopeDegrees: Math.round(Math.acos(minUp) * 180 / Math.PI), blends: blends.size, meshes: 0, faces: 0, facesInterwoven: 0, cells: 0, facesAtDetailLimit: 0, validation: { sliced: false, printed: false } };
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
        // Flat tops, shallow slopes, and the matching faces underneath.
        if (!(length > 1e-12) || Math.abs(n[2]) / length < minUp) return triangle;
        const found = PAINT.exec(tri);
        const node = found && found[2] ? paint.decode(found[2]) : { kind: 'leaf', state: 0 };
        const filled = node.kind === 'leaf' && node.state === 0 ? { kind: 'leaf', state: base } : node;
        const budget = { leaves: 1 }, woven = interweaveNode(points, filled, blends, cell, 0, budget);
        if (!woven) return triangle;
        const text = paint.encode(woven);
        paint.decode(text);                      // never write a tree the reader would refuse
        report.facesInterwoven += 1; report.cells += budget.leaves;
        if (budget.leaves >= LARGE_FACE_LEAVES) report.facesAtDetailLimit += 1;
        return found ? `<triangle${tri.replace(found[0], ` ${found[1]}="${text}"`)}/>` : `<triangle${tri} paint_color="${text}"/>`;
      })}</object>`;
    });
    if (after !== before) entries.set(name, enc.encode(after));
  }
  entries.set(INTERWEAVE_PATH, enc.encode(JSON.stringify(report, null, 2)));
  return report;
}
