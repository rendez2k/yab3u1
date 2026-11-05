# Workbench 2.6.42 — recoverable colour editing and plate arrangement

5 November 2026. This is an ordinary refinement of the existing Workbench, authorised for main and the full release.

## Behaviour

- **Auto arrange** in Layout repacks current quantities, using the same planner as preview and export. It keeps orientation, observes spacing, printable bounds, hardware exclusions and the prime-tower allowance, and offers Undo. If the whole request cannot fit, it leaves quantities unchanged and explains the problem. The rectangle packer tries additional deterministic orders and fit heuristics when the first attempt fails; it does not rotate or geometrically nest objects.
- **Colour Undo** starts before an edit is committed. Opening Colour leaves original paint visible. Choosing a swatch or entering a colour creates an explicit preview; Ctrl/Cmd+Z and the toolbar Undo restore it before older layout history. Apply remains unavailable until a colour is chosen. Committed recolours retain model Undo.
- **Three visible starting choices** put Suggest colours, Use my colours and Filament packs at the top of Full Spectrum Colours. Custom reels expose swatches and hex fields; named products and secondary settings sit in Filament details.
- **Purchased packs** identify [ELEGOO Rilievo PLA CMYK 4 × 1 kg](https://www.amazon.co.uk/dp/B0GZVPJMB2) and [eSUN PLA+ CMYK 4 × 1 kg](https://www.amazon.co.uk/dp/B0CV7GD5YB). Both contain cyan, magenta, yellow and white and are sold for backlit lithophanes. Users can explicitly preview their reels on a model; automatic compatible-pack comparison continues to exclude backlit-only packs. Their predictions remain labelled unmeasured. Product names and catalogue identity survive export, but no pack-specific optical calibration or validated slicer preset is invented.
- **More room in the inspector:** responsive width, clearer disclosure controls and expanded change details only for the selected palette. PETG support is labelled experimental instead of demo, including the export note.
- **Consistent module versions:** the built application versions its relative JavaScript dependency graph using a content revision, preventing cached dependencies from omitting newly released actions.

## Validation

- 185 automated tests passed, with no skips. Coverage includes pending-colour Undo in both workspaces, explicit backlit-pack preview, product identity, PETG capacity, failed-fit preservation and a seven-object layout with tower clearance.
- Browser checks passed for seven-copy Auto arrange; keyboard and toolbar Undo for pending and applied colour edits; manual hex override; both purchased pack previews; PETG capacity recovery; and desktop/mobile layout. No console errors appeared in the checked session.
- A real Grinch project was exported with seven arranged instances and the eSUN pack, then read back. All seven instances and four product identities were present; the archive validator reported no problems. The original model was unchanged.
- The production build and whitespace checks passed. A Python-backed runner test required execution outside the restricted launcher environment; it passed in the final complete suite.
- Fresh finish review: **ship**. A fresh general agent applied the specialist review contract because that specialised role was unavailable. An initially clipped desktop capture was replaced with complete 1280 × 800 evidence before the full review. Historical design-document version and test-only wording are reported drift, preserved under the ordinary-extension rule.
- Fresh documentation pass: **ship**, no changes. A separate general agent applied the documenter contract, checked the finished captures and source against the incumbent system, and found no newly missing documentation. DESIGN.md and its sidecar are preserved.

Local evidence lives under `.impeccable/review/usability-2.6.42-*`. Private model files, diagnostic reports and review screenshots are excluded from the published application. This validation covers software, browser behaviour and 3MF round trips; it does not establish physical print quality or sequential head clearance.

## Colour-quality follow-up

The separate iDither comparison concerns ordered outer/inner wall patterns and top-surface construction. Those methods are not implemented by this release. Their value should be assessed through smoother blends, colour accuracy and retained detail with the same physical filaments; file size and preparation time are secondary trade-offs. Preserve the current native-blend path while evaluating an explicit quality-focused mode.
