// Fine blend profile for Snapmaker Orca (experimental).
//
// Blends made by alternating layers show as stripes. Thin layers make the stripes
// finer, and several thin walls give them depth and keep infill out of sight. Every
// blend is written as an explicit run of layers, one reel per layer.
//
// An earlier version also wrote a second, offset run for the walls behind the outer
// one. Snapmaker Orca stopped with an access violation when slicing such a project of
// a painted model, so only the single run is written.
//
// This rewrites an already exported project: only its blend table and a few
// print settings change. No geometry and no paint is touched.
import { wallPatternRow } from './targets.js';

export const FINE_BLEND_PATH = 'Metadata/YAB3D_fine_blend.json';
export const FINE_BLEND_TARGETS = ['snapmaker'];
export const FINE_BLEND = { layerHeight: 0.10, walls: 5, lineWidth: 0.3, repeat: 10 };
const SETTINGS = 'Metadata/model_settings.config', PROJECT = 'Metadata/project_settings.config';
const enc = new TextEncoder(), dec = new TextDecoder();

export function applyFineBlend(entries, { target, recipes = [] }) {
  if (!FINE_BLEND_TARGETS.includes(target)) throw Error('The fine blend profile exports to Snapmaker Orca.');
  if (!entries.has(PROJECT)) throw Error('The fine blend profile needs a native slicer project.');
  const cfg = JSON.parse(dec.decode(entries.get(PROJECT)));
  const rows = String(cfg.mixed_filament_definitions || '').split(';').filter(Boolean);
  const blends = recipes.filter(r => !r.gradient);
  if (!rows.length || !blends.length) throw Error('The fine blend profile needs at least one blended colour.');
  let written = 0;
  recipes.forEach((recipe, index) => {
    if (recipe.gradient || index >= rows.length) return;
    const stable = /,u(\d+)/.exec(rows[index])?.[1] || String(index + 1);
    rows[index] = wallPatternRow(recipe, stable, FINE_BLEND.repeat); written += 1;
  });
  const walls = Math.max(FINE_BLEND.walls, Number(cfg.wall_loops) || 0);
  Object.assign(cfg, {
    mixed_filament_definitions: rows.join(';'),
    wall_loops: String(walls),
    outer_wall_line_width: String(FINE_BLEND.lineWidth), inner_wall_line_width: String(FINE_BLEND.lineWidth),
    // Each layer is one reel of the pattern; the slicer must not divide it again.
    dithering_local_z_mode: '0',
  });
  entries.set(PROJECT, enc.encode(JSON.stringify(cfg, null, 4)));
  // An object with its own, lower wall count would thin the colour back out.
  let raised = 0;
  if (entries.has(SETTINGS)) {
    const text = dec.decode(entries.get(SETTINGS)).replace(/(<metadata(?: type="[^"]*")? key="wall_loops" value=")([^"]*)(")/g,
      (all, a, value, c) => (Number(value) >= walls ? all : (raised += 1, `${a}${walls}${c}`)));
    entries.set(SETTINGS, enc.encode(text));
  }
  const result = { blends: written, walls, lineWidth: FINE_BLEND.lineWidth, objectsRaised: raised };
  entries.set(FINE_BLEND_PATH, enc.encode(JSON.stringify({ schema: 1, feature: 'fine-blend', target, ...result,
    patterns: rows.slice(0, recipes.length).map(row => row.split(',cm1,')[1] || null),
    validation: { sliced: false, printed: false } }, null, 2)));
  return result;
}
