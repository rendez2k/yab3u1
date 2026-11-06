# Bambu2U1 MultiPlate review — 6 November 2026

Reviewed the author's [Reddit release post](https://www.reddit.com/r/snapmaker/comments/1xpgd2b/release_bambu2u1_multiplate_convert_12_color/), [v1.0.0 release](https://github.com/bradhoschar/Bambu2U1_MultiPlate/releases/tag/v1.0.0), README, `app.py`, `converter.py` and the interface template. Source inspected at commit `150e59abf0d0e30d3da9e2d76064f0e07a1601db`. This is source inspection of a new release, not a claim to have physically printed every supported model.

## Useful ideas adopted

- List all source plates with thumbnails, object counts and filament swatches before export.
- Keep each plate's U1 filament allocation separate, so a project can have many colours across different four-input print jobs.
- Download every separate job in one ZIP, with a per-job filament list.
- Put plate switching, deletion/restoration, object quantities and saving together. YAB3D also retains per-plate edits and saves a combined editable multi-plate 3MF, which goes beyond the release's separate-job workflow.

## What “12+ colours” means

The release handles colours across separate print jobs. It does not give the U1 twelve simultaneous inputs and is not an optical mixing or Full Spectrum method. Its all-plates output is a ZIP of individual 3MFs, rather than a single editable multi-plate project. Our existing Batch mode already exported individual source plates; the practical improvement is bringing this into the editing workflow with individual filament plans.

## Checks we retained instead of copying the implementation

The inspected [converter](https://github.com/bradhoschar/Bambu2U1_MultiPlate/blob/150e59abf0d0e30d3da9e2d76064f0e07a1601db/converter.py) derives used filaments from object-level `extruder` assignments. Its default slot map takes the first four and falls back to slot 1 for unmapped assignments. Mesh paint is copied unchanged, and part-level extruders are not remapped. YAB3D reads part overrides and painted facets and flags an unresolved fifth input instead of truncating it.

Its object filtering follows the first component and filters build items by object ID. Our export retains reachable component graphs, per-plate instance identities, supported modifier roles and per-object settings. The new combined writer namespaces each plate's mesh files and root object IDs to prevent collisions.

Its placement conversion uses fixed 340/320 mm grid offsets and four columns. Our individual jobs are measured and repacked for the destination. Combined projects follow Orca's logical plate grid (ceil(sqrt(plate count)) columns and a 20% gap), verified against [PartPlate.cpp](https://github.com/Snapmaker/OrcaSlicer/blob/master/src/slic3r/GUI/PartPlate.cpp).

Its advertised prime-tower repair is part of a selective template rewrite which does not retain all source process members. We keep our supported-settings policy and destination profile validation rather than silently copying or dropping settings.

## Release boundary

“Save all plates” is an editable project. A project-wide logical palette above four still needs individual U1 jobs; it is not a claim that the whole palette can be loaded simultaneously. “Export print jobs” writes an independently mapped single-plate project for each retained plate, and refuses a plate whose mapping exceeds available inputs. Preview geometry remains simplified. The destination slicer performs the final toolpath and clearance checks.

No third-party converter code was copied. The release's repository is MIT-licensed; these changes use YAB3D's existing readers, colour planning and exporters.
