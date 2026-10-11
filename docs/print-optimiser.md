# Print strategy comparison — 2.6.25 review

Open **Optimise print time** inside Plate layout on the converter, or Copies & spacing in Full Spectrum. Full Spectrum requires an applied, reviewed palette first. Both pages use the same component.

1. Define one complete set using the object quantities. Remove alternative bodies and set matching part counts first: the app cannot infer an assembly kit.
2. Choose **Finish the order fastest** and its set count, or **Most complete sets per hour**. Enter expected plate-change/cooldown time.
3. Use the page's printer setup. Bambu comparisons need a native model/nozzle profile; the comparison can load official pinned profiles. Optionally add another identical printer, or a U1 with a 0.4 mm nozzle alongside a 0.4 mm Bambu setup.
4. Compare a single set together, batched sets, separate single-colour groups, and concurrent work on two printers. An optional sequential candidate prints single-filament groups by object and multicolour groups by layer.
5. Download individual plates and enter the slicer's total plate time, or import its single-plate G-code/sliced 3MF. A comparison pack includes a Python 3 helper for installed slicers with working CLI support. Import its `timings.json` into the same open comparison.

This release compares bounded strategies, not every possible partition or arrangement. Fixed-order candidates produce exact quantities, including partial final batches. Rate candidates produce balanced complete sets. Tool changes remain unknown unless reported. Completion excludes final unloading; repeating production rate includes the final-to-next plate change. Two-printer completion is the slower lane, with both printers assumed ready to start together.

Only fully timed candidates rank. Missing results and failures stay visible. Model/export/comparison changes invalidate timings; local reports require the matching pack ID and job hashes. Individual manual/G-code imports rely on the user's association with the displayed job. Keep exported quality/material settings unchanged for comparable results. These are slicer estimates, not measured physical print times.

## Sequential and material boundaries

Rectangle packing does not model head/gantry clearance. Sequential groups start with one set per plate and must be arranged and validated in the destination slicer. The helper requests Arrange; automatic clearance evidence additionally requires successful sliced output confirming `print_sequence = by object`. Otherwise the user must confirm the exact plate passed the slicer's checks. Unknown paint is never classified as single-colour. Blends, PETG interfaces and enabled/painted supports conservatively exclude sequential candidates in this release.

The official [Bambu CLI documentation](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage) describes the slice/arrange/export flags. Upstream [Bambu Studio](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Print.cpp) and [Snapmaker Orca](https://github.com/Snapmaker/OrcaSlicer/blob/main/src/libslic3r/Print.cpp) validate sequential clearance. This is not validation of every installed version.

Split U1 jobs can compact a larger source palette to selected physical filaments. Uncertain paint, custom tool changes, and explicit support/infill filament references prevent unsafe compaction. No model colour is approximated by the optimiser. Geometry, painting and existing export-setting policies are retained. Cross-printer profiles use their own machine limits and compatible material presets.

## Validation and limitations

- Tests cover exact quantities and tails, parallel scheduling, turnaround, rate ordering, missing/failed timings, clearance gates, total-time parsing, report identity and paint-preserving palette compaction.
- DOM tests exercised comparison, manual timing, ZIP download, matching report import, stale report rejection and stale asynchronous export rejection.
- The real Stabby Pumpkin round trip used one selected body variant, its arm and accessory parts. The H2C candidate retained seven objects and five colours, including painted bodies. U1 split jobs held nine orange objects, three yellow splatters and three green stems for a three-set order; each used one filament and reported no export problems. The original file was unchanged.
- Installed Snapmaker Orca CLI slicing on the green-only job exited with Windows access violation `3221225477`. The helper reported failure and no timing was accepted. Bambu's help probe returned no usable CLI output. Automated local slicing is unverified for these installations; manual/sliced-file timing entry is available.
- Visual browser validation remains unavailable because the CUA runtime exits during startup. No rendered-browser success is claimed. Mechanical UI findings concern existing page styles; the incumbent appearance was retained.
- No printer commands were sent and no actual speedup is claimed without a successful slice comparison.
