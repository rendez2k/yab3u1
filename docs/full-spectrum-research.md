# Full Spectrum research and review rebuild

2026-09-24 · review 2.6.0-preview.2

## Findings

The previous predictor was the FilamentMixer polynomial, trained to approximate
Mixbox pigment mixing. Its coefficients were copied correctly, but that is a
different process from viewing alternating filament layers. It predicted a
blue-grey for neutral black and white. A safety filter hid that prediction, but
did not improve the predictor.

[Prusa's technical article](https://blog.prusa3d.com/our-new-open-source-colormix-model-in-prusaslicer-and-easyprint_136079/)
explains the optical mixing distinction and why arbitrarily fine blend ratios
can create long repeating layer blocks and visible stripes. Its implementation
starts with Yule–Nielsen mixing and applies corrections fitted to measured FDM
prints. We retained the short two-reel 25/50/75% recipes supported by our writers.

[Prusa FDM Mixer](https://github.com/prusa3d/prusa-fdm-mixer) is MIT-licensed.
We vendored the v7 runtime and colour helpers at revision
`7dad18f9a08cdfce29fa86d561f08d14f4968205`, removing only TypeScript types.
The wrapper preserves identical-colour inputs and validates hexes and ratios.
Full copyright and licence text accompany the files and third-party notices.

Using the repository's 78 held-out two-colour samples, comparing rounded hex
predictions against the supplied measured Lab values with YAB3D's CIE94 metric:

| Predictor | Median error | Mean error |
| --- | ---: | ---: |
| Previous pigment polynomial | 7.79 | 9.51 |
| Prusa FDM v7 | 6.03 | 7.75 |

These are our reproducible comparisons on upstream data, not the upstream
CIEDE2000 statistics and not a physical test on a Snapmaker U1. This calibration
is based on Prusament PLA; different brands, materials and settings may differ.

## Search and output changes

The former greedy search selected individual reels and improved one slot at a
time. The replacement enumerates combinations of the free slots, respecting
locked physical positions and material groups. Each set is evaluated together
with all six pairs and the supported ratios. Large stock libraries retain up
to 32 candidates using source proximity plus colour-space diversity; locked
reels are added if needed. This is exhaustive within that retained pool, not a
claim of global optimality across all available products.

Every offered blend-mode set must have an exact/near-identical physical match
(CIE94 <= 0.5) or an enabled blend with predicted error <= 12 and improvement
of at least 2 over the nearest reel. Those existing acceptance thresholds were
not loosened to make the alien pass. The six-recipe export planning cap still
applies. Source colours are equally weighted; small regions cannot be sacrificed
to improve a large region's score. Final candidates are checked again by the
same planner used for export. Explicit Solid colours mode remains a separate
replacement workflow.

No qualifying set means no suggested palette cards or Apply button. The page
explains that the search found no solution and suggests changing constraints or
using the owned-filament library. A failed bounded search does not establish
physical impossibility.

Optical recipes carry an explicit predictor identifier through the browser
export path. Previews and Bambu/Prusa virtual palette colours use that model;
the physical reel indices and native mixture ratios retain their existing
schemas. Snapmaker may display its own predicted swatch after import. Legacy
CLI/browser polynomial entry points remain available unchanged; existing parity
checks still verify them. Native slicer reopening and physical colour fidelity
were not established by archive tests.

## Verification cases

- Upstream published known answers: cyan/yellow, cyan/magenta, magenta/yellow.
- Symmetry, pure endpoints, identical inputs, and neutral black/white.
- Complete five-colour set with a cyan/yellow blend: physical matches plus a
  distinct virtual colour; no silent solid substitution.
- Alien five-colour palette: 2,380 candidate four-reel sets in the default pool;
  no complete set found, so no recommendation is offered.
- Owned stock, locked positions, materials, empty libraries and bounded large
  libraries; every returned set satisfies the export planner.
- Snapmaker, Bambu and Prusa archive settings retain recipe ratios and predictor
  colours; existing normal conversion/parity tests remain separate.

Three- or four-component recipes are not enabled: adopting a predictor that can
calculate them does not establish that all three target writers/slicers can
represent them correctly. This rebuild improves pair-based Full Spectrum
prediction and search without claiming arbitrary full-colour reproduction.
