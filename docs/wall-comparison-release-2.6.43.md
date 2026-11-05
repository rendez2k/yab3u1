# ELEGOO layer and wall comparison — 2.6.43

The Full Spectrum filament-pack panel now opens a repeatable print comparison for the user's loaded ELEGOO Rilievo CMYK reels. Supported alternatives are eSUN PLA+ CMYK and Snapmaker Full Spectrum White Edition. These are CMY + white sets; the comparison does not silently substitute black for white.

Choose **Colours → Full Spectrum → Filament packs → ELEGOO → Print a layer / wall comparison**. Match cyan, magenta, yellow and white to the loaded U1 inputs. Occupied slots swap. Choose 0.10 or 0.08 mm layers; the nozzle is 0.4 mm. The generated ZIP contains two 3MF projects, a print guide and exact settings. A persistent save link remains available after generation and is invalidated when options change.

## What is compared

Both plates contain the same ten specimens: six cyan/yellow or magenta/yellow arrangements, including reversed wall order and thicker outer walls, plus four pure-colour controls. Each specimen has a 12 mm hollow curved wall, a separate flat top tile and a white base with identifying row/column bars.

- Native layer plate: existing Full Spectrum recipes, with Subdivide Mix Layer enabled by default.
- Experimental wall plate: closed, separate outer and inner material volumes, with subdivision disabled.

Layer recipe percentages match rounded wall-thickness shares, not exact material volume or optical path. Both plates use the same generic PLA process and temperatures. The front half of the plate is reserved for the larger native mixing prime tower. The comparison never edits the loaded model or applies a calibration profile.

This is original analytical test geometry. No proprietary iDither recipes, calibration arrays or code were copied. It is not yet a feature for rewriting arbitrary models into coloured wall volumes. Printed colour quality and suitability for a Grinch model remain unvalidated.

## Validation

- 189 automated tests pass, including four new tests covering exact reel identity, slot validation, closed and consistently wound volumes, supported placement, export round trips and byte-identical repeated ZIP generation. Existing ZIP callers retain their usual timestamps.
- Snapmaker Orca 2.4.1 sliced both default ELEGOO projects successfully at 0.10 mm and 0.08 mm, with normal collision checks enabled. The CLI required `--allow-newer-file` for the native Full Spectrum application marker. G-code was generated directly because the installed slicer's thumbnail export path crashed.
- A first layout revealed a native prime-tower conflict. Both coupon layouts were moved together and tower width increased. All four final slices completed with exit code 0. A benign installed-slicer bed-exclusion triangulation message remains in the logs.
- At 0.10 mm, coupon 01 retains cyan and yellow extrusion through the middle of both walls. The explicit wall has cyan near radius 5.2 mm and yellow near radius 4.6 mm. The native sample alternates both filaments over the full wall thickness. The native tower ends below Y145 mm; specimen bases begin at Y170 mm.
- Default 0.10 mm estimates: native 8 h 36 m 52 s, 74.72 g, 840 changes; explicit wall 4 h 18 m 22 s, 39.29 g, 360 changes. These estimates describe this coupon layout and generic profiles, not a measured speed advantage on arbitrary models.
- Loaded desktop and mobile UI checked, including direct pack entry, reversible slot swapping, bounded progress and a visible save link. The browser automation tool cannot retrieve blob ZIPs from embedded frames, and its URL policy blocks direct blob navigation; no completed browser download is claimed. Generated archives were verified locally and are also provided directly.
- No physical print or measured optical result is claimed. The metadata keeps `slicerValidated` and `printValidated` false because arbitrary user options have not been individually certified by the generator.

## Design finish

The fresh finish review returned **ship** for the ordinary extension. The fresh documenter returned **No changes**: existing Plex typography, neutral studio surfaces, green controls and reduced-motion behaviour are preserved. General-purpose agents adopted the complete reviewer/documenter role contracts because dedicated roles were unavailable. No new raster assets ship.

Existing design-document drift (v2.6.30-test scope, test-only wording and 330 px inspector description) was reported and left untouched. The scope does not authorise replacing the design system.
