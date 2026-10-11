---
name: YAB3D Workbench preview
description: Visual system for experiments/workbench v2.6.27-test only.
colors:
  paper: "#f7f6f2"
  panel: "#fffefa"
  panel-secondary: "#f1f0eb"
  ink: "#282922"
  muted: "#65665e"
  inspector-dim: "#62645b"
  line: "#d8d8d0"
  accent: "#ad3f16"
  soft: "#f6e8df"
  focus: "#b44418"
  error: "#ac2727"
  selection: "#f0bb96"
  stage: "#202420"
  stage-ink: "#edf0e5"
  stage-control: "#30382f"
  stage-control-line: "#596251"
  stage-control-ink: "#eef2e9"
  stage-selected: "#e9ede0"
  stage-selected-ink: "#272d23"
  stage-muted: "#bfc8b7"
  dark-paper: "#222520"
  dark-panel: "#2a2e28"
  dark-panel-secondary: "#33392f"
  dark-ink: "#f2f2e9"
  dark-muted: "#bbbfb3"
  dark-inspector-dim: "#bbc0b2"
  dark-line: "#4b5146"
  dark-accent: "#ef9b6b"
  dark-soft: "#4b362b"
  dark-focus: "#ffb28c"
  dark-on-accent: "#20231e"
  dark-error: "#ff9d91"
typography:
  display:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "clamp(26px,3vw,44px)"
    lineHeight: 1.12
    letterSpacing: "-.03em"
  headline:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "23px"
    lineHeight: 1.2
    letterSpacing: "-.03em"
  brand:
    fontFamily: 'Plex, "Segoe UI", sans-serif'
    fontSize: "17px"
    letterSpacing: "-.02em"
  body:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  shell-body:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    lineHeight: 1.45
  title:
    fontSize: "16px"
    letterSpacing: "0"
  control:
    fontSize: "13px"
    fontWeight: 500
  control-primary:
    fontWeight: 600
  label:
    fontSize: "12px"
    letterSpacing: "0"
  hint:
    fontSize: "12px"
    lineHeight: 1.55
rounded:
  flat: "0"
  test-label: "3px"
  stage-control: "5px"
  control: "6px"
  dialog: "12px"
spacing:
  field-gap: "5px"
  action-gap: "8px"
  row-gap: "12px"
  drop-padding: "16px"
  inspector-group: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    typography: "{typography.control-primary}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-secondary-hover:
    backgroundColor: "{colors.soft}"
  button-stage:
    backgroundColor: "{colors.stage-control}"
    textColor: "{colors.stage-control-ink}"
    rounded: "{rounded.stage-control}"
    padding: "5px 9px"
  input:
    rounded: "{rounded.control}"
    padding: "7px 10px"
  nav-selected:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "10px 2px"
  test-label:
    rounded: "{rounded.test-label}"
    padding: "3px 6px"
  inspector-group:
    rounded: "{rounded.flat}"
    padding: "0"
---

# Design System: YAB3D Workbench preview

## Overview

**Creative North Star: "The Working Studio"**

This document governs only `experiments/workbench`, the separate **v2.6.27-test** preview and its `dist-workbench` build. The production `web` UI remains the incumbent system; this root document does not authorise restyling it. The direction and workflow contract remain in `docs/workbench-direction.md`.

Warm paper surrounds a charcoal model stage. Burnt orange identifies action and selection; restrained borders and compact controls support practical model work. IBM Plex Sans gives the headings a distinct voice while familiar platform typography carries the controls. The YAB3D name, existing mark and UK English are durable identity commitments from `PRODUCT.md`.

**Key Characteristics:**

- Warm inspector surfaces and a charcoal model stage.
- Restrained orange action and selection states.
- Compact, gently rounded controls with explicit focus feedback.
- Flat inspector groups with typographic hierarchy.

Tokens were extracted from `experiments/workbench/workbench.css` and `engine-view.css`; component structure comes from `index.html`. Literal values are recorded as used, including the slightly different shell and inspector muted colours. No tonal scale or motion system was invented.

The final review handoff reported **ship**, scoped to all three listed fixes being resolved: mobile feedback stays visible, the 0.6 mm nozzle persists in both control and state, and the corrected h2 hierarchy has zero axe violations in the checked views. Evidence paths are `.impeccable/review/desktop.png` and `mobile.png`. This records the supplied verdict; it is not a new whole-surface or physical-print certification.

## Colors

### Primary

Burnt orange (`accent`) marks the main action and selected navigation. The warm tint (`soft`) supplies selected and hover backgrounds without filling whole panels with accent colour. `focus` is a separate outline colour. Dark mode uses the corresponding `dark-*` tokens, with `dark-on-accent` for inspector primary-button text.

### Neutral

`paper` is the outer shell, `panel` the inspector and controls, and `panel-secondary` the inset/log surface. `ink`, `muted`, `inspector-dim` and `line` provide the text and divider hierarchy. The stage keeps its own charcoal, light ink and green-grey control palette in both themes. Error tokens are semantic feedback, not a second brand accent.

**The Source Palette Rule.** Preserve the shell and inspector token mappings from their own stylesheets; do not normalise their distinct muted or dark action-text colours during unrelated work.

## Typography

The display and main task headings use self-hosted **IBM Plex Sans**, registered as `Plex`, with Segoe UI and sans-serif fallbacks. `build.mjs` copies the Latin variable WOFF2 from `@fontsource-variable/ibm-plex-sans` into `fonts/plex-sans.woff2` and its OFL licence into `fonts/OFL.txt`. The face declares normal style, weights 100–700 and `font-display: swap`.

Body text and controls use Segoe UI, system-ui and sans-serif. The frontmatter preserves separate shell and engine body line heights. Display text introduces the empty stage; task headlines orient the inspector. Section headings and labels remain compact, sentence case and free of decorative tracking. Main task descriptions are limited to 60ch; expanded detail paragraphs to 70ch. Mobile display text resolves to 23px, and task headlines to 21px.

## Layout

The desktop shell uses a 62px project bar and 62px bottom action/status strip. Its task rail is 84px wide. Inside the engine frame, the model column is `minmax(320px,1fr)` and the inspector is `minmax(370px,420px)`. Only the inspector scrolls; the stage remains available while panels change. Inspector sections use `24px 22px 40px` padding and flat groups have 24px bottom spacing.

Responsive rules belong to their actual coordinate spaces: shell breakpoints use the outer viewport; engine breakpoints use the frame viewport. At 1050px the engine inspector becomes 355px wide. At 900px the shell rail becomes 68px and the footer switches to a two-row grid, with visible status above both actions. At 760px the engine stacks a stage occupying 42% above the scrolling inspector, with a 170px stage minimum. The labelled static-preview mode uses 40%. At 560px the outer rail becomes a horizontal bottom task strip and the project bar becomes 54px. Status remains visible; the narrow action strip has a 78px minimum height.

These are observed breakpoints, not a general device taxonomy. Retain their independent shell/frame behaviour when extending this preview.

## Elevation & Depth

Inspector groups and controls are flat, with no card shadows. Surface contrast and single-pixel rules separate regions. The Help dialog is the exception: its shadow is `0 20px 70px #0004` over a `#151911aa` backdrop. The batch panel overlays the engine at z-index 5; the original-file handoff notice uses z-index 10. No animation timing or easing tokens are defined in these preview stylesheets.

## Shapes

Controls use the modest `control` radius; stage controls use `stage-control`. Test labels are slightly tighter and the Help dialog is more rounded. Inspector groups remain square, unboxed and shadowless. Joined workflow buttons share a single segmented silhouette, with only their outside corners rounded. Drop targets use a dashed single-pixel line. Navigation glyphs are simple inline line icons, not illustrations.

## Components

### Buttons

Shell buttons use panel fill, an ink label, a line border and a 36px minimum height. Hover uses the soft fill and accent border. The primary action has accent fill and semibold text; its hover uses `brightness(1.12)`. Engine controls use the smaller control type and their own padding. Stage controls use stage-specific tones and a 30px minimum height, reduced to 28px in the narrow frame. Disabled buttons use half opacity and the shell adds a not-allowed cursor.

### Inputs / Fields

Inputs and selects share the engine control radius, single-pixel line border and 36px minimum height. Labels sit above with `field-gap`; checkboxes use the accent. Focus-visible outlines are 2px with a 3px shell offset and 2px engine offset. Preserve native form semantics and the underlying controls when moving fields into task panels.

### Navigation

Task navigation pairs a line icon with a visible label. Current selection uses `aria-current="page"`, soft fill and accent ink/border. Convert and Full Spectrum use `aria-pressed` inside the labelled colour-workflow group. Both are persistent, revisitable controls. The bottom primary action and role=status message supply continuous feedback, including on mobile.

### Tags and inspector groups

The small outlined Test version tag is metadata, not an interactive chip. Inspector groups have no card chrome: headings, spacing and separators carry hierarchy. Avoid adding boxed cards around every setting in this preview.

### Model stage and fallback

The normal preview uses actual WebGL interaction. Where WebGL2 is unavailable, the software renderer supplies an openly labelled **static** image; its pale surface and explanatory caption distinguish it from the interactive stage. Hide unavailable camera/object-stage actions while retaining quantity editing in Layout. The generated support arch is synthetic demonstration data. Neither preview represents slicer clearance, timing or verified printed-colour accuracy.

The sole reused brand raster is `web/assets/yab3d-mark-96.png`, packaged at `assets/yab3d-mark-96.png` and reused unchanged. Its provenance is the existing project identity asset. No generated decorative raster is part of this direction. Model previews are runtime content, not decorative artwork; review captures are evidence, not shipping assets.

## Do's and Don'ts

- Do apply these tokens only to the separate Workbench preview.
- Do keep status, selection and keyboard focus visible as panels and viewports change.
- Do retain the existing YAB3D mark and self-hosted OFL font licence.
- Do label software-rendered fallback images as static and sample models as synthetic.
- Don't treat this document as a replacement for the production UI's incumbent system.
- Don't invent tonal ramps, motion tokens or decorative imagery absent from the implementation.
- Don't conceal preview limitations or use preview images as proof of physical print results.
