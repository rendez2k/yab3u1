# Built-in colours spike: does Snapmaker Orca honour layer-banded paint? (November 2026)

Throwaway spike for the built-in colours plan, Task 2 (the gate before Task 3).
Nothing here is wired into the app. **No print was started.**

## Question

If every painted triangle is cut into horizontal strips at the slicer's layer
boundaries, and each strip is painted with one reel, does Snapmaker Orca 2.4.1
print each layer's outer wall in that reel, on a model of realistic size?

## What was tested

**No real scanned or sculpted figurine was tested.** None was supplied. In its place:

1. `web/tests/four-colours.3mf` (named in the brief) and `web/tests/five-colours.3mf`
   (the largest painted fixture in the repo, 3,265 bytes). Both contain only flat,
   zero-thickness 10 mm squares, so they cannot be sliced at all (see results).
2. A generated painted test solid (`--make-test-solid`): a closed, lumpy cylinder,
   100 mm tall, about 46 mm across, 200,160 triangles, 100,082 vertices, with three
   painted shades over different regions (two 120° sectors and a top band) plus the
   part's own filament elsewhere, and 1,200 split-painted triangles where regions meet
   (one- and three-side splits, some nested). Source mesh: 0 open edges.

The test solid is curved and of realistic size and triangle count, but it is
star-shaped, smooth and has no overhangs, thin features or multiple shells. A real
figurine may behave differently.

## Method

`tools/built-in-colours-spike.mjs <input.3mf> <layerHeight> <output.3mf> [--raw]`:

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
5. Strip corners closer than 1e-6 mm are merged (welded) unless `--raw` is given. See
   finding 2 for why.

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
  lying furthest out. The layer fails if more than 5% of sectors belong to another
  tool. Only valid for star-shaped layers such as this test solid.

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
   colour. That is far above the 5% limit. In layers 1–2, a reel-1 `Outer wall` of
   about 120 mm also appears inside the surface: the bottom face is in layer 0 (reel 1)
   and its paint is carried up into the bottom shell. Neither path is outermost. A
   checker for the real feature needs to tell the outermost path from region
   boundaries. The strict counts are reported as measured.

3. **The banded mesh is not watertight, and the slicer says so.** Measured two ways
   that agree exactly (the spike's own edge count and Orca's `--info`):
   - `bandTriangle` (Task 1) computes a cut point from whichever polygon edge it is
     clipping at the time. The same point reached from the strip above and the strip
     below, or from two neighbouring triangles, can differ in the last bits. Unwelded,
     this gives 646,512 open edges and Orca counts 71 separate parts. Merging corners
     within 1e-6 mm removes all of these.
   - The remaining 6,012 (0.08) and 6,325 (0.12) open edges all come from expanding
     split paint into real sub-triangles. A split adds a midpoint on an edge that the
     unsplit neighbour does not have (a T-junction), and banding repeats it in every
     layer. Measured control: with splits treated as whole triangles, the welded
     result had 0 open edges. That variant was not sliced.

   Orca sliced every one of these meshes without an error and the colours came out
   right. However, `--info` reports `manifold = no`, and the log does not show
   whether Orca repaired the mesh while slicing. By the gate rule ("if the slicer
   repairs or rejects the mesh, do not continue"), **this needs the owner's
   decision.** Both causes can be fixed in the geometry (cut from the original edge;
   split the unsplit neighbour at the same midpoint), but that is a re-plan, not
   something this spike changes.

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

## What was and was not verified

Verified (measured, reproducible with the commands below):
- The spike's triangle, vertex, size and open-edge counts; Orca's `--info` agrees on
  facets and open edges.
- Orca 2.4.1 command-line slicing succeeds (exit 0) for all three test-solid outputs.
  It refuses the fixtures.
- Per-layer tool use of `Outer wall` extrusions in the G-code, under both rules above.
- The slicer's own print-time, filament and filament-change figures; tower grams
  computed from the G-code.

Not verified:
- **Any real figurine.** Only a synthetic, star-shaped solid was tested.
- **Any print.** Nothing was printed; whether the bands look like the intended colour
  is unknown.
- Whether Orca silently repairs the non-manifold mesh while slicing, and whether the
  GUI shows a repair or non-manifold warning. Only the command line was used.
- Whether Orca reports the same results in the GUI (whose prime-tower handling differs
  from the command line).
- The visible-surface rule only applies to star-shaped layers; it is not a general
  checker.
- A T-junction-free (split-safe) banded mesh was counted as watertight but not sliced.
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
"C:/Program Files/Snapmaker_Orca/snapmaker-orca.exe" --arrange 0 --orient 0 --slice 0 --outputdir $O/gc-test-solid-0.08 $O/test-solid-0.08.3mf
node --max-old-space-size=8192 tools/check-built-in-toolpaths.mjs $O/gc-test-solid-0.08/plate_1.gcode 0.2 0.08
```
