// Stray specks of colour (experimental).
//
// Painted models often carry tiny patches of a colour that nobody meant: a few faces
// left behind by a fill, narrower than the nozzle can draw. Each one still costs a
// filament change on every layer it touches. This finds patches of one colour that are
// narrower than a printed line and wholly surrounded by a single other colour, and
// paints them to match their surroundings.
//
// It works on a finished export and only changes paint. Only faces painted whole are
// considered: a face whose paint is subdivided is left alone and stops a patch from
// being judged, so nothing next to fine detail is touched.
import * as paint from './paint.js';

export const SPECK_PATH = 'Metadata/YAB3D_speck_cleanup.json';
// Widest speck removed, in millimetres. About one printed line of a 0.4 mm nozzle.
export const SPECK_WIDTH = { min: 0.2, max: 2, standard: 0.5 };
const SETTINGS = 'Metadata/model_settings.config';
const enc = new TextEncoder(), dec = new TextDecoder();
const PAINT = /\s((?:slic3rpe:)?(?:mmu_segmentation|paint_color))="([0-9A-Fa-f]*)"/;

/**
 * Which faces to repaint. `faces` are {points, state}; state is the filament a face prints
 * in, or null when its paint is subdivided. Returns a Map of face index to new state.
 */
export function findSpecks(faces, maxWidth = SPECK_WIDTH.standard) {
  const ids = new Map(), key = p => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const id = p => { const k = key(p); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const corners = faces.map(f => f.points.map(id));
  const parent = faces.map((_, i) => i), find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  // Every edge with the faces on it, whatever their colour.
  const edges = new Map();
  faces.forEach((face, i) => {
    for (let k = 0; k < 3; k += 1) {
      const a = corners[i][k], b = corners[i][(k + 1) % 3];
      if (a === b) continue;
      const name = a < b ? `${a}|${b}` : `${b}|${a}`;
      let edge = edges.get(name);
      if (!edge) edges.set(name, edge = { faces: [], length: Math.hypot(...face.points[k].map((v, d) => v - face.points[(k + 1) % 3][d])) });
      edge.faces.push(i);
    }
  });
  for (const edge of edges.values()) for (let x = 0; x < edge.faces.length; x += 1) for (let y = x + 1; y < edge.faces.length; y += 1) {
    const p = edge.faces[x], q = edge.faces[y];
    if (faces[p].state !== null && faces[p].state === faces[q].state) parent[find(p)] = find(q);
  }
  const patches = new Map();
  const patch = i => { const root = find(i); if (!patches.has(root)) patches.set(root, { area: 0, outline: 0, around: new Set(), open: false, members: [] }); return patches.get(root); };
  faces.forEach((face, i) => {
    if (face.state === null) return;
    const [p, q, r] = face.points, u = q.map((v, d) => v - p[d]), w = r.map((v, d) => v - p[d]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], here = patch(i);
    here.area += Math.hypot(...n) / 2; here.members.push(i);
  });
  for (const edge of edges.values()) {
    const roots = new Set(edge.faces.map(i => faces[i].state === null ? null : find(i)));
    for (const i of edge.faces) {
      if (faces[i].state === null) continue;
      const here = patch(i), others = edge.faces.filter(j => j !== i && (faces[j].state === null || find(j) !== find(i)));
      const lone = edge.faces.length === 1;
      if (!others.length && !lone) continue;           // an edge inside the patch
      here.outline += edge.length;
      // An open mesh edge or a neighbour with fine paint: the surroundings are not known.
      if (lone || others.some(j => faces[j].state === null)) here.open = true;
      for (const j of others) if (faces[j].state !== null) here.around.add(faces[j].state);
    }
    void roots;
  }
  const changes = new Map();
  for (const here of patches.values()) {
    if (here.open || here.around.size !== 1 || !(here.outline > 0)) continue;
    // Four times the area over the outline is a disc's diameter, and twice a long band's width.
    if (4 * here.area / here.outline >= maxWidth) continue;
    const state = [...here.around][0];
    for (const i of here.members) changes.set(i, state);
  }
  return changes;
}

export function speckProblem({ width }) {
  return Number.isFinite(width) && width >= SPECK_WIDTH.min && width <= SPECK_WIDTH.max ? '' : `Choose a speck width from ${SPECK_WIDTH.min} to ${SPECK_WIDTH.max} mm.`;
}

/** Rewrite exported entries in place. */
export function applySpeckCleanup(entries, { width = SPECK_WIDTH.standard } = {}) {
  const problem = speckProblem({ width });
  if (problem) throw Error(problem);
  if (!entries.has(SETTINGS)) throw Error('Speck clean-up needs a native slicer project.');
  const own = new Map();
  for (const m of dec.decode(entries.get(SETTINGS)).matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[1])?.[1], subtype = /\bsubtype="([^"]+)"/.exec(m[1])?.[1] || 'normal_part';
    const extruder = /<metadata(?: type="[^"]*")? key="extruder" value="(\d+)"/.exec(m[2]);
    if (id && subtype === 'normal_part' && extruder) own.set(id, Number(extruder[1]));
  }
  const report = { schema: 'yab3d-speck-cleanup', version: 1, maxWidthMm: width, meshes: 0, faces: 0, specks: 0, facesRepainted: 0, validation: { sliced: false, printed: false } };
  for (const [name, data] of entries) {
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const before = dec.decode(data);
    const after = before.replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/g, (whole, attrs, body) => {
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      if (!own.has(id) || !body.includes('<triangle')) return whole;
      const vertices = [];
      for (const v of body.matchAll(/<vertex\b([^>]*)\/>/g)) {
        const x = /\bx="([^"]+)"/.exec(v[1]), y = /\by="([^"]+)"/.exec(v[1]), z = /\bz="([^"]+)"/.exec(v[1]);
        vertices.push([Number(x?.[1]), Number(y?.[1]), Number(z?.[1])]);
      }
      const base = own.get(id), faces = [];
      for (const m of body.matchAll(/<triangle\b([^>]*?)\/>/g)) {
        const corner = key => vertices[Number(new RegExp(`\\b${key}="(\\d+)"`).exec(m[1])?.[1])];
        const points = [corner('v1'), corner('v2'), corner('v3')];
        const found = PAINT.exec(m[1]);
        let state = base;
        if (found && found[2]) { const node = paint.decode(found[2]); state = node.kind === 'leaf' ? (node.state === 0 ? base : node.state) : null; }
        // A face with a missing corner cannot be placed: treat it as unknown ground.
        faces.push(points.some(p => !p || !p.every(Number.isFinite)) ? { points: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], state: null } : { points, state });
      }
      report.meshes += 1; report.faces += faces.length;
      const changes = findSpecks(faces, width);
      if (!changes.size) return whole;
      report.facesRepainted += changes.size;
      // One speck per group of touching repainted faces is close enough for a count.
      report.specks += new Set([...changes.keys()].map(i => `${faces[i].state}>${changes.get(i)}`)).size;
      let index = -1;
      return `<object${attrs}>${body.replace(/<triangle\b([^>]*?)\/>/g, (triangle, tri) => {
        index += 1;
        if (!changes.has(index)) return triangle;
        const text = paint.encode({ kind: 'leaf', state: changes.get(index) }), found = PAINT.exec(tri);
        return found ? `<triangle${tri.replace(found[0], ` ${found[1]}="${text}"`)}/>` : `<triangle${tri} paint_color="${text}"/>`;
      })}</object>`;
    });
    if (after !== before) entries.set(name, enc.encode(after));
  }
  entries.set(SPECK_PATH, enc.encode(JSON.stringify(report, null, 2)));
  return report;
}
