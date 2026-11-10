# Workbench 2.6.58

Session restore (2.6.57) now stores the same settings snapshot the studio already takes before a model edit, so undo and reopen share one definition of "your choices". The snapshot is written with the workspace context every three seconds when it has changed and no edit is pending.

On Reopen the model loads with its context, the shell switches to Full Spectrum when that workspace made the saved choices, and the snapshot is applied. A failure to apply it leaves the model open and reports that colour choices could not be restored.

## Validation

- 101 Workbench tests pass; the store test now covers settings and workspace kind.
- Headless Chromium, built-in sample. Convert: slots swapped, reload, Reopen restored the identical rules. Full Spectrum: suggested palette applied and PETG interface enabled, reload, Reopen returned to Full Spectrum with identical reels and interface setting. No page errors.

## Not covered

Real multi-colour projects, manual blends, focus marks and calibration data were not exercised. Settings saved by an older build are not migrated; if a future build changes their shape, the model still opens without them.
