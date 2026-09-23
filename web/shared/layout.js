// The plate layout: how many copies of the selected group are written, where
// they sit, and what the preview and thumbnail must show.
//
// The width and depth are *layout dimensions* the user chooses, not a printer
// bed: nothing here reads or invents a machine profile.  One plan drives the
// archive, the preview and the saved thumbnail, so the picture cannot disagree
// with the file.

// Bambu's generic import re-centres the whole group, so an asymmetric empty strip
// cannot survive.  The reservation is therefore symmetric: 25 mm on each X side.
export const TOWER_RESERVE_PER_SIDE = 25;

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
  const reserve = options.tower
    ? 2 * (Number(options.towerReserve) || TOWER_RESERVE_PER_SIDE) : 0;
  const usableWidth = width - reserve;
  const columns = Math.floor((usableWidth + spacing) / (size[0] + spacing));
  const rows = Math.floor((depth + spacing) / (size[1] + spacing));
  // Nothing fits is a real answer: the page must block, not write an out-of-bounds
  // file.  Zero columns/rows mean exactly that.
  const safeColumns = Math.max(0, Math.min(columns, 64));
  const safeRows = Math.max(0, Math.min(rows, 64));
  return {
    columns: safeColumns,
    rows: safeRows,
    capacity: safeColumns * safeRows,
    block: [safeColumns ? safeColumns * size[0] + (safeColumns - 1) * spacing : 0,
            safeRows ? safeRows * size[1] + (safeRows - 1) * spacing : 0],
    reserve,
    usableWidth,
  };
}

/**
 * The grid plan for one layout box.
 *
 * Returns the number of copies actually written (capped by capacity), the size
 * the block occupies, and a note for the page.  `copies` of 0 or 1 both mean a
 * single centred copy.
 */
export function planLayout(bounds, options = {}) {
  const size = boxSize(bounds);
  const grid = layoutCapacity(size, options);
  const asked = Math.max(1, Math.floor(Number(options.copies) || 1));
  const copies = Math.min(asked, grid.capacity);
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
    block: grid.block,
    tower: grid.reserve > 0,
    reserve: grid.reserve,
    usableWidth: grid.usableWidth,
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
    + (plan.tower ? "+tower" : "");
}
