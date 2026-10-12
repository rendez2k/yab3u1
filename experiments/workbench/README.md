# YAB3D Workbench test

An isolated alternative interface, v2.6.29-test. It does not replace `web/index.html`, the production build or the PETG review deployment.

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

The generated arch sample is synthetic. Private user models are not included in the deploy.

## 2.6.29 interaction changes

Colours → Convert has an explicit **Remove filament** action. Choose the replacement for any remaining painted regions; undo restores the previous mapping. Removing the last object that uses a filament removes that filament from the plate and export. Numbered support/infill references and uncertain paint are retained conservatively.

Shift-click adds copies to the 3D selection, Ctrl/Cmd-click toggles them, Ctrl/Cmd+A selects all visible copies, and Delete removes the selection. Ctrl/Cmd+Z restores up to 30 plate edits; text inputs keep their native editing shortcuts. The toolbar offers the same quantity actions without a keyboard.

Colour workflows are selected in Colours. Revisiting an existing mode restores its panel and scroll position without reloading the source. Sequential preparation is the main action when enabled in Layout. App commands are consolidated into the top-right menu.

Workbench previews use a bounded 600,000-triangle plate budget and crease-aware normal smoothing. These are preview-only opt-ins; geometry and paint in exports are untouched.
