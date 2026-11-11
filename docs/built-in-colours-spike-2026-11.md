# Built-in colours spike: does Snapmaker Orca honour layer-banded paint? (November 2026)

Throwaway spike for the built-in colours plan, Task 2 (the gate before Task 3).
Nothing here is wired into the app. **No print was started.**

## Question

If every painted triangle is cut into horizontal strips at the slicer's layer
boundaries, and each strip is painted with one reel, does Snapmaker Orca 2.4.1
print each layer's outer wall in that reel, on a model of realistic size?

## What was tested

Three real painted figurines supplied by the owner were banded, sliced and checked
(see "Owner-supplied figurines" below): Super Man (plate 1 of 4 only, a 15 mm-tall
piece), They Live Alien (140 mm) and Flirty Figures Alien (105 mm). None was printed.
Before they arrived, the spike used:

1. `web/tests/four-colours.3mf` (named in the brief) and `web/tests/five-colours.3mf`
   (the largest painted fixture in the repo, 3,265 bytes). Both contain only flat,
   zero-thickness 10 mm squares, so they cannot be sliced at all (see results).
2. A generated painted test solid (`--make-test-solid`): a closed, lumpy cylinder,
   100 mm tall, about 46 mm across, 200,160 triangles, 100,082 vertices, with three
   painted shades over different regions (two 120° sectors and a top band) plus the
   part's own filament elsewhere, and 1,200 split-painted triangles where regions meet
   (one- and three-side splits, some nested). Source mesh: 0 open edges.

The test solid is curved and of realistic size and triangle count, but it is
star-shaped, smooth and has no overhangs, thin features or multiple shells.

## Method

`tools/built-in-colours-spike.mjs <input.3mf> <layerHeight> <output.3mf> [--raw] [--whole-splits] [--no-band] [--plate=N]`:

1. `exportProject` for `snapmaker`, four ELEGOO reels (Cyan, Magenta, Yellow, White),
   no recipes, source colour *n* mapped to reel ((*n*−1) mod 4)+1.
2. `applyDualWall` with inner slot 4 and depth 0.45 mm.
3. Every painted triangle (after dual wall, all faces of the test solid) is expanded
   into its leaf sub-triangles, then cut with `bandTriangle` (first layer 0.2 mm), and
   each strip in layer *n* is painted with reel `[1,2,3][n % 3]`. Reel 4 is the interior.
4. Settings: `layer_height` = argument (also the per-object `layer_height` the export
   writes, which would otherwise override it), `initial_layer_print_height` 0.2,
   `mmu_segmented_region_interlocking_depth` 0, `dithering_local_z_mode` 0,
   `mixed_filament_advanced_dithering` 0. The dual-wall step sets
   `mmu_segmented_region_max_width` 0.45.
5. Strip corners are merged (welded) onto a 1e-6 mm grid unless `--raw` is given. See
   finding 3 for why.

Controls: `--whole-splits` bands each split-painted triangle as one whole triangle, so
no split midpoints are added. `--no-band` stops after export and dual wall, so the
source's own open edges can be told apart from those added by banding. `--plate=N`
picks a plate (default: the first). Each run writes a JSON beside its output with
triangle counts, split-painted count, model height and open-edge counts (before,
after, and after without the weld).

Changes made to run the owner's files: `readProject` is called with
`allowNegative: true`, because Super Man contains a negative volume. Negative volumes
pass through unbanded. The bed height is now taken only from painted (printed) meshes,
so a negative volume cannot shift the layer grid.

Deviation from the brief: the brief says to expand split paint "the way `previewSoup`
expands it". `previewSoup` does not expand it geometrically; it colours the whole
triangle with the majority leaf. The spike uses `leafTriangles` from
`web/shared/standard.js` instead, the exact port of the slicer's split geometry.

Slicing (automatic arranging and orienting off):

```
"C:/Program Files/Snapmaker_Orca/snapmaker-orca.exe" --arrange 0 --orient 0 --slice 0 --outputdir <dir> <file.3mf>
"C:/Program Files/Snapmaker_Orca/snapmaker-orca.exe" --info <file.3mf>
```

Checking: `tools/check-built-in-toolpaths.mjs <gcode> 0.2 <height>`. Layer *n* is the
layer whose top is at 0.2 + *n* × height; for *n* ≥ 1 the expected tool is
`[0,1,2][n % 3]` (T0 = reel 1).

- **Strict rule (the brief's):** among all extrusions typed `Outer wall` in the layer,
  the expected tool must have the most length and no other tool may exceed 5%.
- **Visible-surface view (added):** around the layer's centroid, 180 two-degree
  sectors; each is owned by the tool of the outer-wall point (sampled every 0.2 mm)
  lying furthest out. The layer fails if more than 5% of occupied sectors belong to
  another tool, or if fewer than 162 of the 180 sectors are occupied. Only valid for
  star-shaped layers such as this test solid. On figurines with several islands per
  layer (legs, arms), the occupancy rule fails those layers. This view is reported
  but not relied on there.
- **Colour-only view (added):** the strict rule with the interior reel (T3) left out,
  so a layer fails only when another *colour* reel exceeds 5%. It works for any shape
  but cannot tell whether the stray path is on the visible surface.

Tower grams are computed from the G-code (extruding moves typed `Prime tower`, 1.75 mm,
1.24 g/cm³). The method was cross-checked: its per-tool filament totals equal the
slicer's own `filament used [mm]` line to 0.1 mm.

## Results

All numbers below were measured on this machine on 10 November 2026. Output files are
under the git-ignored `.superpowers/sdd/2026-11-10-built-in-colours-1a/spike-output/`.

| File | Layer (mm) | Triangles before → after | 3MF size | Uncompressed model | Slice time | Slicer warnings / mesh | Layers checked | Failing (strict) | Failing (visible surface) | Tool changes | Print time | Tower (g, of total) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| four-colours | 0.08 | 6 → 6 | 12,241 B | 3,248 B | 0.79 s | "Nothing to be sliced"; exit 127; no G-code | — | — | — | — | — | — |
| four-colours | 0.12 | 6 → 6 | 12,237 B | 3,250 B | 0.73 s | as above | — | — | — | — | — | — |
| five-colours | 0.08 | 8 → 8 | 12,299 B | 3,707 B | 0.76 s | as above | — | — | — | — | — | — |
| five-colours | 0.12 | 8 → 8 | 12,304 B | 3,709 B | 0.77 s | as above | — | — | — | — | — | — |
| test solid | 0.08 | 200,160 → 2,008,728 | 32.1 MB | 194.2 MB | 43.8 s | exit 0; `--info`: manifold = no, open_edges = 6,012, 1 part | 1,248 | 1,247 | 0 | 1,872 | 22 h 44 m | 71.5 of 120.5 |
| test solid | 0.12 | 200,160 → 1,406,649 | 22.1 MB | 134.0 MB | 27.6 s | exit 0; `--info`: manifold = no, open_edges = 6,325, 1 part | 832 | 831 | 0 | 1,250 | 16 h 1 m | 71.8 of 120.0 |
| test solid, `--raw` (no weld) | 0.08 | 200,160 → 2,008,728 | 34.2 MB | 208.3 MB | 38.6 s | exit 0; `--info`: manifold = no, open_edges = 646,512, 71 parts | 1,248 | 1,247 | 0 | 1,872 | 22 h 44 m | 71.5 of 120.5 |

Every sliced test-solid file also logged one `calc_exclude_triangles: Unable to create
exclude triangles` error, which also appears for the fixtures and does not stop the
slice. No mesh-repair message appeared in the command-line log. Tool changes counted
from `T` commands equal the slicer's `total filament change`. Spike run times: 36 s
(0.08) and 24 s (0.12) in Node. G-code: 64.9 MB (0.08) and 43.8 MB (0.12).

## Findings

1. **Paint is honoured on the visible surface in every layer.** On the test solid, at
   both heights, every layer above the first had its outermost wall path in exactly
   the expected tool (0 foreign sectors in any of the 1,248 and 832 layers). Each
   colour also printed a second outer-wall loop on the inside of its 0.45 mm painted
   band.

2. **The brief's strict rule fails on every layer except one, for a reason that is
   not a wrong colour.** Orca treats the reel-4 interior as its own region and types
   that region's boundary as `Outer wall`. That path is about 0.43 mm inside the
   surface (in layer 600 at 0.08 mm, the median radius is 19.92 mm against 20.35 mm for
   the colour loops), and it is about 123 mm long against about 252 mm for the expected
   colour. That is far above the 5% limit. In layers 1–2 (0.08 mm: also 1246–1247;
   0.12 mm: also 830–831), a reel-1 `Outer wall` of about 120 mm also appears inside
   the surface. Layer 0 (the bottom face) and the top layer are both reel 1, and their
   paint is carried into the bottom and top shells. With reel 4 ignored (the
   checker's colour-only view), exactly these 4 layers fail at each height. None of
   these paths is outermost (radius evidence: `spike-output/radii-test-solid-0.08.txt`). A
   checker for the real feature needs to tell the outermost path from region
   boundaries. The strict counts are reported as measured.

3. **The banded mesh is not watertight, and the slicer says so.** Measured two ways
   that agree exactly (the spike's own edge count and Orca's `--info`):
   - `bandTriangle` (Task 1) clips the already-clipped polygon at the upper plane, so
     the cut point shared by two consecutive strips of one triangle can differ in the
     last bits (shown on a two-triangle example). Unwelded, the test solid has 646,512
     open edges at 0.08 mm and Orca counts 71 separate parts. Merging corners on a
     1e-6 mm grid leaves 6,012 (0.08) and 6,325 (0.12).
   - Expanding split paint into real sub-triangles adds T-junctions: a split adds a
     midpoint on an edge that the unsplit neighbour does not have, and banding repeats
     it in every layer. Control (`--whole-splits`, split triangles banded whole,
     welded, otherwise identical):

     | Height | Open edges, normal | Open edges, `--whole-splits` | Attributable to split paint | Unexplained residual |
     |---|---|---|---|---|
     | 0.08 | 6,012 | 0 | 6,012 (100%) | 0 |
     | 0.12 | 6,325 | 318 | 6,007 (95%) | 318 |

     Orca `--info` agrees: `test-solid-0.08-wholesplits` manifold = yes;
     `test-solid-0.12-wholesplits` manifold = no, open_edges = 318. The 318 at 0.12 mm
     were **not explained by split paint**. A one-off experiment repeated the 0.12 mm
     `--whole-splits` run with a 1e-4 mm weld grid instead of 1e-6. It used a
     throw-away copy of the tool; the outputs are in `spike-output/weld-1e-4-experiment/`.
     The 318 fell to 12, so most of the residual is cut-point mismatch larger than
     1e-6 mm. The last 12 are unexplained. A fixed grid can still put two very close
     points in different cells, but that was not tested. Neither control variant was
     sliced.

   Orca sliced every one of these meshes without an error and the colours came out
   right on the visible surface. However, `--info` reports `manifold = no`, and the log does not show
   whether Orca repaired the mesh while slicing. By the gate rule ("if the slicer
   repairs or rejects the mesh, do not continue"), **this needs the owner's
   decision.** The two identified causes look fixable in the geometry (cut from the
   original edge; split the unsplit neighbour at the same midpoint), but that is a
   re-plan, not something this spike changes.

   `--info` on the unbanded source solid crashed (exit 139, segmentation fault). On the
   same solid after export and dual wall with no banding (`--no-band`) it ran:
   manifold = yes, 200,160 facets. All `--info` outputs are saved in
   `spike-output/info/`.

4. **Cost.** Triangles grow about 10× at 0.08 mm and about 7× at 0.12 mm. The 3MF grows
   from 2.4 MB to 32 MB / 22 MB. Snapmaker Orca CLI slice times are 44 s / 28 s. The
   pattern forces a colour change on every layer. Printing a 100 mm part takes
   22 h 44 m (0.08 mm, 1,872 changes) or 16 h 1 m (0.12 mm, 1,250 changes). The prime
   tower is about 71–72 g of about 120 g of filament at either height, roughly 60%
   of the total. These are the slicer's estimates for the worst case (a change on
   every layer); a real recipe would usually change less often. No unbanded baseline
   was sliced for comparison.

5. **The repo fixtures cannot answer the question.** Both are open, zero-thickness
   squares. The slicer refuses them ("Nothing to be sliced") whether banded or not.

## Owner-supplied figurines

Inputs (read only, not modified): `D:/3D/Super Man/Super Man Final.3mf` (4.8 MB),
`D:/3D/They Live Alien/They Live Alien 5 Colors.3mf` (19.2 MB) and
`D:/3D/Flirty Figures Alien/Flirty Figures Alien Updated Painted (1).3mf` (12.3 MB).
Outputs are in `spike-output/` as `superman-*`, `theylive-*` and `flirty-*`. The run
log is `run-figurines.log`, and the `--info` output is in `info/`.

What happened on reading:
- **Super Man**: the unmodified tool refused it with *"ProjectError: superman parts.obj
  contains a negative cutout volume. Enable native negative-volume preservation to open
  it."* The tool was changed to allow negative volumes (see Method), and the file then
  ran.
  - It has 6 source colours and 4 plates. Each plate holds one object with 26 normal
    parts and one negative part.
  - Only **plate 1** was run; it is 15.0 mm tall. Plates 2–4 were exported unbanded to
    check (`--plate=N --no-band`): each is also 15.0 mm tall with 326,320–327,952
    triangles. None was banded or sliced.
- **They Live Alien**: a PrusaSlicer-style project with 8 source colours and one
  object. It read and exported without change.
- **Flirty Figures Alien**: 4 colours, one object. It read and exported without change.
- Source colours above 4 are folded onto reels 1–4 by the mapping. This does not
  matter here, because every painted face is then repainted with the layer pattern.

| Model | Height | Split-painted | Layer | Triangles before → after | 3MF | Uncompressed model | Spike | Slice | Slicer warnings (besides exclude-triangles) | `--info` banded | `--info` unbanded (`--no-band`) | Layers checked | Strict fail | Colour-only fail | Visible-surface fail (of which < 162 sectors) | Tool changes | Print time | Tower g / total g |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Super Man (plate 1) | 15.0 mm | 0 | 0.08 | 327,952 → 1,761,194 | 31.4 MB | 170.1 MB | 17 s | 16.9 s | "Reversing even wall line causes it to be printed CCW instead of CW!" | manifold = no, 4 open edges, 26 parts | manifold = yes, 26 parts | 184 | 65 | 9 | 62 (62) | 278 | 4 h 23 m | 15.0 / 22.3 |
| Super Man (plate 1) | 15.0 mm | 0 | 0.12 | 327,952 → 1,284,789 | 22.5 MB | 122.6 MB | 13 s | 12.8 s | "Detected missing Voronoi vertex even after the rotation of input." | manifold = no, 3 open edges, 26 parts | as above | 123 | 48 | 15 | 44 (44) | 224 | 2 h 51 m | 13.6 / 21.3 |
| They Live Alien | 140.0 mm | 152 | 0.08 | 1,333,448 → 7,922,682 | 133.2 MB | 799.0 MB | 144 s | 135.0 s | none | manifold = no, 2,580 open edges, 19 parts | manifold = no, 120 open edges, 18 parts | 1,746 | 1,677 | 8 | 25 (20) | 2,939 | 45 h 9 m | 115.5 / 234.1 |
| They Live Alien | 140.0 mm | 152 | 0.12 | 1,333,448 → 5,727,491 | 95.2 MB | 571.5 MB | 93 s | 87.8 s | "Detected finite Voronoi vertex with non finite vertex even after the rotation of input." | manifold = no, 2,379 open edges, 20 parts | as above | 1,164 | 1,118 | 10 | 19 (13) | 2,017 | 31 h 43 m | 119.7 / 236.5 |
| Flirty Figures Alien | 105.4 mm | 12,233 | 0.08 | 608,046 → 4,262,422 | 84.5 MB | 441.4 MB | 66 s | 39.6 s | none | manifold = no, 556,786 open edges, **46,439 parts** | manifold = yes, 3 parts | 1,315 | 58 | 14 | 343 (337) | 1,434 | 20 h 34 m | 68.6 / 116.5 |
| Flirty Figures Alien | 105.4 mm | 12,233 | 0.12 | 608,046 → 3,119,295 | 62.5 MB | 320.2 MB | 48 s | 28.7 s | none | manifold = no, 472,861 open edges, **53,446 parts** | as above | 877 | 47 | 16 | 232 (223) | 1,016 | 14 h 45 m | 73.4 / 120.2 |

All six slices exited 0 and produced G-code (16–183 MB). All logged the usual
`calc_exclude_triangles` error. Print times are the slicer's estimates. Tower grams
are computed from the G-code as above.

Open edges, separated by cause. These are the spike's own counts on the welded output;
Orca's `--info` counts are close but not identical for They Live (it reports 120 in
the source where the spike counts 80):

| Model | Layer | Source (unbanded) | Banded | Banded, `--whole-splits` | Attributable to split paint | Left after `--whole-splits`, beyond the source |
|---|---|---|---|---|---|---|
| Super Man | 0.08 | 0 | 4 (+5 edges on 3+ faces) | 4 | 0 (no splits) | 4 |
| Super Man | 0.12 | 0 | 3 (+5 edges on 3+ faces) | 3 | 0 | 3 |
| They Live Alien | 0.08 | 80 (+49 on 3+ faces) | 2,519 | 429 | 2,090 (83%) | 349 |
| They Live Alien | 0.12 | 80 | 2,324 | 308 | 2,016 (87%) | 228 |
| Flirty Figures Alien | 0.08 | 0 (+22 on 3+ faces) | 556,784 | 158,053 | 398,731 (72%) | 158,053 |
| Flirty Figures Alien | 0.12 | 0 | 472,859 | 81,017 | 391,842 (83%) | 81,017 |

In the one-off 1e-4 mm weld experiment, Flirty at 0.12 mm with `--whole-splits` went
from 81,017 open edges to **0**, with 1,073 strips collapsing to zero area. So on that
model most of the non-split open edges are cut-point mismatches larger than 1e-6 mm.
This was not repeated for the other models or heights.

What the figurines show:
- **Every file sliced.** None was rejected, at either height. No mesh-repair message
  appeared in the command-line log, but `--info` reports every banded output as
  non-manifold. On Flirty, banding broke a 3-part mesh into about 46,000–53,000
  disconnected parts.
- **The strict rule fails on most They Live layers and some Super Man and Flirty
  layers.** By the colour-only view (reel 4 ignored), 8–16 layers per file have
  another colour reel above 5%. These always include layers 1–2. On the test solid
  those two layers were bottom-shell carry-over; on the figurines that was not
  checked. The rest are not classified. Whether any of these stray paths is visible
  was **not determined**. The visible-surface view cannot judge these shapes: most of
  its failures are layers with fewer than 162 occupied sectors. They Live has 5–6
  layers per height and Flirty 6–9 that fail on a foreign colour rather than on
  occupancy. They were not inspected.
- **Cost at full size:** about 5–7× (0.08) and 4–5× (0.12) more triangles, model XML up
  to 799 MB, and 3MF up to 133 MB. Print estimates run to 45 h for the 140 mm They
  Live Alien at 0.08 mm, with the prime tower about half the filament (115–120 g of
  about 235 g). At 0.12 mm the same model is 31.7 h.

## What was and was not verified

Verified (measured, reproducible with the commands below):
- The spike's triangle, vertex, size and open-edge counts; Orca's `--info` agrees on
  facets and open edges.
- Orca 2.4.1 command-line slicing succeeds (exit 0) for all three test-solid outputs
  and all six figurine outputs. It refuses the fixtures.
- Per-layer tool use of `Outer wall` extrusions in the G-code, under the three rules above.
- The slicer's own print-time, filament and filament-change figures; tower grams
  computed from the G-code.

Not verified:
- **Whether the figurines' colours are right on the visible surface.** The
  visible-surface view only works for star-shaped layers. On the figurines, the
  colour-only view finds 8–16 layers per file with a stray colour that was not
  inspected.
- **Super Man plates 2–4** (only plate 1 was banded and sliced).
- **Any print.** Nothing was printed; whether the bands look like the intended colour
  is unknown.
- Whether Orca silently repairs the non-manifold mesh while slicing, and whether the
  GUI shows a repair or non-manifold warning. Only the command line was used.
- Whether Orca reports the same results in the GUI (whose prime-tower handling differs
  from the command line).
- The visible-surface rule only applies to star-shaped layers; it is not a general
  checker.
- The `--whole-splits` and 1e-4 mm weld controls were counted (spike and `--info`) but
  not sliced.
- The last 12 open edges on the test solid at 0.12 mm (1e-4 weld, `--whole-splits`)
  are unexplained.
- No baseline (unbanded) slice, so the extra cost is not separated from the cost of
  multi-colour printing in general.

## Reproduce

```
O=.superpowers/sdd/2026-11-10-built-in-colours-1a/spike-output
node tools/built-in-colours-spike.mjs --make-test-solid $O/test-solid-source.3mf
node tools/built-in-colours-spike.mjs web/tests/four-colours.3mf 0.08 $O/four-colours-0.08.3mf      # and 0.12; five-colours likewise
node --max-old-space-size=8192 tools/built-in-colours-spike.mjs $O/test-solid-source.3mf 0.08 $O/test-solid-0.08.3mf
node --max-old-space-size=8192 tools/built-in-colours-spike.mjs $O/test-solid-source.3mf 0.12 $O/test-solid-0.12.3mf
node --max-old-space-size=8192 tools/built-in-colours-spike.mjs $O/test-solid-source.3mf 0.08 $O/test-solid-0.08-raw.3mf --raw
node --max-old-space-size=8192 tools/built-in-colours-spike.mjs $O/test-solid-source.3mf 0.12 $O/test-solid-0.12-wholesplits.3mf --whole-splits   # and 0.08
node tools/built-in-colours-spike.mjs $O/test-solid-source.3mf 0.08 $O/test-solid-noband.3mf --no-band
"C:/Program Files/Snapmaker_Orca/snapmaker-orca.exe" --arrange 0 --orient 0 --slice 0 --outputdir $O/gc-test-solid-0.08 $O/test-solid-0.08.3mf
"C:/Program Files/Snapmaker_Orca/snapmaker-orca.exe" --info $O/test-solid-0.08.3mf
node --max-old-space-size=8192 tools/check-built-in-toolpaths.mjs $O/gc-test-solid-0.08/plate_1.gcode 0.2 0.08
```

Figurines: `$O/run-figurines.sh` (spike runs, including `--no-band` and
`--whole-splits` for each model), then `$O/slice.sh <name>` for each banded output,
`--info` on each output, and the checker as above (`--max-old-space-size=12288` for the
spike on They Live Alien).

## After the gap fix (11 November 2026)

The spike tool now bands every painted mesh with `bandMesh` (`web/shared/paintBands.js`).
Split paint is no longer expanded into loose triangles. Every point made on a straight
line (an input edge, or a line a split created) is registered against that line and made
once: split midpoints by their position along the line, layer crossings by their plane,
computed from the line's own two end points. Every piece then walks its sides through all
the points registered on its line, so pieces meet by vertex index. Nothing is welded.
Unpainted faces of a painted mesh are cut too, so their edges match, but stay unpainted.

All runs are at 0.12 mm, in Node's default heap, with the same export, dual wall and
`[1,2,3][layer % 3]` pattern as before. "Source" is the same export with `--no-band`
(unbanded, and now unwelded). Open edges and parts are Orca's `--info`; Orca prints no
open-edge count when the mesh is manifold, shown here as 0. Outputs, `--info` text,
G-code and logs are in `spike-output/gapfix/`.

| File | Triangles before → after | 3MF | Open edges, source → banded | Parts, source → banded | Spike | Slice | Slicer warnings (besides exclude-triangles) | Tool changes | Print time (estimate) | Tower g / total g |
|---|---|---|---|---|---|---|---|---|---|---|
| Test solid | 200,160 → 1,408,650 | 23.3 MB | 0 → 0 (manifold = yes) | 1 → 1 | 6.4 s | 14.8 s, exit 0 | none | 1,250 | 16 h 0 m | 71.8 / 120.0 |
| Super Man (plate 1) | 327,952 → 1,284,792 | 22.9 MB | 0 → 0 (manifold = yes) | 26 → 26 | 6.4 s | 12.8 s, exit 0 | "Detected missing Voronoi vertex even after the rotation of input." | 224 | 2 h 51 m | 13.6 / 21.3 |
| They Live Alien | 1,333,448 → 5,728,308 | 98.3 MB | **364 → 842** (manifold = no) | 77 → 77 | 40.3 s | 89.4 s, exit 0 | none | 2,017 | 31 h 44 m | 119.7 / 236.6 |
| Flirty Figures Alien | 608,046 → 3,283,930 | 64.9 MB | 0 → 0 (manifold = yes) | 3 → 3 | 25.6 s | 29.1 s, exit 0 | none | 934 | 13 h 20 m | 64.2 / 111.8 |

Super Man's triangle counts include its negative part (3,072 triangles), which is not
banded; Orca counts 324,880 → 1,281,720 facets without it.

What this shows:
- **Flirty no longer breaks apart.** Before the fix it had 472,861 open edges and 53,446
  parts at 0.12 mm; now it is manifold with its 3 parts.
- **The test solid and Super Man are manifold**, where before they had 6,325 and 3 open
  edges.
- **They Live has more open edges than its source by count (842 against 364), but no new
  gap.** Its source is open: 364 open edges and 77 parts in Orca, the same for the
  owner's original file read directly. (The 120 open edges and 18 parts recorded above
  were for the old `--no-band` output, which was welded at 1e-6 mm.) Banding cuts each
  open source edge at the layer planes it crosses, so one open edge becomes several. A
  separate check (`gapfix/open-check.mjs`, results in `gapfix/open-check.log`) found
  that every one of the 824 open edges the spike counts by index lies along one of the
  346 open edges of the source mesh. No open edge appears anywhere else, and the part
  count is unchanged.
- Flirty's source has 18 edges used by more than two faces (back-to-back duplicate
  faces); banded, there are 27. 23 lie along those source edges; the other 4 lie inside
  duplicated faces, which both get the same cuts.
- Strict-rule results from `tools/check-built-in-toolpaths.mjs` (same rules as above):
  test solid 831 of 832 layers fail (the inner reel's walls, as before), Super Man 48 of
  123, They Live 1,118 of 1,164, Flirty 16 of 877. Colour-only view: 4, 15, 10 and 16
  layers with another colour reel above 5%. These were not inspected.

Zero-area pieces and repeated vertices, counted by the spike tool on the banded meshes
(exact coordinates and an exactly zero cross product):
- Test solid: none of either. Smallest piece 8.4e-9 mm².
- Super Man: no repeated vertex. There is 1 zero-area piece, and it is the source's own
  degenerate face (three collinear vertices), passed through uncut.
- They Live: no zero-area piece. 147 new vertices repeat another vertex, and all 147 lie
  on source edges between vertices that the source itself repeats (it has 180 coincident
  vertex pairs along its open seams).
- Flirty: no zero-area piece. 1 new vertex repeats another; it lies on two source edges
  that coincide because the source has two vertices at the same point (Flirty has 11
  such vertices).
- Smallest pieces on the figurines: 1.2e-14 mm² on They Live and 4.7e-14 mm² on Flirty.
  These are not zero, but they are far below anything the printer can make.
- So `bandMesh` makes no repeated vertex and no zero-area piece except where the source
  already has coincident vertices or a degenerate face.
- These counts were re-run after the fix for flat strips on a plane (fix round 1). That
  fix left all four banded meshes byte-identical (same model XML), so `--info` and the
  slices above still apply.

Not verified:
- **Nothing was printed** and no slice was opened in the GUI. Print times are the
  slicer's estimates; tower grams are computed from the G-code.
- Whether Orca repairs anything while slicing, and whether the colours look right on the
  visible surface.
- 0.08 mm was not re-run; nor were the `--whole-splits` controls or Super Man plates 2–4.
- They Live's open edges are the source's own; they were not repaired.

Reproduce (from the repo root):

```
G=.superpowers/sdd/2026-11-10-built-in-colours-1a/spike-output/gapfix
bash $G/run-gapfix.sh > $G/run-gapfix.log 2>&1     # spike runs, --no-band and banded, default heap
cd $G && ./info.sh test-solid-noband test-solid-0.12 superman-noband superman-0.12 theylive-noband theylive-0.12 flirty-noband flirty-0.12
./slice.sh test-solid-0.12    # and superman-0.12, theylive-0.12, flirty-0.12
node --max-old-space-size=14000 open-check.mjs theylive-noband.3mf theylive-0.12.3mf
```

### Model-aware toolpath check (Task 12, 11 November 2026)

`tools/check-built-in-toolpaths.mjs <gcode> --model <exported.3mf>` now compares the
G-code with the exported model's own paint (functions in `tools/builtInToolpathCheck.mjs`,
3MF reading in `tools/builtInModelReader.mjs`). Each layer above the first is cut at
mid-layer height. The reel of each triangle comes from its paint, or from its part's
extruder when it has none. Outline that lies inside another part or another shell, or
inside a negative part, is left out, because it is not printed surface. Every "Outer
wall" move is sampled every 0.2 mm:
- A sample within 0.35 mm of the outline is visible and is judged against the reel of
  the outline next to it.
- A sample further away is hidden and is not judged. This is the inner reel's own outer
  wall, about 0.66–0.70 mm in on the test solid.
- Orca also prints the inner edge of the 0.45 mm colour shell as a second "Outer wall"
  loop, about 0.24 mm in. It is in the colour reel and counts as visible.

Pass needs all three of these: at least 99% matched overall, no layer with over 20 mm
judged below 95%, and at least 90% of the outline covered. "Overhang wall" moves are
not counted as outer wall.

Alignment: the G-code is in bed coordinates. These equal the build-item transform with
each item dropped so that its lowest printed point is at z = 0. No plate offset was
needed. The median distance from the outline to the nearest outer-wall sample is 0.215–0.225 mm on all four
files, which is half a 0.42 mm line, so model and G-code line up. Moving the model 1 mm
in x raises it to 0.665 mm and the check stops. The brief's own measure, the median
over visible samples, stayed at 0.205 mm even then, so it cannot show misalignment on
its own. A 0.4 mm shift is not caught by that median (0.215 mm), but coverage falls to
61% and the check fails. G-code: relative extrusion (M83) throughout. There are G2/G3
arcs, but they are all travel moves (spiral lifts), and no outer wall is an arc. Wipes
and retractions have E ≤ 0 and are not counted. Default Node heap; They Live peaked at
507 MB resident.

| File | Layers checked | Matched share | Worst layer (judged > 20 mm) | Covered share | Mixed share | Hidden (not judged) | Median visible distance | Result | Run time |
|---|---|---|---|---|---|---|---|---|---|
| Test solid | 832 | 100.00% (0 mm wrong) | 1 at 100.00% | 100.00% | 0.00% | 107,736 mm | 0.222 mm | **pass** | 8.1 s |
| Super Man (plate 1) | 123 | 99.67% (97 mm wrong) | 101 at 92.08% | 99.32% | 0.00% | 11,040 mm | 0.213 mm | **fail** | 5.5 s |
| They Live Alien | 1,164 | 99.81% (449 mm wrong) | 17 at 0.00% | 95.53% | 0.00% | 295,895 mm | 0.210 mm | **fail** | 28.4 s |
| Flirty Figures Alien | 877 | 99.92% (121 mm wrong) | 220 at 70.94% | 98.45% | 0.00% | 4,110 mm | 0.212 mm | **fail** | 14.1 s |

The three figurines fail on the per-layer rule alone; matched share and coverage are
above their limits. Layers with over 20 mm judged and below 95% matched:
- Super Man: layer 101.
- They Live: layers 17, 112, 174 and 207.
- Flirty: layers 206, 220, 446 and 447.

Mixed share is 0 because, in these files, every layer has one reel round its whole
outline. Per-layer tables are in `spike-output/gapfix/gc-*/plate_1.gcode.model-check.json`
and the console output is in `gapfix/model-check.log`.

Why they fail. It is not a checker fault and not an alignment fault. The wrong walls are
in the reel of a nearly flat face next to them, from the neighbouring layer's band:
- **The check.** `gapfix/wrong-near-flat-faces.mjs` (log `wrong-near-flat-faces.log`)
  looks for a model face within 26° of horizontal (|nz| ≥ 0.9) in a reel other than
  the outline's. The face must be within 0.6 mm in x/y of the sample and in this layer,
  the one above or the one below.
- **Wrong walls with such a face in the wall's own reel:** 96.8 of 96.8 mm on Super Man,
  443.3 of 448.6 mm on They Live, and 121.2 of 121.2 mm on Flirty.
- **Walls with no such face nearby:** 23,670 mm, 213,238 mm and 137,567 mm. Of these,
  0, 5.2 and 0 mm are wrong. They Live's 5.2 mm is the inner reel (T3) beside thin
  internal slots (layer 52, (140.69, 77.53)).
- **The faces lie between a band boundary and the next layer's slice plane.** Banding
  paints such a face with its band's reel. Orca slices it into the layer next door,
  treats it as that layer's top (or bottom) and uses its paint for the outer wall there.
- **Examples:**
  - They Live layer 17 (z 2.24): the plinth ledge, a top face at z 2.29 in layer 18's
    band (reel 1). Orca slices layer 18 at 2.30. The whole 194.4 mm round the plinth is
    printed T0 (reel 1) where the paint says reel 3, e.g. at (149.39, 122.41).
  - They Live layer 207: a top face at 25.04, 96.8 mm in T1, e.g. at (148.99, 118.37).
  - Flirty layer 220: a top face at 26.62, 61.2 mm in T2, at (113.19, 108.28).
  - Flirty layer 206: a top face at 24.93, 22.2 mm in T0, at (114.42, 105.51).
  - Super Man layer 101: a top face at 12.32, 5.2 mm in T0, at (165.96, 184.50).
  - Underside faces do the same upwards: Super Man layer 1 (faces at z 0.08) and They
    Live layer 112 (a face at 13.49).
- **Mid-layer is the right height to cut at:** cutting at a quarter or three quarters of
  the layer instead gives slightly lower coverage on Flirty (`cut-height-check.mjs`).

So the slicer prints these walls in the reel painted on the flat face beside them. It
does not print them in the reel painted on the side of that layer. At every ledge, top
and overhang underside that falls between those two heights, the side of one layer takes
the colour of the next. Whether this is acceptable, and whether banding should paint
such faces by Orca's slice planes instead of by band boundaries, is for the owner to
decide. The thresholds were not changed.

The first run had a checker fault, which is now fixed. Outline inside overlapping parts
and shells was counted, both for coverage and when judging walls. Super Man's 26 parts
overlap, and They Live has overlapping shells and four 0.06–0.09 mm slots in its
plinth. The first run gave They Live 91.07% covered and Super Man 91.49%, both
understated. The check now keeps only outline whose outside is not inside other solid
(non-zero winding, with the solid kept on the segment's left). That leaves out 18,217 mm
on Super Man, 12,967 mm on They Live and 574 mm on Flirty. The figures above are after
the fix.

What is still uncovered:
- They Live's plinth slots are narrower than twice Orca's 0.049 mm closing radius. Orca
  closes them and prints infill there, so 93 of its layers are under 90% covered.
- Flirty layer 21 is printed as overhang wall.
- Small tips near the tops of the figurines.

Not verified:
- **This shows where the slicer puts each reel, not the colour of a printed part.**
  Nothing was printed, nothing was sent to a printer and no slice was opened in the GUI.
- Only these four 0.12 mm slices were checked.
- The check judges only moves typed "Outer wall". Overhang walls are reported but not
  judged.
- The flat-face explanation is a measured association, plus the slice-plane arithmetic
  for the examples. Orca's source was not read to confirm it.

Reproduce (from the repo root):

```
G=.superpowers/sdd/2026-11-10-built-in-colours-1a/spike-output/gapfix
for f in test-solid superman theylive flirty; do
  node tools/check-built-in-toolpaths.mjs $G/gc-$f-0.12/plate_1.gcode --model $G/$f-0.12.3mf --json $G/gc-$f-0.12/plate_1.gcode.model-check.json
done
node --max-old-space-size=12000 $G/wrong-near-flat-faces.mjs $G/gc-theylive-0.12/plate_1.gcode $G/theylive-0.12.3mf
```
