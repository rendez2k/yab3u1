## v2.6.37 — production Workbench, H3C and 24-colour Bambu export (4 November 2026)

- Full automated suite: 163 passed before the final picker-display fix. The final affected suite (handoff, capacity, 24-colour native archive and Workbench) passed all 32 tests after that fix and extension packaging changes.
- Official Bambu Studio 2.9.1 H3C profiles are pinned by commit. Native 0.2/0.4/0.6/0.8 mm exports of a local five-colour fixture read back all five colours; A1 and H2C 0.4 mm regression exports also passed. New tests cover all 24 Bambu paint IDs and retained support assignments.
- Live Chrome: H3C defaults to nine inputs, selecting 24 persists after changing from 0.4 to 0.6 mm, and the 330 × 320 × 325 mm build volume and native-profile confirmation agree. The tested sample is the public four-colour arch.
- Extension 1.5.3.7 has versioned source, a reproducible package, unchanged host permissions, a production-only YAB3D handoff and an updated public privacy page. Sender tests reject wrong origins, source windows and tokens, and retain the original model bytes. All extension JavaScript parses. Store submission evidence is recorded in CHROMEWEBSTORE.md.
- Builds publish only the generated Workbench assets plus the explicitly named privacy page and extension ZIP. Private models, local exports and docs/agent-work are excluded.
- These checks validate application behaviour and exported archives. They do not establish physical colour accuracy, mechanical connector fit or sliced collision clearance. The Full Spectrum research document proposes later work; its experimental algorithms are not part of this release.

## 2.6.36 unsuccessful split handling (19 October 2026)

- Reproduced the user's two original snowman 3MFs locally. The previous scan skipped every black/red/green colour with more than 32 connected patches; the Elegant snowman's orange nose also rejected the default 3 mm connector.
- A no-change automatic result now returns before source loading, history creation, filling or plate preparation. Regression checks cover all three finish choices in Convert and Full Spectrum, preserving the exact source, copies, quantities and available controls.
- Colours with more than 32 regions now check their largest 32 by surface area. The remaining patches are explicitly reported. Existing boundary, cap-volume and connector checks stay enforced. A synthetic closed-solid regression verifies both protrusions still detach amid 33 flat patches, with manifold output, conserved volume and unchanged input.
- Chrome/WebGL with the real green snowman and sequential filling selected: the scan returns no detachable parts, retains one snowman, keeps the Split inspector and reports “Filling was not started.” No prepared view or Undo entry is created. Screenshot: local ignored `docs/agent-work/snowman-no-split-2.6.36.png`.
- Direct processing of the real Elegant snowman with 1.5 mm pin diameter/length and 0.2 mm clearance separates the orange nose and one black detail, leaving the hat/bow tie and other paint on the body. The planner can create balanced sequential detail groups and a by-layer body job. This remains a partial example, not a full colour split or a physical fit/clearance claim. The green snowman's boundaries remain unsupported even after checking its larger regions.
- 37 affected tests passed. After tightening the progress text to show the bounded scan count, all 21 directly affected tests passed again. The build succeeds with the existing Python packaging step. User models and diagnostic files remain local and excluded from the static build.

Published test deploy: `6ad65b83c4475e4fe75f49ae` at https://workbench-test--yab3u1.netlify.app/. The four checked application scripts and both shell entry points match the build byte-for-byte. Both embedded entry pages match after Netlify's observed anchor-link formatting/pretty-URL rewrites. The live 2.6.36 workspace mounts successfully. `git diff --check` passed.

## 2.6.35 prepared plate previews (19 October 2026)

- Prepared jobs now have a separate 3D view using the actual exported object selection, placement plan and output palette. The plate picker and inspector agree on the selected job; Edit model preserves the editable source quantities and Undo. Preview loading, retry, stale replies and source invalidation are handled without replacing the source file.
- The regression suite passed 154 tests. A further calibrated Full Spectrum blend-colour check was added, and all 17 affected tests passed after the final palette update (155 distinct tests). Preview/export checks compare placed vertices and paint against re-read sequential and separate-colour archives within 0.002 mm serialization tolerance.
- Chrome/WebGL with the user's exact local `Flippin Pumpkin flat bottom painted.3mf`: automatic splitting retains the body and separates the green stalk. With the selected layout allowances, preparation produces seven bodies on a by-layer plate and seven stalks on a sequential plate. Both prepared views show all seven copies. Edit model returns to one body and one stalk; Ctrl+Z restores the original unsplit object. Delete in the read-only prepared view does not remove source objects.
- Full Spectrum browser check: the built-in sample separates with a pin and retains the export-colour review requirement. After applying and reviewing its palette, Prepare plates resumes the pending complete-set fill and displays six matching sets (twelve parts) on the sequential plate.
- The current geometry checks reject the black and white regions. The visible result now names those retained colours and explains that they remain attached when the body is duplicated. It does not claim the hands or arms were detached.
- The initial frame stays concealed until the workspace is composed; edit reloads retain their inspector instead of visiting Project. The progress curtain coalesces brief internal loading transitions. The first live check caught an embedded startup stall with `display:none`; the frame now remains in layout with `visibility:hidden` until ready. The corrected live workspace mounted successfully without exposing the legacy page, and all 17 affected tests passed again.
- A single desktop/mobile capture round shows the complete prepared result at 1440 × 840 and 390 × 844. The compact plate controls and Edit model remain reachable. One detector pass reported the inherited help-dialog border/shadow advisory. Private fixtures, exports, local harness and captures remain excluded from Git and deployment.
- The fresh substitute finish reviewer returned **ship**, with no material fixes, after reviewing the user's contradictory screenshot and the new full-plate captures. The fresh substitute documenter confirmed the incumbent system still applies and made no changes. Both used generic agents because the named skill roles were unavailable.
- Sequential grouping remains a planning layout, requiring slicer head/gantry clearance checks. No physical print or connector-fit claim is made.

Published test deploy: `6ad64ae884db69d61420e843` at https://workbench-test--yab3u1.netlify.app/ after the user's explicit publication approval. All 35 deployed asset hashes and four entry points match the tested build; both established sites still serve their existing interfaces. `git diff --check` passed.

## 2.6.34 automatic separation and complete-set filling (19 October 2026)

- Automatic splitting checks each connected paint region, retains the largest painted region as the body, and preserves unsafe regions with a reason. Closed disjoint solids may be separated; reversed cavity shells remain with the body. Pins are optional and default to upward orientation. A flat painted patch must have positive solid volume before any connector is added, preventing a pin from making an otherwise empty patch pass validation.
- The regression suite passed 148 tests. A subsequent Full Spectrum browser check exposed asynchronous measurement finishing after the edit promise. The workbench now waits for measured footprints before fitting; all 17 affected tests, including the new stale/missing-measurement regression, pass (149 distinct tests in total).
- New checks cover multiple colours and same-colour regions, manifold edges, volume and source immutability, oversized connectors, inner cavities, source paint/settings, archive readback, balanced complete sets, preserved sibling quantities, zero-quantity objects, no-fit feedback, colour-review retry and controls without WebGL.
- Chrome/WebGL: the cached flat-bottom pumpkin separates its stalk automatically and Undo restores one object. The original local Prusa pumpkin prepares seven stalks in a sequential job and seven multicoloured bodies in a separate by-layer job under the browser's current layout allowances. The scan retains wrapping black regions and white regions with unsuitable boundaries. It does not claim to detach those arms or hands.
- Convert and Full Spectrum both split and fill the built-in synthetic sample with seven matching bodies and stalks. One model Undo restores the unsplit sample. Sequential mode prepares six matching sets of that sample as two same-colour slicer groups on one plate; its download action was exercised. A separate source-level private diagnostic fitted twelve pumpkin sets under its different planning allowances; counts depend on the selected layout, not a fixed model maximum.
- Desktop and 390 px mobile captures show the actual shared Full Spectrum result and its balanced quantities. One detector pass found one inherited border/shadow advisory. Private source geometry, diagnostic exports, browser harness and screenshots are excluded from the deployment and Git.
- Filling searches up to 64 copies per part and keeps unrelated quantities. Sequential filled quantities belong to the prepared jobs; the workspace still shows the original quantities, as the success message states. Prepared jobs preserve compatible settings and require slicer clearance checks. No physical connector-fit, stability or print-success claim is made.

The fresh substitute finish reviewer returned **ship**, with no material fixes. The fresh substitute documenter confirmed the incumbent system still applies and made no changes. Both were generic agents used for the skill's unavailable named roles. `git diff --check` passed; the built directory contains no private fixtures or diagnostic files.

Published test deploy: `6ad63ea727ccc49edf4fb0ed` at https://workbench-test--yab3u1.netlify.app/. All 34 deployed asset hashes and four entry points match the tested build; both established sites still serve their existing interfaces.

## 2.6.33 sequential preparation regression (18 October 2026)

- Reproduced the reported failure on the real local Flippin Pumpkin Prusa source after separating its green stalk with a connector. Prusa's ordinary `ModelPart` volume role survived the edit and was incorrectly rejected as a modifier. New edits and native exports now normalise printable roles to `normal_part`; cached, previously split archives also work without repeating the edit. Genuine modifier volumes, per-part overrides and conflicting object settings remain rejected.
- The affected and regression suite ran 141 tests. 140 passed in the sandbox; the single Python-spawning optimiser runner failed to launch there and passed when rerun with process permission. New checks cover Prusa aliases, unchanged geometry and painting, source print settings, real part-override rejection, and preparation failure followed by successful retry.
- The cached real split archive now produces a sequential green-stalk job and a separate multicolour by-layer job. Both archives were read back: native part roles, sequence, colours and compatible support/layer settings were retained. The private source, diagnostic harness and generated files remain local and are excluded from Git and deployment.
- Chrome/WebGL exercised the actual worker with that cached archive: two prepared jobs appeared and Download this plate succeeded. Desktop 1440 × 1000 and mobile 390 × 844 captures show feedback immediately below Prepare plates, a reachable download action and the loaded model. Worker geometry/compression messages also reach the shell status line. Failure clears partial downloads and busy state, and re-enables preparation.
- One detector pass found the inherited border/shadow advisory and the static fallback image's initially absent `src`. That fallback is hidden until a generated object URL is assigned, so it is not a visible broken image; the checked WebGL captures show the model. No stylesheet or design-system change was needed.
- These checks establish export and UI behaviour, not physical sequential clearance or print success. The existing slicer Arrange/Slice check remains necessary.

Published test deploy: `6ad4f38e006e11d47ee3e39c` at https://workbench-test--yab3u1.netlify.app/. All 32 deployed asset hashes and four entry points match the tested build; the established production and PETG sites remain outside this deployment.

The fresh substitute finish reviewer returned **ship**, with no material fixes. The substitute documenter confirmed the incumbent design system still applies and made no system changes. Both used generic agents because the named skill roles were unavailable. `git diff --check` passed.

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
