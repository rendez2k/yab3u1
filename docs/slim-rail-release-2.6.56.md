# Workbench 2.6.56

The studio sidebar now has a 68 px tool rail beside the panel instead of a grid of large tiles above it. The colour summary is one line of swatches with the names as tooltips; the "could not be read" warning still appears in full when paint is uncertain.

Export is a single header button. With a loaded model in Convert it opens a menu: the current plate as 3MF, every plate in one 3MF (multi-plate projects; unavailable for PrusaSlicer), or a ZIP of separate print jobs. Sequential preparation, Full Spectrum and Quick conversion with nothing to choose keep a single direct action.

Split is ordered as method, preview, connectors. Connector type, dimensions, orientation and position sit in a closed "Connector size & fit" group with their previous defaults unchanged. Repair mesh moved to a closed group beneath the flow. Opening Paint or Split with exactly one object on the plate selects it.

Tips (rail foot, stored on the device) shows or hides explanatory paragraphs. Messages with a status role, plan summaries and warnings are never hidden, and Quick conversion always shows its text.

## Validation

- 97 Workbench tests pass, including a new check of rail names and the Tips switch.
- Production build succeeds.
- Headless Chromium at 1440 x 900, 1000 x 760 and 390 x 844 with the built-in colour split sample: all six tools open, the Export menu downloaded both the 3MF and the print-jobs ZIP, and an automatic split with connectors applied and reported two new parts. No page errors.

## Not covered

Full Spectrum was not exercised in the browser for this release; it shares the rail and Tips styles but its panels were not reviewed on screen. No real printer, slicer import or multi-plate source file was tested. Redo, viewport move/rotate handles and session restore remain unbuilt.
