# Full Spectrum 2.6.38 — release scope

4 November 2026. This extends the existing Workbench; model processing stays local. The complete research and proposed work are in [Full Spectrum next steps](full-spectrum-next-steps-2026-11-04.md).

## Available in this build

| Area | Behaviour |
| --- | --- |
| Real products | Bambu PLA Palette CMYW/CMYKW, distinct Snapmaker White and Gray editions, Polymaker Panchroma Translucent CMYG, and an explicitly backlit ELEGOO Rilievo set. Curated combinations are not labelled retail packs. |
| Your collection | Mark sets as owned, save custom combinations locally, import/export bounded JSON, substitute individual products and load reel identities from an exported project. |
| Comparison | Compare compatible sets using predicted colour error or fewer recipes, or restrict to owned sets. Keep the original preview and review changed colours before applying. These are unmeasured estimates, not measured rankings of brands or predicted hours. |
| Inputs and shades | U1 supports 1–4 physical inputs; Bambu 1–24; Prusa 1–16. Generated blends use logical entries after the physical reels. The current export ceiling remains 24 total entries for Bambu and 16 otherwise. PETG reserves one of U1's four inputs. |
| Native Bambu export | Printer/nozzle selection, native project settings and mixed-material arrays, explicit regular layer height, and independent mixed-region subdivision. H3C requires Bambu Studio 2.9.1 or later. Mixed nozzle sizes still belong in Bambu Studio. |
| Calibration | Vertical-wall coupons and separately labelled top-face coupons. Recorded wall samples require the same identified reels, printer and layer settings plus explicit confirmation. Top measurements cannot leak into wall predictions. One local profile at a time; download JSON to keep others. |
| Reproducibility | Exported product, catalogue and calibration revisions, recipes, mapping, layer choice and subdivision are recorded in a bounded JSON metadata entry. This is provenance, not full workspace/Undo restoration. Imported records never enable calibration automatically. |
| Existing editing | Convert/Full Spectrum retain their separate experiments. Printer context accompanies mode handoff. Existing split, remove, duplicate, undo, fill and prepared-plate regression tests remain in the suite. |

## Product evidence

- [Bambu's H3C announcement](https://forum.bambulab.com/t/bambu-lab-h3c-our-full-reveal/261955) describes five-colour CMYKW and distinguishes nine ready PrintTools from up to 24 spools through external AMS. [Bambu Studio 2.9.1](https://github.com/bambulab/BambuStudio/releases/tag/v02.09.01.70) adds PLA Palette. Catalogue display swatches remain nominal and no SKU is invented.
- [Snapmaker's bundle guide](https://www.snapmaker.com/blog/which-cmyk-filament-should-i-choose/) explains the different CMY formulations in its White and Gray editions. They are separate products even when a display swatch matches.
- [Polymaker Panchroma Translucent](https://shop.polymaker.com/products/translucent-pla) supplies the catalogue's display colours; these are not measured mixture colours.
- [ELEGOO PLA CMYK](https://eu.elegoo.com/products/pla-cmyk) is presented for lithophanes. Its reflected-light model performance is unverified and it is excluded from automatic model recommendations.

## Still open from the full roadmap

This release does not complete all optical research identified in the proposal. It retains the existing Prusa v7 predictor and adds product/context integrity around it. It does not implement ChromaMatter-style Core/Shell geometry, ordered inner/outer-wall construction, general top-surface interweave or image/depth-map top mixing, variable optical schedules, per-region importance beyond existing exact-colour controls, printer tool-path cost modelling, held-out calibration validation, or a multi-profile calibration library.

Those methods need a separately implemented geometry/toolpath route and controlled physical comparison before ordinary release. No iDither proprietary code or calibration data, or ChromaMatter code, is copied. No measured accuracy percentage, print-time saving, successful physical test, or missing-support fix is claimed. The new bundle predictions need measured wall/roof coupons using the actual packs, including the user's Bambu pack when it arrives.

## Validation

- 171 automated tests pass, including extended colour IDs, native exports, source paint/settings, support interfaces, selection/undo, splitting and prepared plates.
- New tests cover five physical reels, product/edition identity, capacity and recipe budgets, same-colour substitutions invalidating calibration, native Bambu material variants, 0.16 mm effective height, subdivision and metadata round-trip.
- The existing real-file pipeline passes on the 639,959-triangle Prusa pumpkin through Snapmaker, Bambu and Prusa output. The currently missing Desktop Grinch was not used for this release check.
- Browser checks exercise manufacturer set selection, comparison, H3C profile loading, 24-input selection, five loaded products, mode switching, and the export action with 0.16 mm layers. The app reports generating its Bambu project; automated archive readback verifies the corresponding native export contract. Embedded-frame blob download inspection is unavailable through the browser tool.
- Physical prints and current-slicer toolpath validation are not part of these software checks.
- The finish review passes at 1440 × 900, 760 × 781 and 390 × 844. Capacity, set selection and its action lead the Colours panel; preview comparison remains reachable and the mobile model clears its toolbar. A generic reviewer/documenter followed the Impeccable contracts because dedicated roles were unavailable. The existing design system is unchanged.
