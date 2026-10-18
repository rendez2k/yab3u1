# YAB3D Workbench test

An isolated alternative interface, v2.6.31-test. It does not replace `web/index.html`, the production build or the PETG review deployment.

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
