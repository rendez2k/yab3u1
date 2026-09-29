# Object layout parity — 2.6.22 review

Both pages expose object quantities, Add copy, Remove, Restore, automatic/group/separate arrangement, spacing, bed dimensions, prime-tower reservation, Fill plate, and Undo Fill plate. Changing a quantity selects separate-object packing. Attached parts and orientation remain together; repeated instances of a source object remain linked.

Full Spectrum uses the existing shared packing engine and worker footprints. Removing an object changes its colour assessment as well as its preview and export. Selection measurements are guarded so a late reply cannot enable Fill for another selection. Invalid or empty selections block export. New uploads and plate changes reset quantities and Fill history.

Both bottom action bars follow Preview → Palette → Plate layout → Export settings, with the primary action on the right (beneath the shortcuts on narrow screens). Bed details are collapsed; preview controls sit above the canvas. Main-converter bulk mode hides its single-project action bar.

Validation:

- Object packing regressions passed, including tower, edge, spacing, zero quantities, overflow and deterministic placement.
- New Full Spectrum tests reopen a filled export, check instance counts and colours, compare preview geometry counts, and verify the worker supplies footprints.
- 24 tests passed across Full Spectrum layout, PETG support and worker recovery; 21 conversion race checks passed; all 12 site-build tests passed.
- Browser: real pumpkin project, Remove Mini Screwdriver, duplicate Pumpkin, Fill → two complete edited sets / 16 objects. Full Spectrum arch: remove all, restore, duplicate, Fill → 10 sets / 20 objects, Undo and successful PETG export.
- Desktop and 390 px viewport inspections: no document horizontal overflow; matching shortcut order, visible quantity actions and reachable primary action. Published review build checked on Netlify.

Packing remains conservative rectangle packing, not slicer nesting. The slicer must still check final supports and prime-tower size. Bambu/Prusa Full Spectrum exports retain their existing generic destination workflow; their planning area is configurable here.
