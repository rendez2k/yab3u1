# Changelog

The version shown on the page comes from `APP_VERSION` in `web/index.html`, and is
surfaced as a badge in the header and in the collapsed "What's new" block in the
footer. Bump that constant and add a section here together.

## 1.0.0

First release.

- Converts Bambu Studio, OrcaSlicer and PrusaSlicer 3MF projects into Snapmaker U1
  (Snapmaker Orca) projects.
- Keeps multi-colour painting, support painting and the source's support decision
  intact. Orca reads only `paint_color` / `paint_supports`, while PrusaSlicer writes
  `slic3rpe:mmu_segmentation` / `slic3rpe:custom_supports` — without the rename,
  every painted triangle is silently dropped.
- Maps the source's extruders down to the U1's four slots, taking colours from the
  file's tool palette rather than its filament palette.
- Fills the plate with a prime-tower aware layout, reporting the geometric count and
  optionally checking the result by slicing.
- Two front ends over one implementation: `web/` runs entirely in the browser with no
  backend, and `u1convert.py` (CLI) plus `u1ui.py` (local UI) do the same offline.
- The web version's settings baseline is derived from
  [bl2u1](https://github.com/josuanbn/bl2u1), which is GPL-3.0 licensed — see
  "Attribution and licence" in the README.
