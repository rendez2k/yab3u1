# Workbench 2.6.58 – 2.6.61

Four releases after the slim rail and session restore.

## 2.6.58 — colour choices on reopen

See `docs/session-colours-release-2.6.58.md`.

## 2.6.59 — redo

Plate history keeps a redo trail per plate; model edits keep the snapshot they were undone from. The studio records the order edits were undone in and replays them from the Redo button, Ctrl/Cmd+Shift+Z or Ctrl+Y. A new edit clears the trail. A model undo or redo resets plate history for that revision, as a model edit already did, so plate edits made before a model edit cannot be redone after undoing past it. In-tool previews (boundary points, shape selection, colour preview, blends) are undo-only.

## 2.6.60 — turn

`orient` is a new model-edit operation beside `repair`. Every part of the object, including modifiers and negative volumes, is rotated rigidly about the object's centre and dropped to the plate. Quarter and half turns use exact integer matrices. Lay flat groups coplanar outward faces, keeps those covering at least 2% of the surface, and picks the largest that is a supporting plane (no vertex lies beyond it by more than 0.05 mm). It refuses when no such face exists.

All copies of the object change together. The previous orientation stays in the working file at quantity zero so Undo is exact; those rows are hidden in Plates. Export already drops quantity-zero geometry.

## 2.6.61 — resize

The same operation accepts a uniform scale from 0.1 to 10 about the object's centre.

## Validation

- 106 Workbench tests pass. New: plate redo, quarter turns (exactness, volume, winding, four turns return the original), lay flat (largest supporting face, hollow floors and small facets rejected, rounded shapes refused), and uniform scale.
- Production build succeeds.
- Headless Chromium, built-in sample. Convert: undo and redo across a split and a plate edit by button and keyboard; tip X changed 66.2 x 66.2 x 45.0 mm to 66.2 x 45.0 x 66.2 mm and lay flat returned it to its base; 150% gave 99.4 x 99.4 x 67.5 mm; 600% showed the layout warning; export after a turn downloaded. Full Spectrum: turn, undo and redo. No page errors.

## Known limits

- The working file grows by one copy of the object per turn or resize until the model is reopened from an export.
- Lay flat judges flat faces only. It does not find a stable pose for rounded or organic shapes and does not consider overhangs or supports.
- No free-angle rotation, no non-uniform scale and no mirror. Mirroring would reverse triangle winding, which the paint encoding depends on.
- Objects still cannot be dragged or placed by hand; positions come from the arranger.
- Not tested with real projects, multi-part objects with modifiers, a slicer, or browsers other than Chromium.
