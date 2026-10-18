---
name: YAB3D Workbench studio
description: Implemented visual system for experiments/workbench v2.6.30-test only.
colors:
  paper: "#f1f3f5"
  panel: "#fff"
  panel-secondary: "#f3f5f6"
  canvas: "#f5f6f7"
  ink: "#22282c"
  muted: "#626c73"
  line: "#e1e5e8"
  accent: "#246b50"
  soft: "#e8f2ed"
  on-accent: "#fff"
  focus: "#246b50"
  hover-line: "#9ba9a2"
  selection: "#cde9db"
  selection-ink: "#182d23"
  error: "#ac2727"
  dark-paper: "#191d20"
  dark-panel: "#252a2e"
  dark-panel-secondary: "#30363b"
  dark-canvas: "#171a1f"
  dark-ink: "#f0f3f5"
  dark-muted: "#b0bbc2"
  dark-line: "#3b444a"
  dark-accent: "#a0ddbf"
  dark-soft: "#324c40"
  dark-on-accent: "#15251d"
  dark-focus: "#a0ddbf"
  dark-hover-line: "#a0ddbf"
  dark-error: "#ff9d91"
typography:
  display:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "clamp(28px,3.6vw,43px)"
    fontWeight: 550
    lineHeight: 1.12
    letterSpacing: "-.03em"
  headline:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-.025em"
  brand:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 700
    letterSpacing: "-.02em"
  body:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  shell-body:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.45
  title:
    fontSize: "14px"
    fontWeight: 700
    letterSpacing: "0"
  control:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  header-action:
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontSize: "12px"
    letterSpacing: "0"
  metadata:
    fontSize: "11px"
  hint:
    fontSize: "12px"
    lineHeight: 1.55
rounded:
  flat: "0"
  tag: "5px"
  view-control: "6px"
  view-group: "7px"
  control: "8px"
  navigation: "10px"
  floating: "12px"
  workspace: "16px"
spacing:
  list-gap: "3px"
  tool-gap: "4px"
  field-gap: "5px"
  action-gap: "8px"
  row-gap: "12px"
  inspector-group: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.header-action}"
    rounded: "{rounded.control}"
    padding: "9px 18px"
  button-secondary:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  button-selected:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  nav-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.accent}"
    rounded: "{rounded.navigation}"
    padding: "11px 3px"
  tool-island:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.floating}"
    padding: "5px"
  tool-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  test-label:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    typography: "{typography.metadata}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
  inspector-group:
    rounded: "{rounded.flat}"
    padding: "0"
  object-row-selected:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "10px"
---

# Design System: YAB3D Workbench studio

## Overview

**Creative North Star: "The Working Studio"**

This document governs only `experiments/workbench`, the separate **v2.6.30-test** interface and its `dist-workbench` build. The production `web` UI retains its incumbent system. These tokens do not authorise production restyling. The approved surface direction is recorded in `experiments/workbench/STUDIO-BRIEF.md`; the broader workflow contract remains in `docs/workbench-direction.md`.

A pale model canvas occupies most of the workspace. Neutral white controls, cool grey surroundings and restrained green states keep the model visually central. A compact floating tool island and a quiet contextual inspector give editing controls a stable place. IBM Plex Sans now carries headings, body copy and controls. The YAB3D name, existing mark and UK English remain the durable identity commitments from `PRODUCT.md`.

**Key Characteristics:**

- Cool neutral-white surfaces and a large pale model canvas.
- Green action, selection and focus states.
- One floating model-tool island and a scrolling contextual inspector.
- Compact Plex typography, modest rounded controls and soft structural shadows.

The normative values come from `studio.css`, loaded after `workbench.css` in the shell and after `engine-view.css` in each engine frame. Older warm/orange declarations in those base stylesheets are superseded for this surface. The semantic error colours remain inherited. Component behaviour comes from `index.html`, `workbench.js` and `studio-tools.js`.

The supplied finish-review disposition is **ship**, scoped to the resolved unified Undo control, touch multiselection and 44px mobile targets. Final evidence is `.impeccable/review/desktop.jpg` and `mobile.jpg`. This records that review scope; it is not a new whole-product or physical-print certification.

## Colors

### Primary

Studio green (`accent`) marks the main header action, active tools, selected objects and keyboard focus. Pale green (`soft`) supplies the selected fill. White `on-accent` keeps the primary action legible. Dark mode uses the corresponding `dark-*` mappings, including dark ink on its lighter green action fill.

### Neutral

Cool grey `paper` surrounds the workspace. White `panel` holds the inspector and floating controls; `panel-secondary` gives fields a quiet inset fill. `canvas` is the pale model stage. `ink`, `muted` and `line` provide the text and divider hierarchy. Text selection has its own green tint and dark text. Error colours remain semantic feedback, not a second interface accent. Model and filament colours are content and may use the full spectrum.

**The Shared Palette Rule.** Read the studio override as the shell and engine colour authority; do not reintroduce the superseded orange action or charcoal light-mode stage from the base stylesheets.

## Typography

The complete interface uses self-hosted **IBM Plex Sans**, registered as `Plex`, with Segoe UI and sans-serif fallbacks. `build.mjs` copies the Latin variable WOFF2 from `@fontsource-variable/ibm-plex-sans` to `fonts/plex-sans.woff2` and its OFL licence to `fonts/OFL.txt`. The face declares normal style, weights 100–700 and `font-display: swap`.

The display role introduces an empty stage; the headline role names the current inspector task. Section titles and labels remain compact, sentence case and free of decorative tracking. Shell and engine body line heights remain distinct. Task explanations use the smaller label size and a 1.5 line height; hints use the frontmatter's hint role. Numeric fields use tabular numerals. Functional metadata and narrow navigation labels resolve to 11px. At the stacked breakpoint, the empty-stage headline becomes 26px while inspector headlines remain 20px.

## Layout

The desktop shell has a 66px header, a flexible workspace and a 30px status strip. Its side navigation is 76px wide. The remaining workspace has a 16px clipped outer radius and 12px right inset. The engine divides into a model column of `minmax(280px,1fr)` and a 330px inspector. The inspector owns scrolling and uses `24px 22px 30px` section padding.

The tool island floats at the top centre of the canvas, 18px below its edge. The view controls sit 20px from the lower-left corner. The main project action lives in the header, with the app menu beside it; its label follows project readiness and may be Apply palette or an export action. The status strip stays visible below the workspace.

At 1050px in the engine frame, the inspector becomes 300px wide, its section padding becomes `22px 18px`, and the tool island moves to a 12px top inset. At 760px, the engine stacks: the stage takes 48% with a 205px minimum, above the scrolling inspector. Inspector padding becomes `22px 20px`; the tool island and view controls use 10px and 12px edge insets respectively. The floating tool buttons, view controls, scene rows, multiselect control and navigation receive 44px minimum touch targets; header action and app-menu summary receive 44px minimum heights.

At 900px in the outer shell, the header's project title is hidden by the inherited compact rule. At 560px, the shell uses a 54px header and 27px status strip, an 8px horizontal workspace inset, and a horizontal bottom task navigation. The workspace radius becomes 12px. Tool labels remain visible while their icons are hidden, except for Undo. Shell and frame breakpoints operate in their own coordinate spaces.

## Elevation & Depth

Depth distinguishes controls floating over the model from the model itself. Inspector groups remain flat, unboxed and shadowless. Selected side navigation, the tool island and view controls use the `studio-shadow` token (`0 4px 18px #172c3810`); dark mode uses `0 4px 18px #0003`. The app-menu popup uses `0 8px 32px #172c3824`, progress uses `0 6px 28px #172c3820`, and Help retains `0 20px 70px #0004` over a `#151911aa` backdrop. These values are also recorded in the sidecar because the frontmatter schema cannot express shadows.

Buttons change colour over 140ms and use the studio easing curve (`cubic-bezier(.16,1,.3,1)`) for 180ms shadow and press transitions. An active button moves down 1px and scales to .98. Context panels arrive over 220ms from a 5px horizontal offset and .4px blur. The existing progress orb spins over 1s. Reduced-motion disables animation, transitions and smooth scrolling throughout the studio.

**The Floating Controls Rule.** Reserve soft structural elevation for controls over the canvas and transient surfaces; keep inspector groups flat.

## Shapes

Controls share the gently rounded `control` radius. Side-navigation selection is slightly broader; floating islands and popups use `floating`, and the main workspace uses `workspace`. The test label is compact and borderless. View controls form a joined group with smaller radii. Most hierarchy comes from spacing and surface tone; borders remain for focused or selected states, separators and drop targets. Tool and navigation icons are simple inline strokes.

## Components

### Buttons and header action

The header primary action uses green fill, contrasting text, semibold type and a 150px desktop minimum width. Hover brightens it to 1.08. Inspector secondary buttons use the inset surface with a transparent border. Selected inspector controls use pale green, green text and an inset 1px accent outline. General button hover adds `0 2px 5px #172c3810`; disabled controls use half opacity and a not-allowed cursor. Desktop controls have a 36px minimum height unless their specific component overrides it.

### Inputs / Fields

Inspector number, text, password and select fields use an inset fill, a transparent single-pixel border, the control radius and a 36px minimum height. Labels sit above or alongside their field according to the compact property row. Keyboard focus is a 2px accent outline with a 3px offset for buttons, links, summaries, inputs and selects. Checkboxes and ranges use the accent; native field semantics remain intact.

### Navigation and tool island

The side navigation pairs line icons with visible Project, Colours, Layout and Output labels. `aria-current="page"` gives the selected item a white raised surface and green text. Its mobile form is a bottom row.

The floating tool island holds Select, Colour, Split and Arrange, followed by a separated Undo icon. Active tools use `aria-pressed`, pale green fill and green ink. All four modes operate on the same selection; Arrange opens Layout. A single Undo button and Ctrl/Cmd+Z undo plate history first, then model edits. Its accessible name identifies the next undo type, and it is disabled when no edit is available or work is busy.

### Contextual inspector and object list

The inspector exposes controls for the current task and selection. Only a selected Colour or Split operation exposes Apply and Cancel. Selecting another tool restores an unapplied preview. The visible Select multiple toggle lets touch users add or remove selections on the canvas or in the object list; Shift and Ctrl/Cmd remain keyboard alternatives. Selected scene rows use the pale-green state, with a count aligned right. Busy work exposes a progress message and disables conflicting controls.

Convert and Full Spectrum remain persistent controls in the Colours inspector. They preserve their own colour experiments until an applied model edit supplies a new source revision. Keep contextual explanations near consequential choices without stacking instruction bands above the canvas.

### Tags and inspector groups

The white Test version tag is non-interactive metadata. Inspector groups have no card chrome: headings, spacing and occasional separators carry hierarchy. App-wide actions such as Open model, Batch, Help and theme switching live in the app menu.

### Model stage and assets

The normal model stage is interactive WebGL. Where WebGL2 is unavailable, the software renderer supplies an explicitly labelled static preview; unavailable camera controls remain hidden. Neither mode establishes slicer clearance, timing or printed-colour accuracy.

The sole reused brand raster is `web/assets/yab3d-mark-96.png`, packaged at `assets/yab3d-mark-96.png` unchanged. Model imagery is user-supplied or runtime-rendered synthetic demonstration content; the support arch is synthetic. No generated decorative raster or third-party reference screenshot ships with this direction. Review captures are evidence, not product assets.

## Do's and Don'ts

- Do apply these tokens only to the separate Workbench studio.
- Do preserve visible focus, selection, status and the inspector's independent scrolling.
- Do keep the four model tools together and use the shared Undo action.
- Do retain touch multiselection and the implemented 44px mobile targets.
- Do retain the existing YAB3D mark, self-hosted Plex font and OFL licence.
- Do label software-rendered previews as static and demonstration models as synthetic.
- Don't apply the studio palette to the production UI without a separate approved change.
- Don't restore the old orange controls or charcoal light-mode stage from superseded base CSS.
- Don't add duplicate action bars, decorative cards or decorative raster imagery to this workbench direction.
- Don't treat model previews as proof of physical print results.
