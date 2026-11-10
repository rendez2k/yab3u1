# Workbench 2.6.70 — stronger blending when reducing colours

## What changed

The blend planner chose, for each model colour that is not a loaded reel, the best two-reel mixture at 25, 50 or 75%, and kept at most six mixtures. `web/shared/mix.js` now has three levels:

| Level | Ratios | Blended colours | Longest repeat |
| --- | --- | --- | --- |
| Standard | 25, 50, 75 | up to 6 | 4 layers |
| Strong (page default) | 17, 25, 33, 40, 50, 60, 67, 75, 83 | up to 10 | 6 layers |
| Finest | 10 to 90 in 5% steps | up to 12 | 20 layers |

The level applies to the palette search in `recommend.js` (including its worker) and to the final plan. The module default stays Standard and `RATIOS` is unchanged, so the Python reference and existing tests are unaffected; the Full Spectrum page selects Strong. The total of physical reels and blended colours still has to fit the exporter's limit (16 for the U1, 24 for Bambu).

## What it does and does not fix

Finer ratios help when a model colour lies between two of the loaded reels. With cyan, magenta, yellow and white loaded, eight off-grid test shades had a combined colour error of 61 at Standard and effectively 0 at Strong.

They do not help when a model colour is outside what the loaded reels can mix. Reducing `five-colours.3mf` to four of its own colours still turns red into a grey at every level, because no two of the kept colours mix to red. For that case the lever is which four reels are loaded: a cyan, magenta and yellow based pack can reach far more of a model's colours than four of its original colours can.

## Validation

- 3 new tests: the default is unchanged; Strong and Finest cut total error to under half of Standard on off-grid shades, stay within their recipe limits and use only whole percentages; the palette search honours the level.
- 112 Workbench tests and 169 web tests pass. `web/tests/real_file.test.mjs` fails as before.
- Headless Chromium with `five-colours.3mf`: the control appears in Colours, defaults to Strong, and changing it reruns the suggestions; Finest changed the red substitute from a 75/25 to a 70/30 mix.

## Not verified

- No slice or print. Whether Snapmaker Orca renders 17% or 5%-step ratios as cleanly as 25/50/75, and how visible the longer repeats are on a real wall, needs a print.
- Colour predictions are still the unmeasured estimate.
- Three-reel blends remain limited to Bambu Studio and OrcaSlicer output and are not used by the automatic planner.
