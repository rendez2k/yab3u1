# Changelog

The version shown on the page comes from `APP_VERSION` in `web/index.html`, and is
surfaced as a badge in the header and in the collapsed "What's new" block in the
footer. Bump that constant and add a section here together.

## 1.1.0

- Fix the plate layout running over the bed edge, which is what produces Orca's
  "Model too close to bed boundary" warning. The column and row counts were
  measured against the whole bed and then the block was required to fit *with* a
  margin, so a wide grid had no valid position, and the fallback centred it over
  the edge instead. The margin — the brim, plus 4 mm for the clearance spiral
  lifting needs — is now subtracted before counting, so the grid comes out a
  little smaller and stays inside. A 15-piece plate of ghosts now fits 45 copies
  with the brim edge ~27 mm from the boundary, rather than 52 hanging off it.
- Plates holding several copies of one model now convert, which covers MakerWorld
  downloads and plates someone arranged and saved. The first placement carries the
  scale and orientation and the layout is rebuilt from the copies/spacing controls.
  A plate of several *different* models still cannot be handled.
- The local UI page (`u1ui.py`) catches up with the browser version: same version
  badge, light/dark themes, full-size Save button and footer links. Its `.sub` line
  now also says what it does that the browser version cannot (your installed Orca
  profiles, and checking a plate by slicing it).
- Light and dark themes. The page follows your system setting until you use the
  toggle in the header, after which your choice is remembered.
- The file picker is reachable from the keyboard. It was `display: none`, which
  hid it from the tab order entirely; it is now visually hidden but still
  focusable, and there are visible focus rings throughout.
- Footer links: Product Kit, a contact address, the renamed GitHub repo, and two
  more 3D tools by the same author (Strata, Spool Studio).
- The output carries the source's preview image, written as both `Metadata/thumbnail.png`
  (what Windows and PrusaSlicer look for) and `Metadata/plate_1.png` (Bambu Studio and
  Orca), so the file shows a thumbnail rather than a generic icon.
- A full-size Save button replaces the small link that used to appear in the log.
- The `Supports: Off` option now says so when the model carries painted support
  enforcers, because that combination is the one Orca warns about.
- `og:` tags so a shared link gets a proper preview, a `<noscript>` notice, and
  roomier spacing on narrow screens.
- The log panel and button hover state now come from the theme variables, so
  nothing stays dark-on-dark in light mode.

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
