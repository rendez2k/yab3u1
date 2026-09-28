# Bambu standard-colour import

Pure Bambu conversion exports standard 3MF colour groups and per-triangle
`pid`/`p1` references without overriding the user's printer presets.

Do not add `BambuStudio:3mfVersion` or `bamboo_slicer:Version3mf` metadata to
these documents. Bambu's root importer recognises native projects through
`Application`, but its separate `ObjectImporter` recognises either version
marker and sets `is_bbl_3mf`. That causes it to skip the standard triangle
colours. With no volume colour data, the GUI skips its colour-mapping dialogue.

This was the cause of the all-orange pumpkin import reported on 28 September
2026. Its four colours and all 1,897,084 triangle references were still in the
archive. Version 2.6.12 omits the native markers for standard-colour exports;
native project exports retain them.

Reference: Bambu Studio's [3MF importer](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp),
`ObjectImporter::_handle_object_end_metadata` and
`ObjectImporter::_handle_object_start_triangle`.

Validation: the separate-mesh-member regression fails before the fix and passes
afterwards; all 47 conversion checks pass. A repaired copy of the reported
archive was compared member by member: only the two version metadata elements
changed. Bambu GUI acceptance of that corrected copy remains to be checked;
archive validation is not a substitute for checking the displayed/sliced result.
