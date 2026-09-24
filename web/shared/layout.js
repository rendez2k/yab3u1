// The plate layout: how many copies of the selected group are written, where
// they sit, and what the preview and thumbnail must show.
//
// Generic targets use a user-chosen planning area. The U1 target uses its actual
// build volume, matching the machine profile written by the exporter. One plan drives the
// archive, the preview and the saved thumbnail, so the picture cannot disagree
// with the file.

// Bambu's generic import re-centres the whole group, so an asymmetric empty strip
// cannot survive.  The reservation is therefore symmetric: 25 mm on each X side.
export const TOWER_RESERVE_PER_SIDE = 25;

/** U1 exports include a machine profile; other targets use an editable area. */
export function targetLayout(target, options = {}) {
  if (target === "snapmaker") return { ...options, width: 270, depth: 270,
    edgeMargin: 4, maxHeight: 270.05, centre: [135.5, 136],
    // Local bed coordinates. Allows for the U1 baseline tower at (13, 211),
    // its brim and ribs. This is a planning allowance; slicing determines size.
    towerBox: { min: [0, 200], max: [60, 270] } };
  const { maxHeight, towerBox, edgeMargin, ...layout } = options;
  return { ...layout, centre: target === "bambu" ? [0, 0]
    : [Number(options.width) / 2, Number(options.depth) / 2] };
}

export function emptyBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function addPoint(box, point) {
  for (let axis = 0; axis < 3; axis += 1) {
    if (point[axis] < box.min[axis]) box.min[axis] = point[axis];
    if (point[axis] > box.max[axis]) box.max[axis] = point[axis];
  }
  return box;
}

export function addBox(into, other) {
  if (!other || !Number.isFinite(other.min[0])) return into;
  addPoint(into, other.min);
  addPoint(into, other.max);
  return into;
}

export function boxValid(box) {
  return Boolean(box) && Number.isFinite(box.min[0]) && Number.isFinite(box.max[0]);
}

export function boxSize(box) {
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
}

export function boxCorners(box) {
  const out = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
    }
  }
  return out;
}

/** A box that encloses another box after a transform. */
export function transformBox(box, apply) {
  const out = emptyBox();
  for (const corner of boxCorners(box)) addPoint(out, apply(corner));
  return out;
}

/** How many copies the layout box holds, and the size of the block they form. */
export function layoutCapacity(size, options = {}) {
  const spacing = Math.max(0, Number(options.spacing) || 0);
  const width = Math.max(1, Number(options.width) || 1);
  const depth = Math.max(1, Number(options.depth) || 1);
  const corner = options.tower && options.towerBox;
  const reserve = options.tower && !corner
    ? 2 * (Number(options.towerReserve) || TOWER_RESERVE_PER_SIDE) : 0;
  const edgeMargin = Math.max(0, Number(options.edgeMargin) || 0);
  const usableWidth = width - reserve - 2 * edgeMargin;
  const usableDepth = depth - 2 * edgeMargin;
  const columns = Math.floor((usableWidth + spacing) / (size[0] + spacing));
  const rows = Math.floor((usableDepth + spacing) / (size[1] + spacing));
  // Nothing fits is a real answer: the page must block, not write an out-of-bounds
  // file.  Zero columns/rows mean exactly that.
  const safeColumns = Math.max(0, Math.min(columns, 64));
  const safeRows = Math.max(0, Math.min(rows, 64));
  const cells = corner ? insetCornerCells(size, width, depth, safeColumns, safeRows,
                                    spacing, corner, edgeMargin) : null;
  return {
    columns: safeColumns,
    rows: safeRows,
    capacity: cells ? cells.length : safeColumns * safeRows,
    cells,
    block: [safeColumns ? safeColumns * size[0] + (safeColumns - 1) * spacing : 0,
            safeRows ? safeRows * size[1] + (safeRows - 1) * spacing : 0],
    reserve,
    usableWidth,
    edgeMargin,
  };
}

// Keep the tower in bed coordinates while packing inside the edge clearance.
function insetCornerCells(size, width, depth, columns, rows, spacing, box, margin) {
  const shifted = { min: box.min.map(v => v - margin), max: box.max.map(v => v - margin) };
  return cornerCells(size, width - 2 * margin, depth - 2 * margin,
    columns, rows, spacing, shifted).map(([x, y]) => [x + margin, y + margin]);
}

/** Slide a grid to the bed or obstacle edges, keeping the most clear cells.
 * Unlike a full-height strip, the tower only excludes its own corner. */
function cornerCells(size, width, depth, columns, rows, spacing, box) {
  if (!columns || !rows) return [];
  const block = [columns * size[0] + (columns - 1) * spacing,
                 rows * size[1] + (rows - 1) * spacing];
  const candidates = (limit, span, axis) => [...new Set([
    (limit - span) / 2, 0, limit - span,
    box.min[axis] - spacing - span, box.max[axis] + spacing,
  ].filter((v) => v >= -1e-7 && v + span <= limit + 1e-7))];
  let best = [], bestDistance = Infinity;
  for (const x of candidates(width, block[0], 0)) {
    for (const y of candidates(depth, block[1], 1)) {
      const cells = [];
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const left = x + col * (size[0] + spacing);
          const bottom = y + row * (size[1] + spacing);
          if (left + size[0] > box.min[0] - spacing + 1e-7
              && left < box.max[0] + spacing - 1e-7
              && bottom + size[1] > box.min[1] - spacing + 1e-7
              && bottom < box.max[1] + spacing - 1e-7) continue;
          cells.push([left + size[0] / 2, bottom + size[1] / 2]);
        }
      }
      const distance = (x + block[0] / 2 - width / 2) ** 2
        + (y + block[1] / 2 - depth / 2) ** 2;
      if (cells.length > best.length || (cells.length === best.length
          && distance < bestDistance)) {
        best = cells;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * The grid plan for one layout box.
 *
 * Returns the number of copies actually written (capped by capacity), the size
 * the block occupies, and a note for the page.  `copies` of 0 or 1 both mean a
 * single centred copy.
 */
export function planLayout(bounds, options = {}) {
  const modelSize = boxSize(bounds);
  const padding = Math.max(0, Number(options.padding) || 0);
  const size = [modelSize[0] + padding * 2, modelSize[1] + padding * 2,
                modelSize[2] + Math.max(0, Number(options.extraHeight) || 0)];
  const grid = layoutCapacity(size, options);
  if (Number.isFinite(options.maxHeight) && size[2] > options.maxHeight + 1e-6) {
    grid.capacity = 0;
  }
  const asked = Math.max(1, Math.floor(Number(options.copies) || 1));
  const copies = Math.min(asked, grid.capacity);
  let cells = grid.cells;
  if (cells && copies > 0 && copies < grid.capacity) {
    // Try a compact block for a partial plate, keeping a single copy centred.
    const columns = Math.min(grid.columns, copies);
    const compact = insetCornerCells(size, Number(options.width), Number(options.depth),
      columns, Math.ceil(copies / columns), Math.max(0, Number(options.spacing) || 0),
      options.towerBox, grid.edgeMargin);
    if (compact.length >= copies) cells = compact;
  }
  return {
    copies,
    asked,
    capacity: grid.capacity,
    columns: grid.columns,
    rows: grid.rows,
    spacing: Math.max(0, Number(options.spacing) || 0),
    width: Math.max(1, Number(options.width) || 1),
    depth: Math.max(1, Number(options.depth) || 1),
    size,
    padding,
    footprintNotes: options.footprintNotes || [],
    block: grid.block,
    tower: Boolean(options.tower),
    towerBox: options.tower && options.towerBox || null,
    cells: cells ? cells.slice(0, copies) : null,
    reserve: grid.reserve,
    usableWidth: grid.usableWidth,
    edgeMargin: grid.edgeMargin,
    capped: asked > copies,
    blocked: copies < 1,
  };
}

/**
 * The offset each copy needs, in the group's own coordinates.
 *
 * The whole block is centred on the layout box origin and the group is grounded
 * (its lowest point at Z=0), so the file is coherent whatever bed the slicer
 * later uses, and Bambu's own "centre a model on my bed" import stays a no-op.
 */
export function layoutOffsets(bounds, plan, centre = [0, 0]) {
  if (plan.cells) {
    const groupCentre = [(bounds.min[0] + bounds.max[0]) / 2,
                         (bounds.min[1] + bounds.max[1]) / 2];
    return plan.cells.map(([x, y]) => [
      centre[0] - plan.width / 2 + x - groupCentre[0],
      centre[1] - plan.depth / 2 + y - groupCentre[1], -bounds.min[2],
    ]);
  }
  const size = plan.size;
  const spacing = plan.spacing;
  const count = plan.copies;
  // The block is the grid the copies actually occupy, not the box's full
  // capacity: one copy must be centred, not parked in the first cell of a grid
  // sized for twelve.
  const usedColumns = Math.max(1, Math.min(plan.columns, count));
  const usedRows = Math.max(1, Math.ceil(count / plan.columns));
  const block = [usedColumns * size[0] + (usedColumns - 1) * spacing,
                 usedRows * size[1] + (usedRows - 1) * spacing];
  const offsets = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    // First cell's centre, relative to the centred block.
    const originX = centre[0] - block[0] / 2 + size[0] / 2;
    const originY = centre[1] - block[1] / 2 + size[1] / 2;
    const cellX = originX + column * (size[0] + spacing);
    const cellY = originY + row * (size[1] + spacing);
    // The group's own centre moves to the cell centre; Z is grounded, not moved.
    const groupCentre = [(bounds.min[0] + bounds.max[0]) / 2,
                         (bounds.min[1] + bounds.max[1]) / 2];
    offsets.push([cellX - groupCentre[0], cellY - groupCentre[1], -bounds.min[2]]);
  }
  return offsets;
}

/** The identity signature of a layout: part of every cache key and revision. */
export function layoutSignature(plan) {
  return `${plan.copies}x${plan.spacing}@${plan.width}x${plan.depth}`
    + (plan.tower ? "+tower" : "") + `+edge${plan.edgeMargin || 0}`;
}
