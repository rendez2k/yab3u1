# Workbench validation

## v2.6.28-test — object editing and feedback

Published test deploy: `6acca785be2297d73300ce14`. Thirteen deployed asset hashes and all four entry points matched the local build; the established production and PETG sites remain unchanged.

- Eight workbench tests pass: original DOM parity/isolation plus multiple-copy edits, prior set multipliers, unchanged sibling totals, invalid counts, real packing constraints, no-fit preservation and cancellation.
- Eleven existing object/layout test cases pass, including the layout script's 13 internal checks and preview/export placement parity.
- Live synthetic sample in Convert: adding three produces four total, Undo restores one, Fill adds twenty to produce 21. In Full Spectrum: adding two produces three total and Fill adds eighteen to produce 21. Controls and counts agree in both modes.
- Live loading observation recorded Reading and Drawing phases; feedback cleared after completion. No deliberate worker delay was added.
- Desktop and mobile toolbar inspection completed; at 390 x 844, there was no horizontal overflow and the selected-object view retained 163 px of static model rendering space after the mobile adjustment.
- Checked view: axe 4.12.1 reports 47 passes, zero violations and zero incomplete checks; no page errors reported.
- WebGL remains unavailable in the remote browser. Name selection and static preview were exercised; physical printer writes and GPU picking were not tested.

## v2.6.27-test baseline

Preview: https://workbench-test--yab3u1.netlify.app/

Netlify deploy: `6acc0122708410135aa697d9`. This is a separate test alias; the established production and PETG review entry points were checked and do not load the workbench shell.

## Automated checks

- 105 existing JavaScript regression tests passed.
- Three new DOM/layout/build-isolation tests passed. Original control IDs remain unique and their feature controls remain reachable in the relevant inspector panels.
- 12 Python build tests passed.
- Published asset verification: 11 asset hashes matched and four entry-point checks passed.
- `git diff --check` passed.

## Real model, local only

The supplied Stabby Pumpkin source was exercised locally through the existing preview/export pipeline. The 48.9 MB archive contains ten objects on one plate, five colours and 3,128,767 geometry triangles. Snapmaker, Bambu and Prusa exports each retained ten build items and all 3,128,767 geometry triangles. This checks the conversion pipeline and geometry retention, not slicer interpretation or a physical print. The private source and exports are not deployed.

## Live browser checks

The public preview was exercised using its synthetic four-colour arch sample. Checks covered file opening, Fill plate, copy counts, PETG merge and slot reassignment, converter export, first Full Spectrum handoff, palette application and export, return to the existing converter experiment, batch entry, textured import and responsive navigation. A first Spectrum-to-Convert handoff preserved a selected 0.6 mm nozzle in both state and the actual destination control.

At 1440 x 900 and 390 x 844, feedback remained visible and the document and engine frame had no horizontal overflow. The final axe 4.12.1 audit reported 47 passes, zero violations and zero incomplete checks in the checked view. Captures are in `.impeccable/review/`.

The remote browser had no WebGL2. Its explicitly labelled static software preview was verified, including updated model/layout rendering. WebGL orbit, picking and device-specific GPU behaviour were not visually validated in that environment. No live printer commands were sent.

## Review and remaining boundaries

Independent finish review identified narrow-screen status visibility, first-switch nozzle retention and a heading hierarchy issue. All three were corrected and rechecked; the review disposition was ship for those three fixes.

The existing Chrome extension ZIP still opens the established review app. Help labels that destination; to try this workbench with a MakerWorld project, open its original file here. The workbench includes the compatible original-file handoff receiver.

Each colour mode retains its own in-memory experiment. The first switch carries source and setup; subsequent visits preserve that mode's edits. Closing the tab discards the model session. These behaviours are explained in Help.
