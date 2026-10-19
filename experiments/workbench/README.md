# YAB3D Workbench test

An isolated alternative interface, v2.6.36-test. It does not replace `web/index.html`, the production build or the PETG review deployment.

## 2.6.36 unsuccessful splits and paint patches

If automatic separation finds no detachable parts, all finish modes leave the source and quantities unchanged. No reload, fill, prepared plates or Undo entry is created. The split controls remain available with the actual rejection reasons.

Colours with many disconnected paint patches now have their 32 largest regions checked, instead of skipping that colour entirely. Smaller patches remain attached and are reported. Malformed boundaries are rejected before scanning the whole mesh again. Geometry and connector safety checks are unchanged.

The real snowman fixtures are not complete colour-splitting examples. The green snowman remains intact. With 1.5 mm diameter/length pins and 0.2 mm clearance, the Elegant snowman detaches its orange nose and one black detail; its hat and bow tie remain on the body. This is a limited geometry test, not evidence of connector fit or sequential head clearance.

## 2.6.35 prepared plate previews

Preparing separate colour or sequential plates opens their actual placement plans in the 3D canvas. The plate picker and inspector rows switch between jobs, showing the full copy count and output colours. The by-layer body plate opens first when present. Edit model returns to the source quantities; it never reloads an exported job into the editable session. Model edits invalidate prepared jobs, and Undo still restores the original split. Preview loading and failures are visible, stale replies are discarded, and browsers without WebGL receive a labelled static preview.

Automatic split results now state which colours still have attached regions before their detailed reasons. The supplied flat-bottom pumpkin separates only its green stalk; its black and white paint boundaries are not supported by the conservative automatic splitter. Filling duplicates that retained multicoloured body.

The engine frame stays hidden until its workbench UI is mounted. A stable loading surface covers intermediate geometry, and model-edit reloads keep the current inspector instead of visiting Project.

```powershell
cd experiments/workbench
npm ci
npm test
npm run build
```

The build writes `dist-workbench/`. Deploy that directory to the `workbench-test` Netlify alias. `tools/build_site.py` and the established deploy remain unchanged.

## Structure

- `index.html`, `workbench.js`, `workbench.css`: persistent project bar, task navigation, colour-mode switch and primary action.
- `view-layout.js`: moves the actual existing feature controls into Project, Colours, Layout, Output and Help. No duplicate IDs or substitute controls.
- `engine-view.js`: narrow same-origin adapter. One lazy frame per colour mode retains its worker and experiment; source bytes remain local.
- `engine-view.css`: inspector, model stage, responsive layout and consistent control styling.
- `build.mjs`: packages the existing engines plus this interface and its self-hosted OFL font.

The original controllers expose narrow exports for this adapter. Their established entry points do not opt into the alternative layout or static preview.

## Behaviour

**Split → Automatic** checks disconnected solids and individual painted regions in one pass. It keeps the largest painted region as the body and detaches only regions the geometry checks can close. Optional locating pins face upwards. A result summary lists retained regions and their reasons; a failed candidate does not remove its geometry.

Choose **Keep one set of parts**, **Fill one plate with complete sets**, or **Fill sequential colour-group plates**. Filling keeps matching quantities of every selected model's separated pieces, retains unrelated quantities and searches up to 64 copies per part. It uses the current printer and layout allowances; it is a bounded packing estimate. Sequential preparation fits the same number of sets across the single-colour sequential job and the multicolour by-layer job, then provides validated 3MF downloads. The workspace keeps its original quantities for this export-only option. Slicer head-clearance checks still apply. Split-and-fill shares one model Undo.

Select an object on the model or by name, enter the number of **new copies**, then choose **Add copies**. **Fill with this object** searches for room for that object without changing sibling quantities; it repacks objects using the current bed, tower, support and spacing allowances. This is a conservative fit, bounded to 64 copies per object, not a certified maximum. Undo restores the prior counts. **Fill with whole sets** remains in Layout and repeats the entire current parts list.

The compact preview toolbar groups view controls separately from object editing. A visible spinning indicator and elapsed timer cover model loading, measurement and preview drawing. Colour replacement, part filtering and sequential slicer groups have separate explanations and labels.

First entry into the other mode carries the original source, selected plate, destination, copies, quantities, layout and PETG reservation. Revisiting an existing experiment retains its edits; it does not silently overwrite them. Work is not persisted after closing the tab. Help explains this distinction.

The existing WebGL preview supplies orbit, zoom, object selection and the planning bed. Where WebGL2 is unavailable, the worker's existing software renderer generates an explicitly labelled static image. Object quantities remain editable under Layout. No slicer time, clearance or printed-colour accuracy is inferred from either preview.

Chrome installation instructions and the existing ZIP remain in Help → Tools & information. That ZIP still opens the established review app, which the interface states explicitly. The workbench's original-file receiver supports compatible handoffs.

The generated arch and green-stalk samples are synthetic. Private user models are not included in the deploy.

## 2.6.29 interaction changes

Colours → Convert has an explicit **Remove filament** action. Choose the replacement for any remaining painted regions; undo restores the previous mapping. Removing the last object that uses a filament removes that filament from the plate and export. Numbered support/infill references and uncertain paint are retained conservatively.

Shift-click adds copies to the 3D selection, Ctrl/Cmd-click toggles them, Ctrl/Cmd+A selects all visible copies, and Delete removes the selection. Ctrl/Cmd+Z restores up to 30 plate edits; text inputs keep their native editing shortcuts. The toolbar offers the same quantity actions without a keyboard.

Colour workflows are selected in Colours. Revisiting an existing mode restores its panel and scroll position without reloading the source. Sequential preparation is the main action when enabled in Layout. App commands are consolidated into the top-right menu.

Workbench previews use a bounded 600,000-triangle plate budget and crease-aware normal smoothing. These are preview-only opt-ins; geometry and paint in exports are untouched.

## 2.6.30 studio workflow

The light canvas, floating Select / Colour / Split / Arrange toolbar and contextual inspector follow the user's supplied editor references. The primary export action stays in the header. Selected geometry has a thin outline, keeping its filament colours visible. Mobile layout keeps the canvas above the independently scrolling inspector; reduced-motion disables transitions.

**Colour** previews a whole selected copy or replacement of one existing paint colour on the selection. Apply writes independent mesh resources, preserving unselected copies and the remaining paint. The edit preview uses original paint; export palette substitutions still apply afterwards. **Split** offers an axis-aligned plane cut with closed caps (including holes), or separation of disconnected shells. Resulting parts sit on the bed and can immediately be recoloured, duplicated, removed or packed. The original 2.6.30 release did not include connectors; see the next section for colour separation and joints. Nested assemblies, modifier volumes and cuts through subdivided support/seam painting are rejected with an explanation.

The tool-island Undo button and Ctrl/Cmd+Z share one action: undo plate changes, then the most recent model edit. Its label identifies the next kind of edit. Six model snapshots are held in memory. Select multiple enables touch selection on the canvas and object list. A new source clears model undo. Worker edits can be cancelled before the validated archive begins loading; controls are locked during that final load. Source and export print settings are retained through edits.

Geometry edits are implemented in workbench-only workers. The common engine exports are adapter hooks; production entry points do not activate the studio tools, light stage or selection outline. Earcut 3.0.2 supplies cap triangulation under ISC; its licence ships alongside the vendor module.

## 2.6.31 colour separation and locating joints

Choose a model, open **Split → By painted colour**, and select the source-colour swatch. **Keep both parts** detaches that region and closes both surfaces; **Remove this coloured part** closes the remaining model and omits the selected region. This follows the actual paint boundary, so a protruding green stalk does not require finding a Z cut height. Flat paint patches and boundaries that cannot safely become closed solids are rejected before the project changes.

**Add locating pin & socket** makes an integral cylindrical pin on either part and a matching blind socket in the other. Diameter, length and fit clearance are configurable. Clearance is added to the socket diameter, with 0.2 mm extra depth. Placement is automatic and conservatively checked against available material. Both parts use the same mating surface, including a slightly curved seam. Plane cuts can use the same joint. This is a locating/glue joint, not a tested snap fit; print a small fit test for your material and printer.

In **Select**, colour buttons select all single-colour objects using that original filament; Remove or Delete then removes the selected copies. Unknown paint is excluded. Attached coloured regions use Split instead. The same tools work in Convert and Full Spectrum, share model Undo, and keep Apply and Cancel visible while the settings scroll. The empty canvas includes **Try separating a green stalk** for a generated example.

## 2.6.32 orientation, regions and plate preparation

**Orient pins upwards** is on by default when adding a connector. It rotates the part carrying the pin and places it on the bed; turn it off to retain its original rotation. This is pin orientation, not a general stability or support optimiser. Check the contact area and generated supports in the slicer.

After choosing a painted colour, choose its **Painted region**. Disconnected areas of the same colour are listed separately, so an arm does not automatically select the eyes. The preview highlight is approximate; the edit uses the exact connected painted faces. Invalid boundaries are explained and cannot be applied. For the local pumpkin fixture, the green stalk separates, but the black regions wrap around the surface and the two main white hands have inconsistent paint edges. They still require editing in a slicer; this release does not claim automatic separation of those parts. Choosing black never includes white by default.

In **Arrange → Print layout**, choose **Separate plates by colour** for one 3MF per single-colour group, with multicoloured or PETG-interface objects on another by-layer plate. **Sequential colour groups** puts each single-colour group into one logical slicer object and prepares a separate by-layer plate for multicoloured objects. Quantities, individual meshes and compatible settings are retained. Download jobs individually or together. All jobs initially use the chosen printer setup; change the printer in the destination slicer when sending a job to another machine. Sequential spacing is a planning allowance, and the slicer must validate head and gantry clearance. There is no guaranteed time saving.

## 2.6.33 sequential preparation fix

Prusa normal volumes (ModelPart) are now normalised to the native normal_part role, including previously split archives. They no longer trigger a false modifier rejection. Genuine modifiers, differing object settings and part-specific overrides remain checked. Preparation progress, failures and ready-to-download feedback appear directly below Prepare plates and in the workbench status line. Failure clears the busy indicator and leaves preparation available to retry.
