# Built-in colours: print guide (experimental)

Prepared 11 November 2026 for the Snapmaker U1 with a 0.4 mm nozzle.

**Read this first.** Built-in colours is an **experimental mode that has never been printed**. The files described here have been sliced with the Snapmaker Orca command line and toolpath-checked. Nobody has printed them yet.

- Every shade in this guide is an **estimate**. It comes from the existing two-reel colour predictor, extended to more reels. It is not a measurement.
- Slicer print times and filament weights are also **estimates**.
- A toolpath check shows which reel the slicer puts where. It is **not** a check of the printed colour.
- Nothing has been validated or proven.

The files are in `deliverables/built-in-colours-demo-2026-11/`. That folder is not in git. `READ-ME-FIRST.txt` in the folder repeats the essentials.

## What the mode does

Each source colour becomes a **recipe**: a repeating layer-by-layer sequence of the four reels.

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

### Plan, `backpack-cmyw.3mf` (C M Y W = reels 1 2 3 4)

| Source colour | Recipe (reel per layer, repeating) | Estimated shade | Estimated error (ΔE2000) |
|---|---|---|---|
| `#D3B7A7` beige | `4344244414434424443444244434414442443444` (40 layers) | `#D9BEAE` | 2.5 |
| `#FFFFFF` white | `4` (white only) | `#FFFFFF` | 0 |
| `#E8AFCF` pink | `442443444244` (12 layers) | `#EEAAD0` | 2.3 |

With these reels, all three colours have small estimated errors.

### Plan, `backpack-cmyk.3mf` (C M Y K = reels 1 2 3 4)

| Source colour | Recipe | Estimated shade | Estimated error (ΔE2000) |
|---|---|---|---|
| `#D3B7A7` beige | `321323` | `#A37343` (brown) | **27.9** |
| `#FFFFFF` white | `11211311` | `#00CBD3` (cyan) | **48.5** |
| `#E8AFCF` pink | `123` | `#737373` (grey) | **31.5** |

**This reel set cannot reach any of the backpack's three colours.** Without a white reel there is no way to lighten them:
- the white prints cyan;
- the pink prints grey;
- the beige prints brown.

Print this file only to see how a CMYK set behaves on light colours. It is not a faithful version of the backpack.

### The whole model's twelve colours

These are the estimates for all twelve filament colours in the owner's model, from the same planner (`node tools/export-built-in.mjs` plans only the colours of the chosen objects). The worst ones are in bold.

| Source | `cmyw` shade, error | `cmyk` shade, error |
|---|---|---|
| `#D3B7A7` | `#D9BEAE`, 2.5 | `#A37343`, **27.9** |
| `#FFFFFF` | `#FFFFFF`, 0 | `#00CBD3`, **48.5** |
| `#DE4343` | `#E84F52`, 4.0 | `#CF4A3E`, 3.2 |
| `#000000` | `#737373`, **48.4** | `#000000`, 0 |
| `#042F56` navy | `#646596`, **26.4** | `#152C4B`, 2.8 |
| `#F99963` | `#E69C78`, 4.7 | `#ED831A`, 10.8 |
| `#C2E189` | `#B7D773`, 4.3 | `#A6CC00`, 15.6 |
| `#68724D` | `#7B7D5F`, 6.0 | `#637753`, 3.4 |
| `#F7D959` | `#EDD056`, 3.3 | `#F6CF00`, 6.0 |
| `#A3D8E1` | `#9FD5DC`, 1.5 | `#00CBD3`, 16.1 |
| `#E5B03D` | `#E6AB2A`, 2.1 | `#F2B100`, 4.5 |
| `#E8AFCF` | `#EEAAD0`, 2.3 | `#737373`, **31.5** |

What each set cannot reach:
- **`cmyw`** cannot reach **black** (estimated as a mid grey, 48.4) or **navy** (26.4).
- **`cmyk`** cannot reach **white** (48.5), **pink** (31.5) or **beige** (27.9), and is poor on the light blue (16.1) and the light green (15.6).

## The reference plate: `reference-plate-cmyw-0.12.3mf`

The plate has eight numbered hollow cylinders, each 10 mm across and 12 mm tall with a 1.2 mm wall and an open top.
- Each cylinder stands on a white base (0.56 mm thick) with a raised number.
- The outer 0.45 mm of each wall carries the sample's sequence. The rest of the wall is white.
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

The reel colours are the catalogue's nominal display colours (`#00FFFF`, `#FF00FF`, `#FFFF00`, `#FFFFFF`), not measured ones. That is why the estimates look so saturated. The printed samples will show the real colours. That is what the plate is for.

## Toolpath checks

`tools/check-built-in-toolpaths.mjs --model` compares the slicer's outer-wall moves with the reel painted next to them, layer by layer.
- A run passes when at least 99% of the judged wall is in the right reel, no layer with over 20 mm judged is below 95%, at least 90% of the outline is covered, and the outline guard holds.
- The check was run at the nominal height and with the model shifted in z by −0.03, −0.02, +0.02 and +0.03 mm. The shifts show how sensitive each file is to a small height error.
- **These are checks of where the slicer puts each reel, not of colour.**

| File | Nominal | −0.03 mm | −0.02 mm | +0.02 mm | +0.03 mm |
|---|---|---|---|---|---|
| Reference plate | PASS (100%) | PASS | PASS | PASS | PASS |
| `backpack-cmyw` | PASS (99.99%) | PASS | PASS | **FAIL** | **FAIL** |
| `backpack-cmyk` | PASS (100.00%) | **FAIL** | **FAIL** | PASS | **FAIL** |

**At the nominal height, all three files pass.**

The failures under a shift are listed below. Each one is beside a near-flat ledge in the model that lies within a few hundredths of a millimetre of the slicer's cut for that layer, so a small height error moves the ledge across the cut.

- **`backpack-cmyw`, +0.02 and +0.03 mm.** Layer 168 (20.36 mm, near the top) is at 88.9%: about **43 mm of a 384 mm wall** prints cyan where white is planned. The cause is up-facing near-flat faces at 20.21–20.31 mm. At +0.03 mm, layer 193 (23.36 mm) also drops to 93.2% (9 mm of 133 mm).
- **`backpack-cmyk`, −0.02 and −0.03 mm.** Layer 13 (1.76 mm, near the bottom) is at 12–13%: about **361–367 mm of a 416 mm wall**, almost the whole layer, prints the neighbouring layer's reel. The cause is a flat face at 1.701 mm, about 0.001 mm above that layer's cut. At these shifts the band would show as a stripe one layer high in the wrong reel.
- **`backpack-cmyk`, +0.03 mm.** Layer 193 (23.36 mm) is at 93.2% (9 mm of 133 mm). Layer 171 (20.72 mm) is at 94.2% (19 mm of 334 mm).

The same layer 13 face exists in `backpack-cmyw`, but there the two layers involved use mostly the same reel, so the shift does almost no harm. At nominal height the backpack files have 0.7% (`cmyw`) and 1.2% (`cmyk`) of the visible wall in mixed reels.

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
node tools/prepare-built-in-reference.mjs
node --max-old-space-size=16000 tools/export-built-in.mjs "<owner's model>.3mf" deliverables/built-in-colours-demo-2026-11/backpack-cmyw.3mf --reels=cmyw "--objects=Backpack - Pink & White"
node --max-old-space-size=16000 tools/export-built-in.mjs "<owner's model>.3mf" deliverables/built-in-colours-demo-2026-11/backpack-cmyk.3mf --reels=cmyk "--objects=Backpack - Pink & White"
```

`export-built-in.mjs` also writes `<output>.plan.json`: each source colour, its recipe, the estimated shade and the error, all marked estimated. Its other options are `--plate`, `--backing` and `--layer-height`.

The owner's model expands past the 3MF reader's total limit. The tool therefore reads only the mesh members of the chosen plate.
