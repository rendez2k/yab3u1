# Plates and page-wide import — 2.6.47

Plate navigation, deletion, object quantities and project export now share **Plates & objects**. Each source plate has a thumbnail, object count and filament swatches. Switching plates preserves its quantities and colour assignments. Delete removes a plate from the export; Undo deletion restores its objects and edits. At least one plate remains.

**Save all plates · 3MF** creates one editable native project with the retained plates, names, copies, paint, supported modifiers and compatible settings. **Export print jobs · ZIP** creates independently mapped single-plate files with a filament list. A plate exceeding the destination's available inputs must be resolved before the ZIP is written. An editable U1 project can hold more than four logical filaments across its plates; that does not add simultaneous printer inputs. Prusa users use separate jobs, because its project format does not retain this plate collection.

The whole Workbench page accepts one 3MF, GLB or model ZIP drop, including the preview, inspector and navigation shell. A page overlay shows the target; dropping uses the ordinary Open model workflow. Unsupported or multiple files receive an explanation. The explicit Batch drop zone retains its multi-file workflow, and internal text/object drags are ignored.

Native one-plate exports now start at plate 1 even when they came from a later source plate. Reopened projects compact unused model inputs above reserved support/infill references without changing those references or repaint assignments. XML names round-trip without repeatedly escaping ampersands.

## Validation

- 214 automated checks pass, including per-plate edit persistence, reversible deletion, stale-export rejection, palette mapping, reserved inputs, native plate numbering, multipart/modifier preservation, names, and file-drop handling.
- Browser validation used the user's five-plate Sonic project: copied an object, switched plates, deleted/restored a plate, exported a combined project and a ZIP, and reopened the combined project.
- The combined export retained five plates with instance counts 4, 3, 3, 2 and 2 and the original used colours. Four independent ZIP jobs used 1, 2, 4 and 1 filament inputs before reopening the master. Reserved native setting references can retain an additional unused-looking input on reopening.
- Installed Snapmaker Orca 2.4.1 opened the combined project and sliced its duplicated hair plate. The regenerated four-colour shoes job also sliced successfully after the native plate-number fix. These checks validate slicer acceptance, not a physical print.
- Desktop and 390 px mobile captures were inspected. Native OS file dragging was not exercised; document-level file-drop behaviour is covered by automated tests.

Research and implementation choices are recorded in [the Bambu2U1 review](bambu2u1-multiplate-review-2026-11-06.md). No third-party converter code was copied. Original model files, photos and private validation downloads are excluded from the release.

## Separate optical test

`tools/prepare-ordered-wall-test.mjs` prepares an original eight-sample ELEGOO CMY+White wall comparison. Samples independently vary outer/inner wall order and sequence alignment, with pure-colour controls. This is an uncalibrated physical experiment, not a new prediction model. The supplied local print guide explains the 0.08 mm layer height, 0.4 mm nozzle, slot order and enabled prime tower. Slicer toolpaths passed all 1,200 region/layer material-placement checks; estimated total is 1 h 51 min and 11.57 g. No print was started.
