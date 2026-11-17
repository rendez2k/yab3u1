// Where the prime tower starts on the bed.
//
// The printer profile puts it near the back of the bed. The tower gets deeper with
// every filament change, so a print with many changes pushes it over the back edge and
// the slicer refuses the G-code. Here it starts where it has the most room to grow, on
// whichever side is clear of the model.

/** Width of the tower itself, and the room its ribs and brim need around it (mm). */
export const TOWER = { width: 30, margin: 16, depthAllowed: 120 };

const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** The bed rectangle from a slicer `printable_area` list such as ['0.5x1','270.5x1','270.5x271','0.5x271']. */
export function bedRect(area) {
  const points = (Array.isArray(area) ? area : []).map(text => String(text).split('x').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
  if (points.length < 3) return null;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * The tower's starting corner. `model` is the box the models cover on the bed
 * ({x0,x1,y0,y1}) or null when unknown. The tower grows towards the back (+Y).
 */
export function primeTowerSpot(bed, model = null, { width = TOWER.width, margin = TOWER.margin, depthAllowed = TOWER.depthAllowed } = {}) {
  if (!bed || bed.x1 - bed.x0 < width + 2 * margin || bed.y1 - bed.y0 < 2 * margin + 20) return null;
  const depth = Math.min(depthAllowed, bed.y1 - bed.y0 - 2 * margin);
  const left = bed.x0 + margin, right = bed.x1 - margin - width, front = bed.y0 + margin, back = bed.y1 - margin - depth;
  // Front corners first: they leave the whole depth of the bed to grow into.
  const spots = [[left, front], [right, front], [left, back], [right, back]];
  const keepClear = model && [model.x0, model.x1, model.y0, model.y1].every(Number.isFinite) ? { x0: model.x0 - 5, x1: model.x1 + 5, y0: model.y0 - 5, y1: model.y1 + 5 } : null;
  let best = spots[0], least = Infinity;
  for (const [x, y] of spots) {
    const covered = keepClear ? overlap({ x0: x - margin, x1: x + width + margin, y0: y - margin, y1: y + depth }, keepClear) : 0;
    if (covered < least - 1e-9) { least = covered; best = [x, y]; }
  }
  return { x: Math.round(best[0]), y: Math.round(best[1]), clear: least === 0 };
}

/** Write the spot into a slicer config that has a prime tower. Returns the spot, or null when nothing changed. */
export function placePrimeTower(cfg, model = null) {
  if (!cfg || String(cfg.enable_prime_tower) !== '1') return null;
  const width = Number(cfg.prime_tower_width) > 0 ? Number(cfg.prime_tower_width) : TOWER.width;
  const spot = primeTowerSpot(bedRect(cfg.printable_area), model, { width });
  if (!spot) return null;
  const plates = Array.isArray(cfg.wipe_tower_x) && cfg.wipe_tower_x.length ? cfg.wipe_tower_x.length : 1;
  cfg.wipe_tower_x = Array.from({ length: plates }, () => String(spot.x));
  cfg.wipe_tower_y = Array.from({ length: plates }, () => String(spot.y));
  return spot;
}
