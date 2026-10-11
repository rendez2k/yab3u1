# Object colour groups — 2.6.24 review

Both conversion pages now show source-filament swatches and dimensions beside object quantities. The source colour group selector can remove a whole group, keep only that group for a separate export, restore one of every object, or undo the last group change. Single-colour groups require exactly one decoded source filament; objects with unknown paint are not classified as single-colour. Repainting, blends and support materials can still introduce additional output filaments.

Objects and Fill plate are available beside both previews, with the same disabled state and feedback as the existing layout controls. Top view frames the planning area from above. Original mesh vertices, triangle paint and component relationships are unchanged by these controls.

Fill repeats the quantities list, not a inferred assembly kit. For example, a file containing four alternative pumpkin bodies and one cap does not imply four complete kits. Set the matching quantities before filling. Existing conservative source-filament retention in the normal converter is unchanged: omitting geometry does not necessarily remove its project filament entry. Full Spectrum assesses the selected geometry.

## Sequential printing assessment

The user's optimisation goal has two selectable objectives: finish a fixed order as soon as possible, or maximise complete sets per hour. Packing capacity is only an input. A future strategy comparison must keep required quantities, geometry, colours and quality settings comparable; report sliced time, tool changes, output quantity and plate changes; and identify estimates that do not include operator turnaround. Multiple-printer completion time is the end of the slowest scheduled branch, not the sum of concurrent print times. Complete-set ratios must be user-defined because alternative bodies and spare parts cannot be inferred reliably from filenames.

This review implements object preparation controls, not a time optimiser. No headless slicing benchmark or measured time recommendation was produced. The installed Bambu executable returned no help output in the local CLI probe, so a working automated slicer integration remains unverified.

The 11 October 2026 review of upstream [Bambu Studio Print.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Print.cpp) and [Snapmaker Orca Print.cpp](https://github.com/Snapmaker/OrcaSlicer/blob/main/src/libslic3r/Print.cpp) confirms that both validate sequential clearance independently of ordinary layered clearance. Branch heads can change; this is not validation of an installed slicer version or printer firmware.

YAB3D has not added or enabled sequential export. Its rectangle packer has no toolhead travel/gantry collision model. Ordinary packing spacing cannot certify print-by-object clearance. Compare sliced time and tool changes for:

- Separate single-colour parts, arranged and checked for sequential printing by the destination slicer.
- Multicoloured bodies together, printed by layer so repeated copies can share each layer's tool changes.
- A combined plate where the slicer supports and validates the requested sequence.

Printing each multicoloured copy separately can repeat its colour-change sequence. Single-colour source objects using PETG interfaces or mixed output colours are not single-filament jobs. No speedup percentage is claimed without slicing.

## Validation

- 13 Node tests passed across object grouping, packing, top camera framing, Full Spectrum layout/duplication and negative-volume exports; 12 static-site build tests passed.
- The supplied Stabby Pumpkin contains ten source objects: five multicoloured, three orange-only, one yellow splatter and one green stem.
- A local archive round trip excluding the stem preserved painted objects and omitted the stem's build instances. The official pinned H2C 0.4 mm profile gave a 330 × 320 mm planning area and three repeats (27 objects); the U1 gave two repeats (18 objects) on 270 × 270 mm. These use the current tower, spacing and estimated support allowances and are not sliced or physical-print clearance proof.
- UI mechanical scan returned no findings. Browser visual and interaction validation could not run: the CUA runtime exited with `windows sandbox failed: helper_unknown_error: setup refresh had errors`. No replacement screenshot or live-browser success is claimed.
- No original model file or printer configuration was changed.
