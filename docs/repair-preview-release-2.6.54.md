# Repair preview correction — 2.6.54

Repair could succeed while the preview still drew the damaged original on top of its repaired replacement. Both objects remained selectable in grouped and automatic arrangements. Clicking the original then sent its old mesh back to automatic splitting, which reported the same defects again.

The editor retains original resources for Undo and sets their quantity to zero. All arrangements now honour that omission. The preview uses the same visible object set and bounds as the exporter, including its canvas selection ranges. A stale selection for an omitted object cannot start another edit.

A complete repair replacement keeps its grouped position. When another original copy remains, the editor switches to separate-object packing so it does not overlap the repaired copy. Undo restores the previous source, quantities and arrangement.

## Validation

- All 90 Workbench tests pass. A new end-to-end worker test repairs a damaged painted fixture and verifies that only its replacement is drawn, selectable and exported in automatic, grouped and individual-object arrangements. Retrying the splitter checks the repaired mesh, and exported geometry and colours survive reopening. The test reproduced the original overlap before the fix.
- All 157 automated shared-web tests pass with Python on PATH. The command-line real-file probe requires a supplied model argument and is not part of this automated suite.
- Quantity, arrangement and Undo tests cover both complete replacement and repair of one of multiple original copies. A stale canvas selection is rejected.
- The production build succeeds. The UI detector reports no findings in the changed studio module.
- In Chrome, the supplied alien repairs successfully with fourteen redundant faces removed. Clicking the model selects `alien.stl · repaired`; its four colours remain visible without the original overlapping it. Desktop and 390 px mobile checks pass with no console errors.
- Retrying automatic assembly splitting on that canvas selection reaches the join checks instead of reporting the old 22 non-manifold edges. It retains eleven small regions, six regions that wrap around the body and three with folded boundaries; it does not claim a successful separation.

This corrects which object is displayed and edited. It does not extend the automatic splitter's join-closing capabilities. A repaired object may still need a manual cut when the proposed larger-part joins cannot be closed safely.
