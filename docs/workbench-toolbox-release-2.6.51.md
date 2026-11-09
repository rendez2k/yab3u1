# Workbench 2.6.51

Opening the app now offers Quick conversion and Full studio. The optional remembered choice is stored locally. Quick conversion uses the existing conversion engine and compatibility checks; the header selector and Manage colours move into the studio without replacing the loaded source or plate/palette edits. A drop or extension handoff defaults to Quick conversion when no choice has been made.

The studio exposes six large labelled buttons on the left. Model colours are visible above the tools and count retained objects on the current plate, excluding spare filament entries. Duplicate colour swatches count once, with the separate filament count when relevant. Unknown paint is labelled as uncertain rather than presented as a verified complete palette. Settings remain contextual. The mobile toolbox scrolls horizontally; editing controls scroll together instead of occupying a tiny nested pane.

Automatic splitting now defaults to substantial geometry regions with original paint intact. Painted-region separation remains a separate choice. Candidate joins must close safely, preserve volume, and accommodate any requested connector. Small detail fragments stay attached. Detection is deterministic and does not use AI or recognise named body parts. Up to 12 large joins are checked per component, with a 750,000 original-triangle limit per part. Damaged original meshes are retained rather than silently repaired.

## Validation

- 81 Workbench tests cover model editing, geometry, joins, paint, export round trips, plate management and controls. New tests cover mixed-paint assembly pieces, source immutability, damaged-mesh rejection, original used colours, toolbox navigation and retained-part reports during preview.
- Production build succeeds. The module graph includes the new colour-summary, toolbox and assembly-split modules and retains cache revisioning. No private models or review screenshots enter the build.
- Chrome desktop and 390 × 844 checks exercised first launch, direct Quick conversion file picking, Quick-to-studio handover, visible source colours, feature selection, and repair feedback. The supplied four-colour alien displayed green, purple, black and white. No console warnings or errors were recorded in the final desktop check.
- The browser conversion generated an 11.71 MB Snapmaker project with four filaments and no colour change. Browser automation could not retrieve the iframe's Blob download (unsupported embedded-frame Blob capture); disk-download completion is not claimed by this check. Export structure and painting are independently covered by archive round-trip tests.
- The UI detector produced two inherited findings: a base help-dialog border/shadow overridden by the studio's borderless dialog styling, and a dynamic static-preview image whose source is assigned before showing it. No missing shipping image was observed.

## Known limit

The supplied 608,046-triangle alien has 22 non-manifold edges in the original mesh. The new automatic assembly mode stops with a repair explanation and leaves it unchanged. It does not yet produce a head/arms/legs assembly for that file. This is preferable to presenting a few tiny detached patches as a successful body-part split, but it is not a completed semantic splitting solution. Repair in a slicer, or an explicitly reviewed manual cut, is still required.

The Split3MF comparison used its built-in sample to inspect colour selection, splitting and navigation. It did not establish the printability of its output or a successful split of the user's alien. No competitor source or assets are included.
