# Printed blend samples

Full Spectrum can use measured colours for a named set of four U1 reels. Open
**Printed blend samples** under Your palette. This is optional: ordinary palette
suggestions still work without measurements, an account or an AI service.

1. Select a palette and the intended U1 nozzle/layer settings. Give each reel a
   brand/spool name and record the printing and measurement conditions.
2. Start the calibration, choose two reels and download their five-tile 3MF.
   Open it in Snapmaker Orca, slice and check the assignments. From above, left
   to right: pure A, 75/25, 50/50, 25/75, pure B. The app does not send a print.
3. Print with the reels, temperatures, cooling and layer settings you intend to
   use on the model. Measure the flat upper faces with a colour measurement
   device and enter its sRGB hex values. Ordinary photographs and screen colour
   picking are not dependable calibration measurements.
4. Save the measurements and explicitly confirm the same reels and conditions
   before enabling them. Only recorded 25/50/75 recipes are replaced; other
   blends continue to use the standard estimate. No extrapolation or AI training
   takes place. Reordering the physical slots preserves the measured recipes.

One calibration is stored locally in this browser. Download its JSON before
replacing it or clearing browser data, and import that backup on another browser.
Import and reload never enable measurements automatically. Different configured
settings disable them; different reel sets use estimates. Colour/material values
cannot prove reel identity, so the explicit confirmation of actual reels and
print conditions still matters. Source settings are compared conservatively:
another model may require reconfirming/recreating the setup even when its print
conditions look similar. The native slicer may render its own blend estimates.

The generated projects and measurement flow have automated structural/browser
checks. Physical print and colour-accuracy validation remain necessary. Calibration
currently targets U1/0.4 mm native blends; other output targets keep the standard
predictions. Flat test results are not a guarantee of identical appearance on a
curved model or under different lighting.

Palette ranking now measures the original transformed mesh's coloured surface
areas before preview simplification, including selected instances. It includes
internal surfaces and does not apply negative cuts or infer visibility. A
worst-colour-change penalty limits sacrificing small accents; **Keep exact**
remains the hard constraint for eyes, logos, skin tones or other essential colours.
