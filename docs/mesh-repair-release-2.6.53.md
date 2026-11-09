# Local mesh repair — 2.6.53

Automatic assembly splitting previously detected damaged edges and sent users to a slicer. Split & connect now includes **Repair mesh**, and a split rejected for mesh damage offers the same action in its result message.

Repair runs locally in the model-edit worker. It removes duplicate, collapsed and opposite zero-thickness faces, and separates suitable pinched edges using the adjacent surface connections. Each moved vertex travels at most 0.001 mm. Retained triangles keep their original corner order and attributes, including subdivided colour, support and seam painting. Repair does not move the object to a different orientation or switch the plate arrangement.

The operation checks edge incidence, edge direction, triangle orientation and volume change before applying. It also reads back the generated 3MF and checks the repaired part's edges again. Undo restores the original source and layout. If any selected part cannot be repaired, no partial repair is applied.

## Boundaries

This is a local repair operation, not general remeshing. It does not fill holes, resolve arbitrary self-intersections, invent missing paint, reverse painted triangle orientation, or choose between ambiguous overlapping surfaces. Conflicting duplicate paint, uncertain surface pairing, unsupported modifier volumes and parts over 750,000 original triangles are rejected. Passing the edge checks does not certify every possible mesh or printing defect.

Repair and splitting remain separate operations. A repaired mesh may still have a shape boundary that cannot be closed by the current automatic splitter. In that case, the model remains assembled and the split result explains the limitation. Shape-related failures now refer to shape regions rather than colours.

## Validation

- All 88 workbench tests pass, including new transactional repair, deterministic output, retained painting, 3MF round-trip, selected-copy quantities and Undo coverage.
- The supplied painted alien changed from 22 non-manifold edges to zero. It also has zero open edges, inconsistent edge directions and degenerate faces after repair and after saving/reopening.
- Fourteen zero-thickness faces were removed, leaving 608,032 triangles. Thirty-eight vertex-fan positions were separated; the greatest displacement was 0.000873409 mm.
- All four source filament colours remain. Retained faces keep their original paint strings; removed paint belongs only to the fourteen discarded faces. Bounding dimensions are unchanged apart from coordinate serialization precision, and signed volume changes by approximately 0.0000202 mm³.
- The repaired alien still cannot be separated into larger assembly parts by the current join closer. That is a separate splitter limitation, not a successful split claimed by this release.
- Chrome verification covers the failure-message action, actual repair of the alien, the restored colour preview, desktop/mobile result layout and Undo. Private models and screenshots remain outside the release build.
