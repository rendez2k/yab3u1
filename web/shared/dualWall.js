// Dual-wall mixing for real models (experimental).
//
// Painted colour is limited to the outer wall by the slicer's own paint-depth
// setting; everything behind it prints in one chosen "inner" filament. For that
// to be safe, every outside face must carry explicit paint: a face left to the
// part's own filament would otherwise show the inner filament on the surface.
//
// This rewrites an already exported project. It adds no geometry and changes no
// vertex, so painting, supports and seams stay exactly where the export put them.
import * as paint from './paint.js';

export const DUAL_WALL_PATH = 'Metadata/YAB3D_dual_wall.json';
export const DUAL_WALL_TARGETS = ['snapmaker', 'bambu', 'orca'];
export const DUAL_WALL_DEPTH = { min: 0.3, max: 1.2, standard: 0.45 };
const SETTINGS = 'Metadata/model_settings.config', PROJECT = 'Metadata/project_settings.config';
const enc = new TextEncoder(), dec = new TextDecoder();
const PAINT = /\s((?:slic3rpe:)?(?:mmu_segmentation|paint_color))="([0-9A-Fa-f]*)"/;

/** Unpainted leaves take the part's own filament, written out explicitly. */
function fill(node, state) {
  if (node.kind === 'leaf') return node.state === 0 ? { kind: 'leaf', state } : node;
  return { ...node, children: node.children.map(child => fill(child, state)) };
}

export function dualWallProblem({ target, innerSlot, depth, filaments }) {
  if (!DUAL_WALL_TARGETS.includes(target)) return 'Dual-wall mixing exports to Snapmaker Orca, Bambu Studio or OrcaSlicer.';
  if (!Number.isInteger(innerSlot) || innerSlot < 1 || innerSlot > filaments) return 'Choose one of the loaded filaments for the inner walls.';
  if (!Number.isFinite(depth) || depth < DUAL_WALL_DEPTH.min || depth > DUAL_WALL_DEPTH.max)
    return `Choose an outer colour depth from ${DUAL_WALL_DEPTH.min} to ${DUAL_WALL_DEPTH.max} mm.`;
  return '';
}

/**
 * The shared first step: every outside face gets explicit paint, parts move to one inner reel,
 * and the paint-depth settings are written. Rewrites the entries in place and returns what
 * changed; it writes no record of its own, so each caller reports in its own way.
 */
export function explicitOuterPaint(entries, { target, innerSlot, depth = DUAL_WALL_DEPTH.standard }) {
  const settingsText = entries.has(SETTINGS) ? dec.decode(entries.get(SETTINGS)) : null;
  const projectText = entries.has(PROJECT) ? dec.decode(entries.get(PROJECT)) : null;
  if (settingsText === null || projectText === null) throw Error('Dual-wall mixing needs a native slicer project. Choose a printer project export.');
  const cfg = JSON.parse(projectText), filaments = (cfg.filament_colour || []).length;
  const problem = dualWallProblem({ target, innerSlot, depth, filaments });
  if (problem) throw Error(problem);

  // Which filament each solid mesh prints in when a face has no paint.
  const own = new Map();
  let partsChanged = 0, singleWalls = 0, overrides = 0;
  // An object or part may carry its own paint depth (the exporter carries the source's
  // value over, e.g. 0 = unlimited or 5 mm), which would override the project's.
  const replaceOwn = (text, key, value) => text.replace(new RegExp(`(<metadata(?: type="[^"]*")? key="${key}" value=")([^"]*)(")`, 'g'),
    (all, a, old, c) => (old === value ? all : (overrides += 1, `${a}${value}${c}`)));
  const settings = settingsText.replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/g, (whole, attrs, body) => {
    const objectExtruder = /<metadata(?: type="[^"]*")? key="extruder" value="(\d+)"/.exec(body.replace(/<part\b[\s\S]*?<\/part>/g, ''));
    let next = body.replace(/<part\b([^>]*)>([\s\S]*?)<\/part>/g, (part, partAttrs, partBody) => {
      const id = /\bid="([^"]+)"/.exec(partAttrs)?.[1], subtype = /\bsubtype="([^"]+)"/.exec(partAttrs)?.[1] || 'normal_part';
      if (!id || subtype !== 'normal_part') return part;   // modifiers and cutouts keep their role
      const extruder = /<metadata(?: type="[^"]*")? key="extruder" value="(\d+)"/.exec(partBody);
      const base = Number(extruder?.[1] || objectExtruder?.[1] || 1);
      own.set(id, base); partsChanged += 1;
      const tag = `<metadata key="extruder" value="${innerSlot}"/>`;
      return `<part${partAttrs}>${extruder ? partBody.replace(extruder[0], tag) : tag + partBody}</part>`;
    });
    // The object's own filament follows, so nothing falls back to an outer colour.
    const marker = /<metadata(?: type="[^"]*")? key="extruder" value="\d+"\/>/;
    const head = next.split(/<part\b/)[0];
    if (marker.test(head)) next = next.replace(marker, `<metadata key="extruder" value="${innerSlot}"/>`);
    // An object told to print a single wall would have no inner wall to colour.
    next = next.replace(/(<metadata(?: type="[^"]*")? key="wall_loops" value=")([^"]*)(")/g, (all, a, value, c) => Number(value) >= 2 ? all : (singleWalls += 1, `${a}2${c}`));
    next = replaceOwn(replaceOwn(next, 'mmu_segmented_region_max_width', String(depth)), 'mmu_segmented_region_interlocking_depth', '0');
    return `<object${attrs}>${next}</object>`;
  });
  if (!own.size) throw Error('No solid parts were found to prepare for dual-wall mixing.');

  let faces = 0, filled = 0, meshes = 0;
  for (const [name, data] of entries) {
    if (!/^3D\/.*\.model$/i.test(name)) continue;
    const before = dec.decode(data);
    const after = before.replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/g, (whole, attrs, body) => {
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      if (!own.has(id) || !body.includes('<triangle')) return whole;
      const base = own.get(id), leaf = paint.encode({ kind: 'leaf', state: base });
      meshes += 1;
      return `<object${attrs}>${body.replace(/<triangle\b([^>]*?)\/>/g, (triangle, tri) => {
        faces += 1;
        const found = PAINT.exec(tri);
        if (!found) { filled += 1; return `<triangle${tri} paint_color="${leaf}"/>`; }
        if (!found[2]) { filled += 1; return `<triangle${tri.replace(found[0], ` ${found[1]}="${leaf}"`)}/>`; }
        const node = paint.decode(found[2]);
        if (!paint.walkStates(node).includes(0)) return triangle;
        filled += 1;
        return `<triangle${tri.replace(found[0], ` ${found[1]}="${paint.encode(fill(node, base))}"`)}/>`;
      })}</object>`;
    });
    if (after !== before) entries.set(name, enc.encode(after));
  }
  if (!meshes) throw Error('The exported meshes could not be matched to their parts for dual-wall mixing.');
  entries.set(SETTINGS, enc.encode(settings));

  const process = { mmu_segmented_region_max_width: String(depth), mmu_segmented_region_interlocking_depth: '0' };
  // One wall cannot have an inside: make room for at least one inner wall.
  if (!(Number(cfg.wall_loops) >= 2)) process.wall_loops = '2';
  Object.assign(cfg, process);
  if (Array.isArray(cfg.different_settings_to_system) && typeof cfg.different_settings_to_system[0] === 'string')
    cfg.different_settings_to_system[0] = [...new Set([...cfg.different_settings_to_system[0].split(';').filter(Boolean), ...Object.keys(process)])].sort().join(';');
  entries.set(PROJECT, enc.encode(JSON.stringify(cfg, null, 2)));
  return { cfg, process, parts: partsChanged, meshes, faces, facesGivenExplicitPaint: filled, objectsRaisedToTwoWalls: singleWalls, overridesReplaced: overrides };
}

/** Rewrite exported entries in place. Returns what changed, for the manifest and the page. */
export function applyDualWall(entries, { target, innerSlot, depth = DUAL_WALL_DEPTH.standard }) {
  const { cfg, process, parts, meshes, faces, facesGivenExplicitPaint, objectsRaisedToTwoWalls, overridesReplaced } = explicitOuterPaint(entries, { target, innerSlot, depth });
  const report = { schema: 'yab3d-dual-wall', version: 1, target, innerSlot, innerColour: String(cfg.filament_colour[innerSlot - 1] || '').slice(0, 7),
    outerDepth: depth, wallLoops: Number(cfg.wall_loops), objectsRaisedToTwoWalls, parts, meshes, faces, facesGivenExplicitPaint,
    // Written only when there were any, so that a project without them keeps its bytes.
    ...(overridesReplaced ? { overridesReplaced } : {}),
    settings: process, validation: { sliced: false, printed: false },
    note: 'Painted colours are limited to the outer depth; inner walls, infill and unpainted interiors use the inner filament. Check the sliced preview before printing.' };
  entries.set(DUAL_WALL_PATH, enc.encode(JSON.stringify(report, null, 2)));
  return report;
}
