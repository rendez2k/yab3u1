# Editable native blends — 2.6.45

Full Spectrum now has **Create or edit a blend** beside the filament choices. Choose a painted model colour, select physical filaments and set whole-number shares. Two-filament shares complement one another; three-filament recipes require a total of 100%. Apply changes only that source colour's mapping. Use suggestion removes its override, and Undo blend restores the previous recipe. The shared Workbench Undo action includes these edits.

Manual recipes follow the existing native slicer export path. They reuse physical slots, compact unused virtual colours and retain provenance. Ingredients must be distinct, have matching materials and exclude reserved support filament. Unsupported combinations block export with an explanation.

| Output | Two filaments | Three filaments | Height gradient |
| --- | --- | --- | --- |
| Snapmaker Orca | Yes, existing dialect | No | No |
| Bambu Studio | Yes | Yes | No |
| OrcaSlicer 2.5 RC | Yes | Yes | Yes, two filaments |
| PrusaSlicer | Yes, existing format | No | No |

Orca gradients have bottom/top shares, reverse direction, linear or smooth transition, and a restart-per-part setting. Shares are constrained to 10–90%. Applying a gradient enables Mixed Colour Sublayer; disabling that option blocks gradient export. The swatch shows the estimated transition. The model view currently shows its midpoint shade, explicitly labelled; inspect the vertical result in OrcaSlicer. Portable Orca projects require choosing the intended printer in the slicer.

These are unmeasured estimates for the selected reels. The feature does not establish optical colour accuracy, calibrate ELEGOO filament or claim that the user's repeat print has succeeded. That print has completed but has not yet been inspected. The separate 2.6.44 wall-comparison files are unchanged.

## Format evidence

The native schema and gradient interpretation were checked against official [OrcaSlicer 2.5.0 RC](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.0-rc), commit `af2ffb8cddd2f3c0bdadc56d9cc3945fb23577ea`, including `PrintConfig.cpp`, `FilamentMixer.cpp` and `MixedFilamentDialog.cpp`. The upstream implementation is [PR 15347](https://github.com/OrcaSlicer/OrcaSlicer/pull/15347).

The export writes one-based component references, explicit sublayer ratios, gradient range, per-part flag and curve. Smooth transitions use Hermite endpoint slopes of zero; linear transitions use the range without a custom curve. Snapmaker's two-component JSON dialect remains unchanged.

## Verification

- 194 automated tests pass. Coverage includes manual mapping, deduplication, virtual-slot compaction, capacity limits, invalid shares, material/support exclusions, format guards, native arrays, gradient metadata, export provenance and legacy Snapmaker behaviour.
- The official portable OrcaSlicer 2.5.0 RC executable sliced synthetic 10 × 10 × 12 mm cubes for a 37/63 pair, a 35/25/40 triple and a smooth 90/10 → 10/90 gradient. All three exited successfully and produced G-code. The test harness supplied a known printer/process to the portable projects; those machine settings are not included in YAB3D's portable Orca exports. No print was started.
- After excluding custom moves and the prime tower, regular model toolpaths reproduce 37/63 and 35/25/40 extrusion shares. At 0.10 mm regular height, the corresponding sublayers are 0.037/0.063 mm and 0.035/0.025/0.040 mm. Gradient sublayers change from 0.0899957/0.0100043 mm near the bottom to 0.010207/0.089793 mm near the top. This validates export interpretation, not the physical reliability or colour quality of these very thin sublayers.
- Browser checks cover two- and three-filament Apply/Undo, gradient settings and the original painted Grinch fixture. Desktop and 390 px mobile layouts were inspected. A user's local model was used only for local preview and is excluded from the release.

## Design finish

The extension retains the existing Plex typography, neutral studio surfaces and green controls. The detector's remaining warnings concern pre-existing standalone-page styles, stale design-document tokens and a fallback swatch border. No new raster assets ship.

Fresh general-purpose agents used the fallback Impeccable finish-reviewer and documenter contracts because the named roles were unavailable. The reviewer found one mobile specificity issue: existing inspector styles overrode the intended 44 px fields. A scoped correction was rebuilt and recaptured at both widths; measured inputs, selects and actions are 44 px on mobile. The verdict pass scored that fix resolved, with disposition **ship** at that scope. The documenter returned **No changes** to the design-system files and recorded the pre-existing documentation drift without repairing it.
