# Full Spectrum 2.6.41 — prioritise important model details

4 November 2026. This continues the Full Spectrum roadmap after the filament-pack and comparison controls in 2.6.40. It extends the existing Colours inspector and is authorised for main and the full release.

## What changed

- **Mark details on the model:** open Full Spectrum → Colours → Important details & colours. Brush over a face, lettering or another small detail to give its original colours more weight when comparing palettes.
- **Reversible controls:** Add, Erase, Orbit, brush size, Undo mark, Clear marks and Done & compare palettes. Ctrl/Cmd+Z undoes a brush stroke while marking; Escape finishes marking. Alt-drag also orbits. Object deletion and duplication shortcuts are suspended while marking.
- **Visible surfaces only:** a depth-tested surface pass keeps marks on the frontmost model surface. The green overlay is separate from the model's paint and export geometry.
- **Copies share priorities:** marks follow a source part through duplication and arrangement without multiplying its ranking weight. Changed or removed source surfaces do not receive stale marks. Undo snapshots retain the marks, while opening a new model clears them.
- **Compare before applying:** finishing a mark updates suggestions. Applied reels stay unchanged until a result is explicitly applied. Whole-colour priorities remain available below the brush controls.
- **Compact marking mode:** mobile keeps the model and brush controls visible, temporarily hiding the general object tools and longer explanatory text. The normal inspector returns when marking ends.

## What the priority means

This is a palette-ranking aid, not local repainting or an optical colour simulation. The marked surface supplies an area-weighted histogram of original colours; the same source colour elsewhere in the model can also change when the selected palette changes. Preview facet boundaries are approximate. Marks are session settings and are not embedded in the downloaded 3MF.

The brush does not establish measured filament-mixture behaviour or guarantee an exact colour match. PETG exclusion, native blend recipes, subdivision controls and existing project exporters remain in place.

## Validation

- **181 automated tests passed.** New coverage checks brush coordinates and visible-surface IDs, duplicate-source weighting, stale-source exclusion, small-detail ranking changes and restoration after clearing. Worker checks cover stable source references through copies, palette changes, object removal and undo reloads.
- **Real-file export checks passed** for the supplied Grinch variant: 40,056 triangles and five source colours, preserved in Snapmaker, Bambu and Prusa archives.
- **Browser checks:** marking the Grinch's tiny yellow eye moved a palette retaining yellow above the previous suggestion; undo restored the original ranking. Previewing this alternative left the applied reel values unchanged. Two copies shared their marks, erasing and undo worked on both, and rotating to the back showed no marks through the head.
- **Keyboard and responsive checks:** changing brush size, marking and then Ctrl+Z worked; desktop 1280 × 800 and mobile 390 × 844 were inspected. No browser errors were reported in the checked session. The production build and whitespace checks passed.
- **Fresh finish review: ship.** No material fixes were required. A separate general agent applied the specialist's read-only finish-reviewer contract because the specialist role was unavailable.
- **Fresh documentation pass: no changes.** A separate general agent applied the documenter contract and confirmed that the incumbent design system fits this extension. DESIGN.md and its sidecar were preserved; their historical test-release labels remain recorded drift, superseded for release scope by the dated surface contract.

Review evidence is saved locally under `.impeccable/review/focus-2.6.41-*`; no private model files or review screenshots are included in the published application. This is software, browser and archive validation, not physical-print or current-slicer toolpath validation.

## Remaining work

Measured wall/roof calibration, reversible colour simplification, ordered optical walls, top-surface interweave and variable optical-layer construction remain separate roadmap items. The exact Bambu pack can provide a repeatable printed baseline when it arrives; display swatches alone are insufficient to claim improved printed colour accuracy.
