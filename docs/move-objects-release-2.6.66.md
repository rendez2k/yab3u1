# Workbench 2.6.65 – 2.6.66

## 2.6.65 — turn by any angle

Tip and Spin take an angle from -360 to 360 degrees. Multiples of 90 use exact integer matrices; other angles use an ordinary rigid rotation. The export status line uses proper singular and plural forms and carries its full text as a tooltip. Originals hidden from Plates are stored with the session.

## 2.6.66 — hand placement

### How it works

The object arranger accepts an optional `manual` map on the layout: `"objectId:ordinal"` to the centre of that copy's footprint, in millimetres from the bed's front-left corner. Entries are placed first, kept on the bed, and passed to the packer as reserved boxes so every other object packs around them. Without the map a plan is byte-for-byte what it was, including its signature, so caches, exports and existing tests are unaffected.

Because the preview worker, single-plate export and multi-plate export all obtain positions from the same planner, they follow hand placement with no changes of their own.

The drag tool uses the preview's existing pointer hook. A drag is only taken when it starts on the one selected object; anything else orbits as before. On the first drag every object on the plate is pinned where it currently sits, so nothing else jumps, including on plates still using the designer's grouped layout. The dropped position is converted through the object's own width, so it does not depend on the preview's scale.

`ConvertSession.setLayout` validates the map (at most 512 entries, finite numbers). It is cleared when a new file loads and saved per plate.

### Validation

- 112 Workbench tests and 161 web tests pass. New: the planner with and without fixed positions, ordinals for copies, stale keys, pinning a grouped plate, clamping, spacing and prime-tower refusal, and the pointer-to-plate projection. `web/tests/real_file.test.mjs` fails as it did before this work.
- Headless Chromium, 1440 x 900, built-in sample, real mouse events:
  - Plate view and top view drags landed where dropped; a second object stayed in place.
  - Dropping one part on another was refused with the spacing message and the part returned.
  - Dragging an unselected object or empty space orbited.
  - Undo and Redo restored positions. Auto arrange released them.
  - A hand-placed object kept its spot after Spin; an added copy packed beside it; reload and Reopen kept both; opening a new file started clean.
  - The exported 3MF's two build items differed by 14.07 mm and 85.32 mm, matching the preview's 14.1 mm and 85.3 mm.

### Known limits

- Convert only. Full Spectrum keeps its own plate controls and ignores hand-placed positions, so a model arranged by hand in Convert is repacked there.
- Collision checks use each object's rectangular footprint, as the arranger does. Objects cannot be nested into each other's concave gaps, and height or print-head clearance is not checked.
- One object at a time; a multi-selection is not dragged.
- Split parts start at packed positions; they do not inherit the original's spot.
- No snapping, numeric position entry or touch-specific handling; touch drags have not been tested.
- Sequential plate preparation and Batch conversion were not tested with hand-placed positions.
- Not tested with real projects, in a slicer, or in browsers other than Chromium.
