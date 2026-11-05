# Comparison height and prime-tower guidance — 2.6.44

The experimental dual-wall comparison inherited the stock process name “0.12mm Standard” despite exporting 0.10 mm numeric layers. Both comparison projects now carry explicit YAB3D process names containing their selected height and method. The default-print-profile identifier agrees. Numeric Global settings, all ten object overrides, geometry, material assignments and priming settings are unchanged.

The user also reported 0.12 mm in the numeric Quality field. That is separate evidence, not explained by a preset label. The exact loaded project could not be inspected because no Snapmaker Orca window was open. The original supplied archives contain 0.10 mm globally and on every sample; the new files do too. This release does not claim to have reproduced or resolved the user's loaded-project discrepancy.

Before download, the comparison panel now states that heights are saved in both Global and Objects, that the first layer is 0.20 mm, and that both tests should use matching regular heights. It explicitly explains that the slicer generates a large prime tower that is absent from YAB3D's mesh preview. Reference total time and material estimates include the tower and name the exact reference setup; they do not pretend to be a fresh slice of the current choices. The packaged guide also records observed tower footprints and the numeric-height checks. The following calibration section is explicitly labelled as using the current model's palette and settings, separately from the comparison.

## Verification

- 189 automated tests pass, including round-trip assertions for matching process names, numeric Global height and all ten object heights, first-layer height, reel identities and unchanged deterministic generation.
- Snapmaker Orca 2.4.1 sliced both corrected default projects successfully with normal collision checks. The generated G-code records 0.10 mm regular layers and 0.20 mm first layers with the new identifiers. Native: 8 h 36 m 52 s, 74.72 g; dual-wall: 4 h 18 m 33 s, 39.29 g. The earlier reference dual-wall time was 4 h 18 m 22 s; the displayed reference remains labelled as a reference slice.
- Comparing old and new project settings shows only the two process-name fields changed. Physical settings and test geometry were retained. These checks do not establish printed colour quality or the height in the user's already-running job.
- Loaded desktop and mobile inspector checked on the test site. The added guidance is before Download. No model upload, printing or browser blob-download verification was performed. Generated archives were checked locally.
- The detector returned no findings for the changed panel. No CSS or visual-system changes and no new raster assets ship.

## Design finish

The documenter returned No changes: existing Plex typography, neutral studio surfaces, green controls and interaction conventions are retained. Pre-existing version/test-only/inspector-width documentation drift was reported and left untouched. General-purpose agents adopted the full Impeccable documenter and finish-reviewer roles. The reviewer identified the ambiguous boundary with current-model calibration; that was clarified and recaptured on desktop and mobile. Final disposition: **ship**, covering the scored clarification, with no regressions observed.
