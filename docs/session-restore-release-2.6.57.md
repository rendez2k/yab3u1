# Workbench 2.6.57

The shell now stores the active model in IndexedDB (database `yab3d-workbench`) each time the source changes, including the new source revision produced by an applied model edit. Workspace settings (destination, printer inputs, plate, layout and quantities, nozzle, PETG interface) are written separately when they change, checked every four seconds while no edit is pending.

On the next visit a prompt offers Reopen, Forget or dismiss. Reopen loads the stored file into the active workspace with the saved settings; if those settings no longer apply the model opens without them. Opening or dropping any other model hides the prompt and replaces the stored copy.

"Keep my last model in this browser" in Help is on by default. Turning it off deletes the stored model and stops further saving.

## Limits

- One model is kept, not a history.
- Colour slot assignments, repaints made in Colours, Full Spectrum palettes and calibration choices are not restored.
- A model restored from a Full Spectrum session reopens in the workspace the page starts in (Convert unless opened at the Full Spectrum address).
- Very large models may exceed the browser's storage allowance; saving then fails silently and no prompt appears.
- Private browsing windows discard the copy when they close.

## Validation

- 101 Workbench tests pass, including four for the store: save, read, separate settings, forget, switched off and missing storage.
- Headless Chromium, 1440 x 900, built-in sample: split applied, destination changed to Bambu Studio and a copy added; after reload the prompt appeared and Reopen restored three objects, the Bambu destination and the same quantities. Forget and the Help switch each left no prompt after a further reload.
- Full Spectrum was also walked through in the 2.6.56 layout at 1440 x 900 and 390 x 844: all six tools opened with no page errors and no panel overflow.

## Not covered

Other browsers, storage-quota failure with a real large model, and restoring a GLB/ZIP textured import were not tested.
