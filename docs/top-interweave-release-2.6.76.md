# Workbench 2.6.76 — top surface interweave

## Why

A printed test (CMY + white, Strong blend detail) gave good colour on walls and visible bands on the shallow red panels of a backpack model. Blends alternate whole layers of two filaments; on a wall the layers are seen edge-on and merge, on a top each layer is a wide band.

## What the export does

`web/shared/topInterweave.js` rewrites a finished Full Spectrum export, before dual-wall if both are on:

1. Each mesh is placed in the world using its component transform and its first build item, so "top" means top as printed.
2. A face counts when its normal is within about 30° of vertical, up or down.
3. On those faces, any paint leaf assigned to a two-filament blend is replaced by a subdivision tree: the slicer's own four-way facet split, refined until each piece lies in one square of an XY grid or is under half a square across. Each square takes one of the blend's two filaments from a 4 x 4 ordered-dither table, which is an exact chequer at 50% and spreads other shares evenly.
4. An unpainted face is treated as painted in its part's own filament.
5. `Metadata/YAB3D_top_interweave.json` records the settings and counts, with `validation: {sliced: false, printed: false}`.

Vertices, triangle order, seams and support paint are untouched. Every tree written is decoded again before it is kept.

## What to check when slicing

1. Top layers of a blended area should show small squares of the two filaments, not one filament per layer.
2. How deep the pattern goes. Paint on a top face normally colours the top shell layers; whether the layers beneath show through translucent filament is something only a print will tell.
3. The line where a slope passes 30° and the pattern hands over to layer mixing.
4. Tool changes and time. Every layer that contains interwoven faces now uses both filaments.
5. Whether 1.2 mm squares print cleanly with a 0.4 mm nozzle; try 1.6 to 1.8 mm if they look ragged.

## Validation

- 5 new tests: the dither table's proportions; printed area of each filament on a large face within 6% of the blend at 25, 50 and 75%; a painted cube where only the top and bottom change and geometry is identical; tops following a quarter turn on the plate; gradients, solid colours and bad requests left alone.
- 116 Workbench tests and 175 web tests pass. `web/tests/real_file.test.mjs` fails as before.
- Headless Chromium with `five-colours.3mf`: the option appears when the plan has blends, blocks export on an out-of-range size, and the downloaded project re-read correctly with one blended face repainted into 664 pieces.
- The pattern was rendered from the written trees at 50, 25 and 17% and looked as intended, with square edges jagged at about half a square.

## Limits

- Not sliced, not printed.
- A 24 mm flat triangle becomes about 3,600 paint pieces and an 80 mm one about 54,000, so large flat models produce larger files and slower slicing.
- Copies of one object placed at different rotations share one mesh; the first copy decides which faces are tops.
- Not applied to sequential plate preparation or multi-plate saves, and not offered in Solid colours or for PrusaSlicer.
