# YAB3D Workbench test

An isolated alternative interface, v2.6.27-test. It does not replace `web/index.html`, the production build or the PETG review deployment.

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

First entry into the other mode carries the original source, selected plate, destination, copies, quantities, layout and PETG reservation. Revisiting an existing experiment retains its edits; it does not silently overwrite them. Work is not persisted after closing the tab. Help explains this distinction.

The existing WebGL preview supplies orbit, zoom, object selection and the planning bed. Where WebGL2 is unavailable, the worker's existing software renderer generates an explicitly labelled static image. Object quantities remain editable under Layout. No slicer time, clearance or printed-colour accuracy is inferred from either preview.

Chrome installation instructions and the existing ZIP remain in Help → Tools & information. That ZIP still opens the established review app, which the interface states explicitly. The workbench's original-file receiver supports compatible handoffs.

The generated arch sample is synthetic. Private user models are not included in the deploy.
