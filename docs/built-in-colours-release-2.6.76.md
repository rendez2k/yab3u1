# Workbench 2.6.76 — Built-in colours (experimental)

## Read this first

- **Experimental. Never printed.** Every file behind this release was sliced with the Snapmaker Orca command line and toolpath-checked. Nothing was printed, and nothing was sent to a printer.
- **A toolpath check is not a colour check.** It shows which reel the slicer puts on each part of the outer wall. It says nothing about the colour a print will have.
- **Every shade is an estimate** built from the reels' nominal catalogue colours. No shade has been measured.
- **Snapmaker U1 only, 0.4 mm nozzle only, browser only.** The Python route is unchanged. **Slicer blends remains the default.**
- **The layer heights are fixed: 0.12 mm layers and a 0.2 mm first layer.** Changing the layer height, the first layer, adaptive layers or variable layer height in the slicer puts the wrong reel on each layer.

## What it is

Full Spectrum blends has a second colour construction, in Export settings: **Built-in colours (experimental)**. Instead of leaving the mixing to the slicer, each colour is written into the model as a repeating layer-by-layer sequence of your model reels (three when the PETG support slot is reserved).

- The sequence is painted into a **0.45 mm outer shell**. Inside the shell the model prints in one **backing reel**, the lightest model reel unless you choose another.
- On steep walls the layers of different reels sit on top of each other and are meant to mix by eye.
- **Flat and gently sloped areas print as single-reel bands**, often clearly striped. The preview shows those areas in the single reel they will get and warns when a model has much of them.
- The export records what it did in `Metadata/YAB3D_built_in_colours.json`, with every recipe marked as an estimate and `validation: {sliced: false, printed: false}`. That record is what the exporter writes into each file; this release's proof run does not update it.

## Known limits

**Ledges.** Beside near-flat ledges, a single layer's wall can take the neighbouring layer's reel. The slicer decides which layer a near-flat face belongs to by where it falls against its own slice heights, and a face within a few hundredths of a millimetre of a cut can land on either side. To see how close each file is to that edge, the toolpath check was also run with the model shifted in height by −0.03, −0.02, +0.02 and +0.03 mm. In earlier runs some models passed at the nominal height and failed under a 0.02–0.03 mm shift (the table below gives today's results and those runs).

**Size.** Cutting the model into layer strips multiplies its triangles. Large models can be refused as too large at 0.12 mm. *They Live Alien 5 Colors* (1,333,448 triangles) is refused:

> This model would need 5,723,752 triangles at 0.12 mm layers, which is too large to export. Choose a thicker layer height.

That was the wording at the time of the proof run. The mode has no layer-height choice, so the wording has since changed to: "This model would need 5,723,752 triangles at 0.12 mm layers, which is too large for built-in colours. Export fewer objects at a time, or use Slicer blends."

The mode always uses 0.12 mm, so that model cannot be exported with built-in colours in this release.

**Refusals.** The export stops with a plain message, and writes nothing, for:
- a raft (it lifts every layer of the model);
- one mesh placed more than once at different tilts or heights;
- colour, support and seam paint that divide one face in different ways;
- any nozzle other than 0.4 mm, or a project whose nozzle size cannot be read;
- any target other than the Snapmaker U1;
- height ranges that change the layer height, and nozzle profiles whose limits exclude 0.12 mm or 0.2 mm;
- model reels of different materials. Every model reel (every reel not reserved as the PETG support reel) must be the same material; the refusal names the reel to remove or change.

A file exported with built-in colours cannot be reopened for conversion: its paint is already a layer pattern, so it is refused with a message asking for the original model.

**Dual-wall mixing** and **Print comparison** are not available while Built-in colours is on.

## Proof run for this release

The reference plate was regenerated with the release code by `tools/prepare-built-in-reference.mjs`. Three owner figurines were exported with `tools/export-built-in.mjs … --reels=cmyw`: ELEGOO Rilievo cyan, magenta, yellow and white in slots 1–4, backing white. That command-line tool calls the same engine as the app (`exportProject` with built-in colours, then `applyBuiltInColours`); the files were not exported from the app's page. Each file was sliced with the Snapmaker Orca command line and checked with `tools/check-built-in-toolpaths.mjs <gcode> --model <3mf>` at the nominal height and the four shifts.

A run passes when at least 99% of the judged wall is in the reel the model gives it, no layer with over 20 mm judged is below 95%, at least 90% of the outline is covered, and the outline guard holds. These marks were set for this work; they are not a standard.

| File | Export | Open edges and parts against the source | Nominal | −0.03 mm | −0.02 mm | +0.02 mm | +0.03 mm |
|---|---|---|---|---|---|---|---|
| Reference plate (8 samples) | 7,224 → 617,176 triangles | every object manifold | PASS, 100% | PASS, 100% | PASS, 100% | PASS, 100% | PASS, 100% |
| Super Man, plate 1 | 327,952 → 1,284,792 triangles | 26 parts, manifold (source 26, manifold) | PASS, 99.56% (worst layer 53, 98.20%) | PASS, 99.45% (layer 9, 96.42%) | PASS, 99.49% (layer 86, 97.31%) | PASS, 99.58% (layer 83, 98.00%) | PASS, 99.56% (layer 90, 97.64%) |
| Flirty Figures Alien | 608,046 → 3,282,824 triangles | 3 parts, manifold (source 3, manifold) | PASS, 100.00% (no layer below 100%) | PASS, 99.97% (layer 433, 96.95%) | PASS, 99.99% (layer 413, 97.96%) | PASS, 99.99% (layer 227, 98.15%) | PASS, 99.98% (layer 84, 97.35%) |
| They Live Alien 5 Colors | **refused** as too large (above) | – | – | – | – | – | – |

**Not all of the outer wall is judged.** The percentages above are shares of the *judged* (visible) wall only. Outer-wall toolpath further than 0.35 mm from the model's outline is counted as hidden and is not judged; it includes the inside edge of the colour shell and walls along internal part boundaries. What that hidden wall is was characterised on the generated test solid and only partly on the figurines (see `docs/built-in-colours-spike-2026-11.md`, "Hidden and dropped wall"). At the nominal height:

| File | Judged (visible) outer wall | Hidden (not judged) outer wall |
|---|---|---|
| Reference plate | 81,506 mm | 0 mm |
| Super Man, plate 1 | 28,745 mm | 29,692 mm |
| Flirty Figures Alien | 257,376 mm | 113,827 mm |

Under the four shifts the figures move by under 1%: Super Man 28,419–28,801 mm judged against 29,635–30,018 mm hidden, Flirty 256,816–257,277 mm judged against 113,926–114,387 mm hidden; the reference plate stays at 81,506 mm and 0 mm.

**Layers with 20 mm or less of judged wall are left out of the per-layer rule.** In these runs:
- Super Man: layer 122 (8.2–8.3 mm judged) is at 96.30% at the nominal height and 95.45% at −0.03 and −0.02 mm; layer 121 is at 98.83–98.85% at +0.02 and +0.03 mm. None is below 95%.
- Flirty: at +0.03 mm, layer 876 is at **47.05%, with 0.3 mm judged**. No other such layer is below 95%; at the other heights the worst is 100%.
- Reference plate: no such layers.

**These results differ from earlier runs, and both are given here.** In the earlier product-path run (same engine, same reels and 0.45 mm shell, 11 November 2026), Super Man plate 1 passed at the nominal height but **failed at −0.03 mm (layer 102 at 93.48%) and −0.02 mm (layer 102 at 93.85%)**. Today it passes at every height, with layer 102 at 100%. The colours and shades are the same in both runs, but each colour's sequence starts at a different layer: the earlier run aligned the sequences without weights, and the command-line tool weights them by painted triangles (the app weights them by surface area and any focus marks). That phasing is the only difference identified between the two runs. Which colour region the earlier failing layer 102 belonged to was not examined, so it is not established how the phasing changed that layer's result. **Do not read today's pass as Super Man being safe from the ledge effect**, and an export from the app may plan differently again. Flirty passed at every height then and now. The demo backpacks prepared for the owner earlier are not re-run here: `backpack-cmyw` failed at +0.02 and +0.03 mm (layer 168 at 88.9%) and `backpack-cmyk` at −0.03, −0.02 and +0.03 mm (layer 13 at 12–13% under the downward shifts).

## Cost

All times are the slicer's own **estimates**. Tool changes are counted from the G-code. Tower grams are the net extrusion of the moves typed "Prime tower" in the G-code, so they are approximate.

| File | Layers | Tool changes | Estimated time | Filament (estimate) | Prime tower (approx.) |
|---|---|---|---|---|---|
| Reference plate | 104 | 227 | 2 h 3 m | 19.8 g | 13.2 g (67%) |
| Super Man, plate 1 | 124 | 320 | 3 h 51 m | 30.1 g | 22.1 g (74%) |
| Flirty Figures Alien | 878 | 1,529 | 22 h 54 m | 192.2 g | 136.2 g (71%) |
| Demo `backpack-cmyw` (earlier run) | 199 | 134 | 3 h 6 m | 32.6 g | 15.4 g (47%) |
| Demo `backpack-cmyk` (earlier run) | 199 | 279 | 4 h 21 m | 40.6 g | 21.2 g (52%) |

**The prime tower takes 47–74% of the filament in these files. Tower waste has not been reduced in this release.**

## Dual-wall mixing: a fix for existing users

Separately from built-in colours, this release fixes dual-wall mixing ignoring the source model's own colour-depth settings.

- **What was wrong.** The exporter carries a source project's `mmu_segmented_region_max_width` and `mmu_segmented_region_interlocking_depth` onto every object. A per-object value overrides the project's, so the outer colour depth chosen for dual-wall mixing was silently replaced on models that carried one: for example 5 mm, or 0, which the slicer reads as unlimited.
- **What changed.** Dual-wall mixing now writes the chosen depth into every object- and part-level `mmu_segmented_region_max_width` as well, and sets every `mmu_segmented_region_interlocking_depth` to 0. `Metadata/YAB3D_dual_wall.json` gains `overridesReplaced`, the number of values changed, when there were any.
- **Who is affected.** Only models whose source set those values. A dual-wall export of such a model now has the colour depth you chose. For a model without those values nothing changes: the existing dual-wall characterisation test, whose fixture has none, still gives the same bytes. Re-export older dual-wall files of such models to get the fix.

## Not in this release

- Full texture colour and the number of shades (step 1b of the plan).
- A separate wall pair per colour.
- Calibration from printed samples. Every shade stays an estimate until samples are printed and measured.
- Mixing on top surfaces.
- Bambu targets.
- Any other nozzle than 0.4 mm, and any layer height other than 0.12 mm.
- Print comparison while Built-in colours is on.
- Model reels of different materials: every model reel must be the same material.
- Any change to the Python route.

## For the owner's first print

The reference plate is in `deliverables/built-in-colours-reference-2026-11/` (not in git). It is the same plate as in the demo folder, rebuilt with the release code: every member is byte-for-byte the same apart from the random identifiers (`p:UUID`) that every export writes into the main model. Its toolpath checks give the same results as the demo copy's. How to load, slice, print and photograph it is in `docs/built-in-colours-print-guide.md`. The mode stays experimental, and its record keeps `printed: false`, until that print is reported.

## Checks

- `node --test web/tests/`: 308 tests, 307 pass. The one failure is `web/tests/real_file.test.mjs`, a script that needs a model path; base commit d884921's copy fails in the same way.
- `node parity_check.mjs` could not run: it needs `Flippin Pumpkin painted (original PrusaSlicer XL 5T).3mf` in the repository root, which is not present.
- Python, `python -m unittest discover -s tests -t . -v`: 176 tests, 4 failures, 12 skipped. All four failures are in `tests/test_site_build.py`, whose list of published files is out of date. They fail the same way at base commit d884921; this release adds seven more files to the difference (the built-in colours modules).
- Workbench tests (`node --test experiments/workbench/`): 96 tests, 88 pass. The eight failing files need the `linkedom` development package, which is not installed; the same eight fail at base commit d884921.
