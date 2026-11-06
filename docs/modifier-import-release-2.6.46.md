# Sonic modifier import — 2.6.46

The MakerWorld Chrome import could reject the entire articulated Sonic project with a `hand R / modifier_part` error before the user could choose a plate. The extension delivered the original file correctly. Workbench's reader rejected every settings modifier, including simple native infill modifiers that can be retained.

Workbench now opens projects containing supported native settings modifiers and carries their meshes, component transforms, parent relationships and settings into Snapmaker Orca, Bambu Studio and OrcaSlicer exports. Modifier meshes remain hidden in the printable preview and do not inflate bounds, object quantities or filament usage. Copies keep their own modifiers. These overrides are retained even when optional transfer of ordinary source print settings is disabled.

Supported overrides are sparse, skin and skeleton infill density, wall loops, and top/bottom shell layer counts. Values are validated. Explicit filament overrides, unknown settings and other unsupported helper roles still stop import with an explanation. Modifier-bearing selections cannot be exported to Prusa or passed through mesh rebuilding tools; filament reassignment remains available through Colours. Other objects and plates remain editable.

## Source plates

The [articulated Sonic profile](https://makerworld.com/en/models/1940000-sonic-the-hedgehog-articulated-figure-no-ams-print?from=search#profileId-2083461) contains six plates: BLUE (15 instances), WHITE (7), BLACK (3), RED (4), FLESH (14) and an unnamed sixth plate (1). WHITE has two hand modifiers; FLESH has a face modifier with 12% sparse, skin and skeleton infill overrides. The separately supplied Obunaga project has five plates and no modifiers.

- Project → Plate selects an original source plate. Normal export writes the selected plate.
- Batch exports each source plate to its own 3MF in a ZIP, keeping original objects and copies. It preserves source filament order; it does not reduce a project palette automatically.
- Fill with whole sets repeats the contents of the current plate. It does not infer complete assemblies spanning several source plates or distinguish alternatives from required components.
- Prepared plates are generated output jobs, distinct from the source plate selector.

No new cross-plate assembly planner is included in this fix.

## Verification

- All 203 automated tests pass, including nine modifier tests. Coverage includes explicit opt-in, unknown/invalid options, attribute order, hidden geometry, colour usage, copying, transforms, native formats, settings persistence, inheritance and unsupported editing/export paths.
- Both real Sonic projects passed export/reimport for every source plate across Snapmaker, Bambu and Orca: 33 plate/target combinations. Names, instance counts, roles and modifier settings were checked.
- Snapmaker Orca successfully sliced the exported FLESH plate. This verifies acceptance of the project, not physical print quality or the material effect of tiny modifier volumes.
- Browser checks opened the actual six-plate source, switched to WHITE and FLESH, and saved the FLESH export. Reading the browser download confirmed 14 instances, one filament and the face modifier's three 12% overrides.

The original models and inspection photographs remain local and are excluded from the application build and repository commit. The Chrome extension does not require an update.
