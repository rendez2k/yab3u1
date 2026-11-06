# ELEGOO ordered-wall comparison — 7 November 2026

Open **ELEGOO-ordered-walls-v1.3mf as a project** in Snapmaker Orca. This is the new outer/inner-wall test, prepared for your loaded ELEGOO Rilievo CMY+White. It contains eight small numbered hollow cylinders on white bases.

This tests whether an independently patterned inner wall changes the apparent colour of a thin outer wall. Samples 5/6 and 7/8 use the same colour proportions but different alignment between the outer and inner patterns. It does not use iDither's measured calibration or promise a green result.

## Before printing

- Snapmaker U1, **0.4 mm nozzle**.
- Slot 1 **cyan**, slot 2 **magenta**, slot 3 **yellow**, slot 4 **white**. Magenta is retained in the project but unused by this test.
- Numeric regular layer height **0.08 mm**, first layer **0.20 mm**. The process is named “YAB3D 0.08mm Ordered walls v1”. Check the numeric fields after import.
- Keep the supplied wall widths, four wall loops and by-layer sequence. Supports are off.
- The **prime tower is enabled**. In the validation slice its footprint was about **68 × 76 mm**, larger than an individual sample, at the front-left of the bed. It is not a coupon. The eight coupons are further back, clear of it.
- The bundled temperature defaults are 220 °C nozzle and 65 °C bed. These are PLA defaults, not a calibration of your particular reels. Use your established temperature settings if different, while retaining the geometric/process settings above.
- Slice and inspect the preview before sending. The validation estimate was **1 h 51 min, 11.57 g total, 77 filament changes**, including the tower. Your slicer version/settings may change that estimate.

## What each number means

Look from the front of the bed. Front row: 1, 2, 3, 4; back row: 5, 6, 7, 8. Numbers are raised on the white bases.

| Sample | Outer wall | Inner wall | Comparison |
|---|---|---|---|
| 1 | Pure cyan | Pure cyan | Cyan control |
| 2 | Pure yellow | Pure yellow | Yellow control |
| 3 | Pure cyan | Pure yellow | Does yellow inside alter a cyan exterior? |
| 4 | Pure yellow | Pure cyan | Reverse wall order; compare with 3 |
| 5 | C, Y, repeating | C, Y, repeating | Both walls change together |
| 6 | C, Y, repeating | Y, C, repeating | Same proportions as 5; opposite phase |
| 7 | C, Y, Y, repeating | C, Y, Y, repeating | More yellow, both walls aligned |
| 8 | C, Y, Y, repeating | Y, Y, C, repeating | Same proportions as 7; shifted inner pattern |

The sequence begins at the first coloured wall layer, above the 0.60 mm base. There are 75 coloured layers, giving a total height of 6.60 mm. The outer band is 0.30 mm thick; the inner band is 0.90 mm, with three nominal inner paths. Arachne adjusts actual path widths slightly. The centre is hollow and the top open: white is below the wall, not a white backing behind it.

## What to look for

Let the samples cool. Compare their **outside curved walls**, side by side under the same neutral room light, first at normal viewing distance, then close up. Record whether 3 differs from 1, 4 from 2, 6 from 5, and 8 from 7. Include controls 1 and 2 in a photo with those pairs. An additional backlit photo is useful, but keep it separate from the ordinary-light result.

If they still look like the outer filament or clearly separated stripes, that is a useful negative result for this filament/process combination. We should then avoid promising smoother blends from this construction. A changed apparent colour would justify a measured calibration next; it does not yet validate arbitrary model conversion.

## Validation performed

Snapmaker Orca 2.4.1 sliced the project successfully. Automatic CLI arranging was disabled to preserve the labelled layout. Toolpath inspection verified the intended cyan/yellow choice for both wall regions on every one of the 75 coloured layers of all eight coupons (1,200 region/layer checks). Actual reported wall-path widths were 0.300–0.357 mm. The check validates material placement, not the colour a real print will appear.

The exported project includes no ready-to-run printer instructions. `toolpath-check.json` contains the validation report. No print was started.

Construction references: [iDither coloured walls](https://idither.com/wiki.php#colored-walls), [ELEGOO PLA CMYK](https://www.elegoo.com/en-gb/products/pla-cmyk). The geometry and sequences here are original analytical tests, not copied calibration data.
