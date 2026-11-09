# Larger-part cut fallback — 2.6.55

Automatic assembly splitting could repair the supplied alien but still could not close any of its curved surface-region boundaries. Its failure message then showed the informational note about small details, hiding the actual obstruction.

When no surface region can be detached, the splitter now searches the three model axes for a substantial narrow section. It proposes one straight cut, retains the painting on both sides, and validates closed edges, volume and connector fit. Preview split shows the assembled or separated pieces before applying. This is a conservative fallback, not anatomical recognition or automatic separation of every limb.

The cut resolves connected painted triangles together and matches subdivisions on neighbouring edges. This preserves colour boundaries without exporting T junctions. Untouched painting remains encoded as before. Unsupported seam/support subdivisions, ambiguous contours, small pieces and unsuitable connector positions remain rejected.

Failure messages now prioritise the reason a join could not be made. Notes about small details no longer stand in for that reason.

## Validation

- All 96 Workbench tests and 157 shared-web automated tests pass. New tests cover deterministic narrow-section selection, rejection of convex solids and tiny tips, closed pin/dowel joins, oversized connector rejection, and preservation of each colour's surface area across a connected painted boundary.
- The production build succeeds. The UI detector reports no findings in the changed studio and preview modules.
- The repaired supplied alien produces two closed pieces at Z 50.0613 mm. Without a connector, the total volume remains 139,429.0804 mm³. With the default 3 mm pin and 0.3 mm diameter clearance, both pieces have zero open, non-manifold, reversed or degenerate edges in the geometry check.
- Chrome desktop and 390 px mobile checks show two separated coloured pieces in Preview split. Applying produces two independently selectable objects. The cut includes some of the collar/sign area; it must be reviewed rather than treated as an anatomically exact neck separation.
- The browser-generated Snapmaker 3MF reopens as exactly two objects using all four source colours. Both exported meshes pass the same edge checks after serialisation and packing (399,426 and 225,144 faces). No browser console errors were observed.
- Undo restores the single repaired alien and removes the split objects from the active project.

Physical connector fit and print orientation still need review in the slicer and a print test. This release does not claim a tested physical assembly or an optimal cut for every model.
