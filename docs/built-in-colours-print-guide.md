# Built-in colours: print guide (experimental)

Prepared 11 November 2026 for the Snapmaker U1 with a 0.4 mm nozzle.

**Read this first.** Built-in colours is an **experimental mode that has never been printed**. The files described here have been sliced with the Snapmaker Orca command line and toolpath-checked. Nobody has printed them yet.

- Every shade in this guide is an **estimate**. It comes from the existing two-reel colour predictor, extended to more reels. It is not a measurement.
- Slicer print times and filament weights are also **estimates**.
- A toolpath check shows which reel the slicer puts where. It is **not** a check of the printed colour.
- Nothing has been validated or proven.

The files are in `deliverables/built-in-colours-demo-2026-11/`. That folder is not in git. `READ-ME-FIRST.txt` in the folder repeats the essentials.

For release 2.6.76 the reference plate was rebuilt with the release code into `deliverables/built-in-colours-reference-2026-11/` (also not in git). It is the same plate: every member of the file is byte-for-byte the same as the demo folder's copy apart from the random identifiers (`p:UUID`) every export writes, and its slice and toolpath checks give the same figures as those below. Either copy can be printed. What the release contains, its limits and its proof run are in `docs/built-in-colours-release-2.6.76.md`.

## What the mode does

Each source colour becomes a **recipe**: a repeating layer-by-layer sequence of your model reels (three when the PETG support slot is reserved).

- The sequence is written into the model as paint, but only in a **0.45 mm outer shell**.
- Inside the shell, the model prints in one **backing reel**.
- On a steep wall, the layers of different reels sit on top of each other, and from a distance the eye should mix them.
- Flat and gently sloped areas cannot mix that way. They print as **single-reel bands**, often clearly striped.
- Beside near-flat ledges, a layer's wall can take the reel of the layer next to it. The toolpath checks below show where this happens for these files.

## Fixed layer heights: do not change them

| Setting | Value |
|---|---|
| Layer height | **0.12 mm** |
| First layer | **0.2 mm** |
| Outer colour depth | 0.45 mm (set in the file) |

The colour pattern is cut into the model for these exact heights. **Changing the layer height, the first-layer height, adaptive layers or variable layer height in the slicer will put the wrong reel on each layer.** Leave the other settings in the file as they are, including `precise_z_height` off and no raft.

## How to print

1. Open the `.3mf` in your own slicer (Snapmaker Orca) and slice it there. **Print from the 3MF, not from the G-code in the folder.** That G-code was made only to run the checks.
2. Load the reels in the slots shown in the table below. They must be in exactly that order.
3. **Before printing, check the sliced preview.** Use the colour or tool view and step through the layers. The outside walls should change reel layer by layer, as the plan tables below say. If they do not, stop.
4. Do not change the layer heights (see above).

## Files

| File | Reels, slots 1–4 | Backing (interior) | Layers | Estimated time | Tool changes | Filament (estimate) | Prime tower (approx.) |
|---|---|---|---|---|---|---|---|
| `reference-plate-cmyw-0.12.3mf` | ELEGOO Rilievo cyan, magenta, yellow, white | white (slot 4) | 104 at 0.12 mm | 2 h 3 m | 227 | 19.8 g | 13.2 g (67%) |
| `backpack-cmyw.3mf` | ELEGOO Rilievo cyan, magenta, yellow, white | white (slot 4) | 199 at 0.12 mm | 3 h 6 m | 134 | 32.6 g | 15.4 g (47%) |
| `backpack-cmyk.3mf` | ELEGOO Rilievo cyan, magenta, yellow, then **black (generic, estimate)** | **yellow (slot 3)** | 199 at 0.12 mm | 4 h 21 m | 279 | 40.6 g | 21.2 g (52%) |

How the figures were obtained:
- **Times, filament and tool changes** are the slicer's own estimates.
- **Prime-tower grams** are the net extrusion of the tower moves in the G-code, so they are approximate.
- On the figurines tested earlier, the prime tower took 55–75% of the filament. Here it takes 47–67%.

Notes on the reel sets:
- **Black in `cmyk`.** The repository has no ELEGOO Rilievo black, so slot 4 is a generic black PLA (`#000000`) labelled "black (generic, estimate)". Use any black PLA. The backpack chosen uses no colour that needs black, so `backpack-cmyk.3mf` prints **0 g of black**. Slot 4 must still hold a reel.
- **Yellow interior in `cmyk`.** The backing defaults to the lightest reel, which in `cmyk` is yellow. **The inside of the `cmyk` backpack prints yellow.**
- **Supports.** The backpack's own project turns supports on for that object (tree supports). The slicer prints them with its default support filament, which is not part of the colour pattern.

## The backpack: "Backpack - Pink & White"

This is from the owner's model, *Clickify 3D – Backpack Buddies – Christmas Edition*, plate 1.
- **Why this one:** all six backpacks are the same mesh (899,948 triangles; 46 × 62 × 24 mm as placed). Pink & White is the only one with three colours; every other backpack has two.
- **Size limit:** it was not refused. At 0.12 mm it becomes 2,658,126 triangles.
- **Negative part:** the backpack contains one small negative (cut-out) part of 344 triangles. The tool reads the project with negative parts allowed (`allowNegative`), and the cut-out is carried into the export as a negative part.

### How to read the plan tables

- **Every shade is an estimate built from the reels' nominal display colours** (the catalogue swatches `#00FFFF`, `#FF00FF`, `#FFFF00`, `#FFFFFF` and, for `cmyk`, `#000000`), mixed by the layer-interleaved predictor. The real reels differ from these swatches, and no mixed shade has been measured.
- **The error** is the ΔE2000 distance between the target (source) colour and that estimate. It says how close the planner thinks it can get with nominal reels; it is not a prediction of the printed colour.
- **Labels used in this guide** (this guide's own convention, not a standard): an estimated error of **20 or more** is called **out of reach**; **10 to under 20** is called **poor**; **under 10** has no label.

### Plan, `backpack-cmyw.3mf` (C M Y W = reels 1 2 3 4)

| Source colour | Recipe (reel per layer, repeating) | Estimated shade | Estimated error (ΔE2000) |
|---|---|---|---|
| `#D3B7A7` beige | `4344244414434424443444244434414442443444` (40 layers) | `#D9BEAE` | 2.5 |
| `#FFFFFF` white | `4` (white only) | `#FFFFFF` | 0 |
| `#E8AFCF` pink | `442443444244` (12 layers) | `#EEAAD0` | 2.3 |

All three estimated errors are under 10, so none is labelled. That says only that the estimate built from nominal reel colours is close to each target; it is not a prediction of how the print will look.

### Plan, `backpack-cmyk.3mf` (C M Y K = reels 1 2 3 4)

| Source colour | Recipe | Estimated shade | Estimated error (ΔE2000) |
|---|---|---|---|
| `#D3B7A7` beige | `321323` | `#A37343` (brown) | **27.9, out of reach** |
| `#FFFFFF` white | `11211311` | `#00CBD3` (cyan) | **48.5, out of reach** |
| `#E8AFCF` pink | `123` | `#737373` (grey) | **31.5, out of reach** |

**All three of the backpack's colours are out of reach with this reel set** (estimated errors of 20 or more). Without a white reel the planner has no way to lighten them, so, from nominal reel colours:
- the white is estimated to come out cyan;
- the pink is estimated to come out grey;
- the beige is estimated to come out brown.

Print this file only to see how a CMYK set behaves on light colours. It is not a faithful version of the backpack.

### The whole model's twelve colours

These are the estimates for all twelve filament colours in the owner's model, from the same planner (`node tools/export-built-in.mjs` plans only the colours of the chosen objects). As above, every shade is an estimate from the reels' nominal display colours, the real reels differ and no mixed shade has been measured; the labels follow this guide's convention (20 or more: out of reach; 10 to under 20: poor; under 10: no label).

| Source | `cmyw` shade, error | `cmyk` shade, error |
|---|---|---|
| `#D3B7A7` beige | `#D9BEAE`, 2.5 | `#A37343`, **27.9, out of reach** |
| `#FFFFFF` white | `#FFFFFF`, 0 | `#00CBD3`, **48.5, out of reach** |
| `#DE4343` red | `#E84F52`, 4.0 | `#CF4A3E`, 3.2 |
| `#000000` black | `#737373`, **48.4, out of reach** | `#000000`, 0 |
| `#042F56` navy | `#646596`, **26.4, out of reach** | `#152C4B`, 2.8 |
| `#F99963` orange | `#E69C78`, 4.7 | `#ED831A`, 10.8, poor |
| `#C2E189` light green | `#B7D773`, 4.3 | `#A6CC00`, 15.6, poor |
| `#68724D` olive | `#7B7D5F`, 6.0 | `#637753`, 3.4 |
| `#F7D959` yellow | `#EDD056`, 3.3 | `#F6CF00`, 6.0 |
| `#A3D8E1` light blue | `#9FD5DC`, 1.5 | `#00CBD3`, 16.1, poor |
| `#E5B03D` gold | `#E6AB2A`, 2.1 | `#F2B100`, 4.5 |
| `#E8AFCF` pink | `#EEAAD0`, 2.3 | `#737373`, **31.5, out of reach** |

By that convention:
- **`cmyw`:** out of reach: black (48.4), navy (26.4). Poor: none. The other ten are under 10.
- **`cmyk`:** out of reach: white (48.5), pink (31.5), beige (27.9). Poor: light blue (16.1), light green (15.6), orange (10.8). The other six are under 10.

## The reference plate: `reference-plate-cmyw-0.12.3mf`

The plate has eight numbered hollow cylinders, each 10 mm across and 12 mm tall with a 1.2 mm wall and an open top.
- Each cylinder stands on a white base (0.56 mm thick) with a raised number.
- Paint covers every outside face of each cylinder, the inner face of the wall as well as the outer face, to a depth of 0.45 mm, so both faces of the wall carry the sample's sequence. Only the core of the 1.2 mm wall between those two shells (about 0.3 mm) is the white backing.
- Load ELEGOO Rilievo cyan, magenta, yellow and white in slots 1–4.
- Ratios are layers per reel, spread evenly. The sequence counts layers from the first layer, so each cylinder starts part-way into its sequence.

| No. | Sample | Sequence | Estimated shade |
|---|---|---|---|
| 1 | Pure cyan | `1` | `#00FFFF` |
| 2 | Pure yellow | `3` | `#FFFF00` |
| 3 | C1:Y1 | `13` | `#30F845` |
| 4 | C1:Y3 | `3133` | `#9DFA00` |
| 5 | C1:M1:Y1 | `123` | `#737373` |
| 6 | C1:W3 | `4144` | `#7EFCFF` |
| 7 | M1:Y1:W2 | `4234` | `#E1898C` |
| 8 | C1:M1:Y1:W1 | `1234` | `#828282` |

As for the backpack, these estimates are built from the catalogue's nominal display colours (`#00FFFF`, `#FF00FF`, `#FFFF00`, `#FFFFFF`), not measured ones. That is why they look so saturated. The real reels differ and no mixed shade has been measured; the printed samples will show what the reels actually do. That is what the plate is for.

## Toolpath checks

`tools/check-built-in-toolpaths.mjs --model` compares the slicer's outer-wall moves with the reel painted next to them, layer by layer.
- A run passes when at least 99% of the judged wall is in the right reel, no layer with over 20 mm judged is below 95%, at least 90% of the outline is covered, and the outline guard holds.
- The check was run at the nominal height and with the model shifted in z by −0.03, −0.02, +0.02 and +0.03 mm. The shifts show how sensitive each file is to a small height error.
- **These are checks of where the slicer puts each reel, not of colour.**
- The percentages cover the judged (visible) wall only: outer-wall toolpath further than 0.35 mm from the model's outline is not judged. How much was judged and how much was not is in the judged/hidden table of `docs/built-in-colours-release-2.6.76.md`.

| File | Nominal | −0.03 mm | −0.02 mm | +0.02 mm | +0.03 mm |
|---|---|---|---|---|---|
| Reference plate | PASS (100%) | PASS | PASS | PASS | PASS |
| `backpack-cmyw` | PASS (99.99%) | PASS | PASS | **FAIL** | **FAIL** |
| `backpack-cmyk` | PASS (100.00%) | **FAIL** | **FAIL** | PASS | **FAIL** |

**At the nominal height, all three files pass.**

Some passes are marginal, close to the 95% per-layer limit:
- **`backpack-cmyw`, −0.03 and −0.02 mm:** worst layer 193 (23.36 mm) at 95.67%.
- **`backpack-cmyk`, +0.02 mm:** layer 193 at 95.45% and layer 170 (20.6 mm) at 95.71%.

The failures under a shift are listed below. Each one is beside a near-flat ledge in the model that lies within a few hundredths of a millimetre of the slicer's cut for that layer, so a small height error moves the ledge across the cut.

- **`backpack-cmyw`, +0.02 and +0.03 mm.** Layer 168 (20.36 mm, near the top) is at 88.9%: about **43 mm of a 384 mm wall** would print cyan where white is planned. The cause is up-facing near-flat faces at 20.21–20.31 mm. At +0.03 mm, layer 193 (23.36 mm) also drops to 93.2% (9 mm of 133 mm).
- **`backpack-cmyk`, −0.02 and −0.03 mm.** Layer 13 (1.76 mm, near the bottom) is at 12–13%: about **361–367 mm of a 416 mm wall**, almost the whole layer, would print the neighbouring layer's reel. The cause is a flat face at 1.701 mm, about 0.001 mm above that layer's cut. At these shifts the band would show as a stripe one layer high in the wrong reel.
- **`backpack-cmyk`, +0.03 mm.** Layer 193 (23.36 mm) is at 93.2% (9 mm of 133 mm). Layer 171 (20.72 mm) is at 94.2% (19 mm of 334 mm).

The same layer 13 face is in `backpack-cmyw`, where the saved checks give layer 13 at 98.34% (−0.02 mm) and 97.06% (−0.03 mm) instead of 12–13%. At nominal height the backpack files have 0.7% (`cmyw`) and 1.2% (`cmyk`) of the visible wall in mixed reels.

## What to look at and photograph

Photograph in daylight or under a neutral white light, with a white card in the frame, from about 30 cm and again close up.

1. **Reference plate, from the side.** Photograph each numbered cylinder. Does each one read as one colour from arm's length? Note which ones look striped. Compare cylinders 3 and 4 (cyan–yellow mixes), 5 and 8 (three or four reels), and 6 and 7 (mixes with white).
2. **Reference plate, from above.** The base and numbers should be white, and the cut edge at the top of each cylinder should show the white interior inside a thin coloured shell.
3. **Backpack, the steep sides.** Do beige and pink look like even colours or like stripes?
4. **Backpack, the flat and gently sloped areas** (top and ledges). Expect single-reel bands there. Photograph them.
5. **Backpack, near the top (about 20 mm) and the first 2 mm.** These are the layers that failed the shifted checks. Look for a stripe one layer high in a different reel.
6. **Either print, the prime tower and any colour bleed** at reel changes, and the tool-change marks on the wall.

Note the reel brands, the slicer version and any setting you changed.

## How the files were made

```
node tools/prepare-built-in-reference.mjs deliverables/built-in-colours-demo-2026-11
node --max-old-space-size=16000 tools/export-built-in.mjs "<owner's model>.3mf" deliverables/built-in-colours-demo-2026-11/backpack-cmyw.3mf --reels=cmyw "--objects=Backpack - Pink & White"
node --max-old-space-size=16000 tools/export-built-in.mjs "<owner's model>.3mf" deliverables/built-in-colours-demo-2026-11/backpack-cmyk.3mf --reels=cmyk "--objects=Backpack - Pink & White"
```

With no folder given, `prepare-built-in-reference.mjs` now writes to `deliverables/built-in-colours-reference-2026-11/`, as it did for release 2.6.76; it never writes to the demo folder unless that folder is named.

`export-built-in.mjs` also writes `<output>.plan.json`: each source colour, its recipe, the estimated shade and the error, all marked estimated. Its other options are `--plate`, `--backing` and `--layer-height`. `--layer-height` is an unchecked experiment: only 0.12 mm has been toolpath-checked, and the app always uses 0.12 mm.

The owner's model expands past the 3MF reader's total limit. The tool therefore reads only the mesh members of the chosen plate.
