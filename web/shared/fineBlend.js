// Fine blend profile for Snapmaker Orca (experimental).
//
// The two kinds of blend need different things. A two-reel blend is finest when the
// slicer divides each layer into thin slices of each reel (Subdivide Mix Layer), so
// those rows are left exactly as the export wrote them. A three-reel blend can only
// alternate whole layers, so it needs thin layers. A test print with every blend as
// whole layers showed the cost of treating them alike: the two-reel gold came out
// pinstriped. This profile therefore only thins the layers and adds thin walls, which
// give the colour depth and keep infill out of sight.
//
// This rewrites an already exported project: only a few print settings change. The
// blend table, geometry and paint are untouched.

export const FINE_BLEND_PATH = 'Metadata/YAB3D_fine_blend.json';
export const FINE_BLEND_TARGETS = ['snapmaker'];
// 0.12 mm is the thinnest layer the slicer accepts together with Subdivide Mix Layer.
export const FINE_BLEND = { layerHeight: 0.12, walls: 5, lineWidth: 0.3 };
const SETTINGS = 'Metadata/model_settings.config', PROJECT = 'Metadata/project_settings.config';
const enc = new TextEncoder(), dec = new TextDecoder();

export function applyFineBlend(entries, { target, recipes = [] }) {
  if (!FINE_BLEND_TARGETS.includes(target)) throw Error('The fine blend profile exports to Snapmaker Orca.');
  if (!entries.has(PROJECT)) throw Error('The fine blend profile needs a native slicer project.');
  const cfg = JSON.parse(dec.decode(entries.get(PROJECT)));
  const rows = String(cfg.mixed_filament_definitions || '').split(';').filter(Boolean);
  const blends = recipes.filter(r => !r.gradient);
  if (!rows.length || !blends.length) throw Error('The fine blend profile needs at least one blended colour.');
  const walls = Math.max(FINE_BLEND.walls, Number(cfg.wall_loops) || 0);
  Object.assign(cfg, {
    wall_loops: String(walls),
    outer_wall_line_width: String(FINE_BLEND.lineWidth), inner_wall_line_width: String(FINE_BLEND.lineWidth),
  });
  entries.set(PROJECT, enc.encode(JSON.stringify(cfg, null, 4)));
  // An object with its own, lower wall count would thin the colour back out.
  let raised = 0;
  if (entries.has(SETTINGS)) {
    const text = dec.decode(entries.get(SETTINGS)).replace(/(<metadata(?: type="[^"]*")? key="wall_loops" value=")([^"]*)(")/g,
      (all, a, value, c) => (Number(value) >= walls ? all : (raised += 1, `${a}${walls}${c}`)));
    entries.set(SETTINGS, enc.encode(text));
  }
  const result = { blends: blends.length, threeReel: blends.filter(r => r.c).length, walls, lineWidth: FINE_BLEND.lineWidth, objectsRaised: raised };
  entries.set(FINE_BLEND_PATH, enc.encode(JSON.stringify({ schema: 1, feature: 'fine-blend', target, ...result,
    patterns: rows.slice(0, recipes.length).map(row => row.split(',cm1,')[1] || null),
    validation: { sliced: false, printed: false } }, null, 2)));
  return result;
}
