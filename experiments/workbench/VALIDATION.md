## 2.6.32 pin orientation and colour plate jobs (18 October 2026)

- 37 affected Node tests pass. New checks cover rigid pin-up rotation (including downward and tilted axes), source immutability, bed placement, opt-out, conflicting pin directions, one-region selection leaving other same-colour areas unchanged, and exported colour jobs preserving geometry, counts, painting and sequence.
- Chrome with WebGL: the generated green-stalk sample was separated with a connector and the default pin-up orientation. Convert and Full Spectrum both prepared two separate colour jobs and one sequential colour-group job. Full Spectrum retains its colour-review requirement before preparing exports. Switching modes retained the edited source.
- Desktop 1440 × 1000 and mobile 390 × 844 captures show the actual split model and individual plate downloads. The inspector contains the print-layout choice and the primary download remains reachable. The single detector pass found no primary findings and one inherited border/shadow advisory.
- The real local Flippin Pumpkin source still separates its green stalk and converts to Snapmaker without export problems. The diagnostic identified six black regions and fourteen white regions, including tiny paint patches. All six black regions wrap beyond the supported joining-surface geometry; the main white hands have inconsistent or mismatched paint edges. These are labelled as requiring slicer editing and cannot be applied. This release does not claim automatic separation of those arms or hands. Private source and output files are not deployed.
- Pin-up orientation does not establish bed stability, support requirements or connector fit. Sequential grouping uses the existing planning allowance and requires slicer clearance validation. Colour jobs initially share the selected destination setup; another printer must be chosen in the slicer for jobs printed elsewhere. No printer commands or physical-print validation were performed.

Published test deploy: `6ad4ee89b9db3ccf5a187199` at https://workbench-test--yab3u1.netlify.app/. All 32 asset hashes and four entry points match the build; the established production and PETG sites remain outside this deployment.

The independent substitute finish reviewer returned **ship** for this extension. The fresh substitute documenter confirmed the existing design system still applies and made no system changes. Both used generic agents because the named skill roles were unavailable. Seven affected tests were rerun after the final copy/build updates and passed.

# Workbench validation

## 2.6.31 colour separation and joints (18 October 2026)

- 35 affected Node tests pass. New joint tests check closed, oppositely paired mesh edges; pin and socket dimensions and volume on X/Y/Z cuts with either pin side; exact shared mating caps for shallow curved seams; retained paint and input bytes; invalid dimensions, thin material, flat paint patches and open boundaries. The archive integration test separates a green region with a pin, removes it, exports a one-filament remainder, and retains source settings.
- Chrome/WebGL checks: Convert separates the generated stalk with a pin and socket; its green single-colour button selects the detached part; Delete removes only that part and reduces the project to one filament; Ctrl+Z restores it. Model Undo restores the original joined model. Full Spectrum removes the green painted region, keeps a closed orange remainder, then Undo restores the original. A DOM regression check covers refreshed colour shortcuts after removal/undo, exclusion of unknown paint, and guarding Delete during a split preview.
- Local private Flippin Pumpkin Prusa source: the green stalk is one painted region of a connected mesh, with a 214-edge boundary spanning approximately 0.47 mm in Z. It separates with a 3 mm diameter × 3 mm pin, 0.3 mm diameter clearance and the matching socket; Snapmaker export validation reports no problems. Both sides share the same mating surface. Source bytes and compatible support/layer settings are retained. The user fixture and generated export remain local and are excluded from the build and Git.
- Desktop 1440 × 1000 and mobile 390 × 844 captures show the real model, highlighted green region, configurable joint settings and reachable Apply/Cancel actions. The inspector form scrolls independently. The one detector pass found no primary findings and one inherited advisory in the linked base stylesheet. A fresh substitute finish reviewer returned **ship**, with no material fixes; 36 px mobile Apply/Cancel buttons were noted as optional polish, not a regression.
- These are locating/glue joints. Physical fit and print success have not been tested. Automatic placement rejects insufficient clearance and unsupported seams rather than changing the source. Arbitrary wrapping painted regions, flat paint patches, nested assemblies and conflicting subdivided support/seam painting remain outside the supported edit path.

Published test deploy: `6ad4c7102cf0843869f5c11b` at https://workbench-test--yab3u1.netlify.app/. All 30 asset hashes and four entry points match the build; the two established sites remain outside this deployment. The generated green-stalk sample contains no user geometry.

The fresh substitute documenter confirmed that DESIGN.md and its token sidecar still describe the incumbent system and left them unchanged. Both skill handoffs used fresh generic agents because the named roles were unavailable. `git diff --check` passed.

## 2.6.30 studio workflow (18 October 2026)

- 28 affected Node tests pass, covering plate history, keyboard and touch multi-selection, removal, source-slot cleanup, preview/export placement parity, and the new geometry editor. Cut checks verify closed shared edges, opposite cap orientation, holes, volume conservation, rejected open meshes, preserved painting, untouched source resources, settings and ZIP export/readback.
- Chrome with WebGL: exercised selected-copy colouring, original-colour replacement preview/cancel, plane cutting and undo in Convert and Full Spectrum. A late asynchronous scene-list refresh defect after undo was fixed and covered by a DOM regression test. The final Full Spectrum cut/undo restored one selectable arch and its scene count.
- The saved local Flippin Pumpkin Prusa fixture loaded and rendered with original colours. A colour edit and Snapmaker conversion retained the remaining paint and compatible source settings. Private model files and exports are not deployed. The previously referenced Desktop Stabby file was unavailable, so this release does not claim a new check of that file.
- Desktop 1440 × 1000 and mobile 390 × 844 were visually checked. Mobile horizontal overflow and colour-obscuring selection tint were corrected. Selection now uses an outline. Captures show the actual WebGL model, a compact toolbar and the contextual inspector. Reduced-motion rules disable the added transitions.
- The finish-review fix batch unified toolbar Undo with Ctrl/Cmd+Z, added modifier-free Select multiple, and increased mobile controls to 44 px. Live checks verified plate undo, both split parts selected by ordinary clicks, and 44 px tool/camera target heights.
- Geometry operations are planar cuts or disconnected-part separation, not freehand curved cuts or connector generation. Unsupported assemblies, modifier volumes and cuts through subdivided support/seam paint fail before replacing the current project. No printer commands or physical-print validation were performed.

Published test deploy: `6ad49d0aec0bb0dcbe65861e` at https://workbench-test--yab3u1.netlify.app/. All 28 asset hashes and four entry points matched the build; both established sites remain outside this deployment. The live Converter opened the saved Flippin Pumpkin fixture with four used filaments.

A fresh substitute finish reviewer scored all three listed interaction fixes resolved and returned **ship** for that fix list. The documenter updated DESIGN.md and its token sidecar to the implemented workbench-only system. These handoffs substituted fresh default agents because the shipped named roles were unavailable. `git diff --check` passed.

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

## 2.6.29 interaction and palette follow-up (12 October 2026)

- Affected suite: 29 Node test cases passed, including the existing conversion (48 internal checks), race (21), assignment (15) and layout (13) scripts. New checks cover selection-aware slot cleanup, explicit filament replacement, support-reference retention, multi-selection, repeated undo, crease-aware normals and export/readback.
- Local Stabby Pumpkin check: removing the stem exported nine objects, four filaments and 2,936,801 retained triangles. No source or exported private files were uploaded. The same ten-object preview increased from 70,064 to 337,592 triangles; measured worker load/preview times were 22.755 and 22.674 seconds respectively. This is one local measurement, not a general performance guarantee.
- Live synthetic five-object fixture: removing green changed the UI and footer to four filaments; the actual worker export read back orange, black, white and yellow. The capacity block cleared and the four remaining source rows stayed available.
- Live explicit Remove filament replaced grey with red, reduced four filaments to three, and Undo restored four. Add copies, Delete and Ctrl+Z were exercised through the UI handlers.
- Convert → Full Spectrum → Convert preserved the converter epoch (no reload), quantities, active Colours panel and its 180 px scroll position. Sequential preparation remained in Layout and prepared a plate without switching colour workflows.
- At 2100 × 1200 the inspector heading occupied its full 365 px content width. At 390 × 844 neither document overflowed horizontally, and the static model retained 174 px height. Axe 4.12.1 reported 47 passes, zero violations and zero incomplete checks. Browser error collection was empty.
- All 21 published asset hashes and four entry points matched the final build. Production and the PETG test site remained outside the workbench deployment.

The browser session still had no WebGL2. The denser mesh and smooth-normal calculations were tested locally, but GPU rendering and modifier-click picking were not visually validated on the user's hardware. No printer writes or physical-print claims were made. Undo shortcuts apply to plate edits; filament removal has its own visible Undo control.
