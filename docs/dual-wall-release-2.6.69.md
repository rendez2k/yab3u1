# Workbench 2.6.69 — dual-wall mixing for real models

Until now dual-wall existed only as a generated comparison plate with explicit inner and outer ring geometry. This release makes it an export option for any painted model in Full Spectrum blends, using the slicer's own paint-depth setting instead of new geometry.

## What the export does

After the normal Full Spectrum export has been built, `web/shared/dualWall.js` rewrites the finished project:

1. Every face of every solid part that has no paint, or has a split facet with an unpainted child, is given explicit paint in the part's own filament. Without this, such faces would show the inner filament on the surface.
2. Every solid part, and its object, is moved onto the chosen inner filament. Modifiers and negative volumes keep their filament and role.
3. `mmu_segmented_region_max_width` is set to the chosen depth (0.3 to 1.2 mm, default 0.45) and `mmu_segmented_region_interlocking_depth` to 0, both recorded as changed from the system preset.
4. A project or object set to a single wall is raised to two, since one wall has no inside.
5. `Metadata/YAB3D_dual_wall.json` records the inner slot and colour, depth, counts of parts and faces changed, and `validation: {sliced: false, printed: false}`.

No vertex, triangle order, support paint or seam paint is changed. Running the rewrite twice changes nothing further.

## Using it

Open a model, choose Full Spectrum blends in Colours, apply a palette, then open Settings and tick Dual-wall mixing. Pick the inner wall filament and the outer colour depth. The inner filament must be one of the loaded reels; add one in Colours if the one you want (white, for example) is not listed.

## What to check when you slice it

These are the points this release could not verify:

1. **Wall colours.** In the slicer's preview, coloured by filament, the outermost wall should follow the model's colours and the walls behind it should all be the inner filament.
2. **Top and bottom surfaces.** Paint depth is defined for walls. Check whether top and bottom skins keep the model's colours through their full thickness or switch to the inner filament after the first layers.
3. **Blended colours.** A region painted with a mixed (virtual) filament should still alternate its two reels in the outer wall only.
4. **Thin features.** Fingers, stalks and text narrower than about twice the depth may be mostly outer colour; that is expected.
5. **Prime tower and time.** Almost every layer now uses the inner filament as well, so expect more tool changes than the same model without the option.
6. **Depth.** If the outer wall shows inner filament in places, raise the depth slightly above the outer wall line width; if colour reaches the second wall, lower it.

A useful first print is one small object exported twice, with and without the option, on the same reels.

## Validation

- 5 new tests: explicit paint for unpainted and split faces; parts and object moved to the inner filament; modifiers left alone; single-wall overrides raised; project settings and manifest; idempotence; refusals before anything is written; and the real exporter followed by the rewrite and a fresh read, with no unpainted face remaining.
- 112 Workbench tests and 166 web tests pass. `web/tests/real_file.test.mjs` fails as before this work.
- Headless Chromium, built-in sample: the option appears in Full Spectrum's Settings, lists the loaded reels, shows what will happen, blocks export on an out-of-range depth, and the downloaded U1 project contained 1,408 faces all carrying paint, the depth setting, and its part on the inner slot.

## Not done

- No slice and no print. The behaviour of `mmu_segmented_region_max_width` in Snapmaker Orca with Full Spectrum mixed filaments is assumed from its documented meaning, not observed.
- One inner filament for the whole export. iDither chooses wall pairs per colour; doing that here would need generated shell geometry.
- The 3D preview and the predicted colours do not simulate the inner wall.
- Not applied to sequential plate preparation or multi-plate saves, and not offered in Solid colours or for PrusaSlicer.
- The blend planner still uses 25/50/75% two-reel recipes; widening that is separate work.
