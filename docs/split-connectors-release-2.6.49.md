# Split connectors — 2.6.49

The Split inspector now offers three connector choices: **Attached pin & socket**, **Separate dowel & two sockets**, and **Two sockets only**. They work with plane cuts, painted-region separation, reviewed shape separation and automatic separation, subject to the existing closure and material checks.

A separate dowel is a real, single-colour printable object. Its length is twice **Depth per part**; each blind socket is 0.2 mm deeper than that insertion depth. **Fit clearance** adds to the socket diameter. The dowel is grounded and oriented upright, and automatic plate filling includes it in every complete set. Sockets-only makes the same holes without adding a printable pin.

**Position on join** provides Across/Up offsets from the fitted centre and Reset position. **Check join** runs the same geometry checks as Apply in a cancellable worker, without replacing the model. The result shows a scaled joining face, connector position and actual socket dimensions. For one join, click the face to move and recheck; for multiple joins, choose a face to inspect and use offsets to move their connectors together. Changing the source, selection, cut or connector settings discards the previous result.

Apply creates the parts in the existing workspace. The common Undo restores the original model. Split methods share the larger mobile editing area, with 44px controls and reachable Apply/Cancel actions.

## Validation

- 224 automated checks pass. New checks cover all three cut axes, closed edges and consistent winding, removed socket volumes, dowel volumes, invalid offsets and thin receivers, source preservation, worker cancellation, stale checks, diagram coordinate mapping, and export/reimport for colour, automatic, plane and shape separation.
- Browser checks confirmed connector choices, read-only checks, edge rejection, offset reset, three generated objects and model Undo. Desktop and 390px mobile controls were inspected. The UI detector reported no findings.
- Installed Snapmaker Orca 2.4.1 successfully sliced the exported sample into a 165-layer job containing the body, detached stalk and upright dowel. The sample uses a 3 mm diameter, 3 mm insertion depth, 0.3 mm diameter clearance and 0.5 mm position offset. No print was started.

## Limits

The geometry check is not a physical fit guarantee. Test a small joint with the actual filament and printer. Separate sockets need sufficient material on both sides of the join. Existing near-planar boundary and modifier restrictions still apply. Curved hand/arm seams that could not be closed in 2.6.48 are not made detachable by adding another connector family. A connector's position can be changed before Apply; later changes use Undo and a new split. Arbitrary curved cuts, multiple hand-placed pins on one face, keyed joints, ball joints and threads remain future work.

Source models, private screenshots and slicer outputs are excluded from the deployed application and Git commit.
