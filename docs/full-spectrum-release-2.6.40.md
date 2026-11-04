# Full Spectrum 2.6.40 — filament packs and reversible comparisons

4 November 2026. This extends the existing Workbench Colours panel and native project exporters. It delivers the verified pack catalogue and the first comparison improvements from the [iDither feature review](idither-feature-review-2026-11-04.md); the optical research roadmap remains open.

## What changed

- **Three starting choices:** Model colours, My loaded reels, or A filament pack. The input count stays beside that choice; pack-specific controls appear only when needed.
- **The exact Bambu PLA Palette CMYKW pack:** five products with stable identities, official display swatches, product links and optical classes. The full retail pack is separate from the curated CMYK and CMYW subsets. The Key reel is labelled translucent; CMYW are opaque.
- **Choose the reels to include:** untick a reel, preview the remaining set, or restore every reel. A five-reel pack can compare all five four-reel subsets. With U1 PETG support reserved, it can compare all ten three-model-reel subsets. Every result names its omitted reels. PETG never enters a model-colour blend recipe.
- **Compare before applying:** pack previews leave applied reels unchanged. Original, Applied and Suggested remain available in the same canvas. The initial result list shows a few choices, with more behind More palettes. Cards show up to three changed colours and direct users to the full comparison.
- **Important colours:** optionally give a source colour extra ranking weight so a small accent need not be dominated by a large surface. This weights every region painted that colour. It is not a brush or a selected-region tool, and it does not guarantee an exact match.
- **Loaded-reel continuity:** a valid smaller pack suggestion can be applied even when the previously loaded setup exceeds the printer's capacity. Slot arrangement remains available for pack comparisons entered from the loaded-reel route. Applying a result keeps it applied instead of restarting the same pack comparison.

Compatible-pack comparisons retain the existing colour, recipe-count and owned-filament priorities. A recipe count is not a prediction of print duration. Large combinatorial selections require the user to choose fewer reels instead of silently presenting a truncated exhaustive search.

## Product sources and prediction limits

The [Bambu retail product](https://uk.store.bambulab.com/products/pla-palette-cmykw) identifies the five-reel pack and opaque/translucent distinction. Its [official swatch PDF](https://store.bblcdn.com/s7/default/8a89cc11c9ce4421a9593f9ee9580982/Bambu_PLA_Palette_Hex_Code.pdf) gives Cyan `#0090DA`, Magenta `#E24585`, Yellow `#FCE300`, Key `#000000` and White `#FFFFFF`.

These are display colours, not measured mixture behaviour. The interface keeps unmeasured predictions explicit; this release does not establish that one manufacturer's pack prints more accurately than another. Backlit-only catalogue sets are excluded from automatic model-pack comparisons. Existing native blend recipes and subdivision controls are unchanged.

## Validation

- 177 automated tests passed, including five new bundle/priority regression tests. Coverage includes all small-pack subsets, product identity, reversible draft selection, PETG exclusion, bounded search handling and a controlled small-accent ranking change.
- The supplied Grinch variant (40,056 triangles, five source colours) passed the existing real-file export checks for Snapmaker, Bambu and Prusa archives.
- Browser checks verified unchanged applied reel values after previewing another pack, two duplicated objects retained after a pack comparison, an available Apply action when moving from an oversized loaded setup, and PETG's three-model-input route.
- Desktop 1280 × 720 and mobile 390 × 844 inspected, including pack controls and comparison results. No browser errors were reported in the checked session.
- A fresh visual reviewer returned **ship** for the extension across all four desktop/mobile captures. The specialist review role was unavailable, so a separate general agent followed the same read-only review contract.
- A separate documentation pass confirmed that the existing design system still matches the built controls; its files were preserved. Their historical test-version labels remain recorded drift, while this release note and the dated surface contract state the current release scope.

This is software and archive validation. Current-slicer toolpath comparisons, measured physical colour tests, and support/subdivision print tests have not been completed for these pack predictions.

## Remaining work

The regional focus brush, measured wall/roof calibration, reversible colour simplification, ordered optical walls, top-surface interweave, and variable optical-layer construction remain separate work. They are not implemented by the new pack controls or source-colour priorities. Use the exact Bambu pack when it arrives to establish a repeatable printed baseline before claiming colour-quality improvements.
