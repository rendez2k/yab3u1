# Object editing and merged sequential groups — 2.6.26 review

Both the converter and Full Spectrum now offer **Merge colour groups for sequential printing** in the layout controls. The time-ranking interface below has been removed from both pages.

- Click a visible object, or select it from the preview dropdown, then **Duplicate**, **Remove this copy** or **Undo**. Editing a filled plate materialises its existing totals before changing one object's count. Removing an entire source object/colour through the collapsed list retains the plate multiplier and all unrelated copies. Linked source instances are explicitly labelled and remain together.
- **Prepare plates** merges same-output-filament parts into one logical slicer object per colour, on one sequential plate. Individual meshes, paint and composed instance transforms remain intact. Each cloned part has a unique resource ID. Multicoloured parts, including blends using multiple tools, go to a separate by-layer plate. PETG interface projects stay by layer.
- Groups are packed as distinct blocks with a 25 mm planning gap. This is not a head or gantry clearance calculation: open the project in the destination slicer, Arrange, then Slice. Reduce quantities if groups cannot fit or the slicer rejects the clearance.
- Merging rejects modifiers, part-specific overrides and differing transferable print settings. Extra support/infill filament assignments are checked at export; unsupported combinations fail with an explanation. Native Bambu exports use the selected printer/nozzle setup. U1 split exports retain the existing guarded palette compaction.
- Preparation validates and caches actual archives; changing the model, quantities or export settings invalidates them. There are no timing scores or claims of a measured speedup.

Validation: 105 JavaScript tests and 12 site-build tests passed. New coverage checks exact transformed vertices, paint, settings, unique part IDs, incompatible merges, preview hit testing, per-copy worker ranges and cache reuse. DOM interaction checks cover removal, duplication, undo, stale asynchronous preparation, escaped names and collapsed lists on both pages. The real Stabby Pumpkin file, with one body variant and three copies of its parts, round-tripped through both H2C and U1: 15 single-colour parts became three logical groups (9 orange, 3 yellow, 3 green), with 2,005,734 triangles retained; six multicoloured objects remained separate. No source file was modified.

CUA exits during startup, so live browser appearance remains unverified. Installed slicer clearance remains unverified; the earlier CLI limitation below still applies. No printer commands were sent.

## Historical implementation — 2.6.25 (superseded UI)

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
