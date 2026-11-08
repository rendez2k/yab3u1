# Shape-based part detection for YAB3D

Research date: 8 November 2026. Initial application inspected: 2.6.47, commit f12ebe7. The assessment below records the initial proposal; the follow-up records the implemented 2.6.48 scope and hands-on 3DSplitter findings. This is not a benchmark of 3DSplitter's forthcoming Smart Split.

The useful opportunity is to recognise a hand, arm, stalk or hat from its shape, then let the user select, recolour or detach that region. This would extend YAB3D's existing colour-boundary and disconnected-component splitting. It does not depend on the ELEGOO optical-mixing experiment and does not require a new printer.

The supplied video is [3DSplitter — The future of 3D Model Splitting!](https://www.youtube.com/watch?v=ScgldRar4gQ), published 16 October 2026. I reviewed the full English auto-generated transcript, retrieved 8 November; caption wording can be imperfect. At approximately 1:10 the creator describes analysing sampled surface points. At 3:06 they acknowledge segmentation errors on Hulk and manual correction. At 4:00 they mention training data while also describing the feature as AI-free. The algorithm and evaluation protocol are not disclosed. Their accuracy estimate is not a measured result for our models.

The video's description calls the feature forthcoming. The public homepage reported v3.0.7 during the initial review; the [accessible changelog](https://www.3dsplitter.com/changelog) describes connector expansion and splitting improvements, but does not establish a Smart Split release. The subsequent live check below found an Auto Split tool for printer-volume fitting, without locating the point-based Smart Split demonstration. The demonstrated region detection does not establish that every proposed region becomes a valid, assemblable printing solid.

**There are credible ways to implement the underlying idea.** The [CGAL segmentation documentation](https://doc.cgal.org/latest/Surface_mesh_segmentation/index.html) describes grouping surfaces using estimated local thickness, followed by a graph cut incorporating concavity and changes of surface direction. It also documents mesh-quality assumptions and unreliable results when these are violated. [Point Cloud Library's region-growing method](https://pointclouds.org/documentation/tutorials/region_growing_segmentation.html) groups neighbouring samples using surface normals and curvature. These are useful foundations, rather than evidence of which algorithm 3DSplitter uses.

My engineering assessment is that simple normal-based region growing is insufficient on its own: a smooth shoulder may blend continuously into a torso, and a curved head may fragment into many patches. Thickness, concavity, mesh connectivity and user-provided selection hints should work together. Euclidean proximity alone could incorrectly join an arm to a nearby body surface. A reduced analysis mesh can make interaction responsive, but the final selection must map back to the original geometry and paint.

Learned alternatives also exist. [PartField](https://github.com/nv-tlabs/PartField/blob/main/README.md) publishes a pretrained part-feature model and a Python/PyTorch/CUDA setup. Its [licence](https://github.com/nv-tlabs/PartField/blob/main/LICENSE) limits use to non-commercial research and education; treat it as a research comparison, not a ready product dependency. [SAMPart3D](https://github.com/Pointcept/SAMPart3D/blob/main/README.md) documents multi-view Blender preprocessing and GPU training/evaluation for a target object. Neither published workflow is a drop-in browser feature. There is no need to start by collecting a large training dataset for a geometric prototype. Browser-local execution alone would not establish whether a method uses machine learning.

**The current YAB3D code explains the gap.** `experiments/workbench/auto-split.js` tests connected painted regions while keeping the largest painted area as the body. Existing disconnected shells are separated only under conservative checks. `mesh-joint.js` derives the paint boundary and projects it into a frame to close the two sides. A strongly curved or wrapping boundary is rejected; a surface patch with no enclosed volume is also rejected. Those checks are protecting the model, not simply hiding a more powerful selection option.

The new detector could identify a promising part even where its useful join does not coincide with the paint boundary. It should retain the existing seam checks until a stronger cutter has been validated. Closing an arbitrary surface selection with a cap can create intersections, remove an adjacent feature, seal an intended cavity or leave pieces that cannot physically assemble. Those are separate problems from recognising the region.

| User example | Expected usefulness — inference, not tested results |
|---|---|
| Pumpkin stalk | Strong initial candidate: a protrusion and a narrow attachment. Existing paint-based separation already succeeded. |
| White gloves and black arms | Worth testing independently. Shape detection may propose an entire limb; colour boundaries and user correction should allow the requested separate black and white pieces. |
| Black eyes and mouth | Useful for selection/recolouring. A surface patch still needs designed depth and a receiving cavity before it can become an insert. |
| Snowman nose or hat | Plausible candidates where the geometry supplies a neck or crease. A wrapping scarf is a more difficult cut. |
| Grinch's hat, face and limbs | Useful test of organic boundaries, thin features and preserving facial detail. Do not promise clean separation from colour alone. |
| Sonic's existing separate parts | Preserve the authored parts and joints. Use detection only for a selected mesh that actually needs it. |

**The proposed workflow is: Detect parts → correct selection → recolour or separate → add joints → arrange plates.** Keep it in the existing viewport and Split inspector, with a highlighted part preview, a more/fewer-parts adjustment, click-to-include/exclude, merge, and Undo. Store the suggestions independently of filament colours. A blue analysis highlight must never silently repaint or modify the exported model.

The first implementation should:

1. Analyse a bounded proxy of the selected object in a worker. Use repeatable sampling and cache the result against the source geometry revision. Preserve original triangle IDs, units, part settings and paint assignments.
2. Produce editable region suggestions. Keep disconnected regions independent even if they share a filament. Support user hints so a correction survives changes in segmentation detail.
3. Offer recolouring immediately after selection review. Offer detachment only when a valid joining surface and positive-volume parts can be produced. Start with simple necks and near-planar joins.
4. Reuse the existing pin/socket and pin-up orientation code, checking actual material thickness and socket clearance. More general curved seams will require a shared cutting surface or solid partition, not separately guessed caps.
5. Return the accepted parts to the current plate workflow, preserving assembly relationships and complete-set quantities. Group single-colour parts into appropriate jobs; retain multicoloured bodies where needed.

[Manifold](https://github.com/elalish/manifold) provides a JS/WASM solid-geometry implementation that is worth evaluating for the cutting stage. Its input requirements still matter; a Boolean library cannot by itself make an arbitrary labelled surface into a suitable cutter. Any replacement of original surfaces must preserve detail and material attribution. Avoid globally remeshing a detailed figurine merely to make selection easier.

For release validation, use the supplied pumpkin, snowmen, Grinch and Sonic files plus simple analytical fixtures. Measure detection quality and cut quality separately: selection correction effort, repeatability, runtime, memory, closed boundaries, orientation, self-intersections, volume consistency, preservation of original exterior surfaces/paint, and assembly clearance. Round-trip the 3MF through our reader and Snapmaker Orca, then physically test at least one small pin joint. A colourful segmented preview is not the acceptance test.

For the U1, this could turn suitable models into ordinary separately printed coloured components and reduce colour changes, at the cost of assembly and visible seams. It does not increase the four simultaneously available physical inputs. Sequential grouping still needs printer-clearance validation. It also cannot make green from the currently loaded cyan/magenta/yellow/white simply by separating the geometry: printing a solid green part requires a green reel, or a separately validated blend method.

Recommendation: prototype browser-local geometric part selection and simple validated detachment next. Keep broad curved-seam extraction as a subsequent geometry milestone. The initial usefulness can be judged without waiting for optical-mixing calibration, and both features can remain within the same selecting, colouring, splitting and arranging workflow.

## Channel review and live application follow-up

The [3DSplitter channel](https://www.youtube.com/@3DSplitter) returned ten videos on 8 November 2026. Eight full English automatic transcripts were reviewed, including the original Smart Split video. This is a transcript review, not a claim that every video frame was watched. Two shorts had no captions: [shelling and splitting](https://www.youtube.com/watch?v=CzUUnOrlJEM) and [printing a large model on a small printer](https://www.youtube.com/watch?v=qQp9tmTDzBQ).

| Demonstration | Useful behaviour described by the creator |
|---|---|
| [Merge split pieces](https://www.youtube.com/watch?v=Yxj5ztK_Y1s) | Propose small residual pieces, then let the user choose the adjacent body to merge each into. The creator describes a 2% relative-size heuristic, not an AI decision. |
| [Add connectors](https://www.youtube.com/watch?v=Khy9XVDtPJg) | Edit a joint after splitting, change its family, position, size and fit, with limits based on nearby material. |
| [Add part numbers](https://www.youtube.com/watch?v=M5bj7qL6FJ4) | Engrave numbers into internal cut faces and adjust placement, size, rotation and depth. |
| [Inspect models](https://www.youtube.com/watch?v=CCh8C1GRmBw) | Move an inspection cross-section through the model before committing a cut. |
| [Split models with connectors](https://www.youtube.com/watch?v=PX6kgm3tGfw) | Earlier connector development demonstration; largely overlaps the newer connector tutorial. |
| [Split Setup](https://www.youtube.com/watch?v=nbsWwGsYxtQ) | Add and move multiple cut planes; choose planar, puzzle, dovetail or pyramid joins. |
| [Upload models](https://www.youtube.com/watch?v=8FpEHJhCWO4) | Add several source models to a scene, ground and frame them, and manage their visibility and exports. |

Hands-on testing used the built-in 44 mm demo cube on [3dsplitter.com](https://www.3dsplitter.com/); no user model was uploaded. I split it into two pieces with an automatically fitted integrated pin, changed the existing joint to **Separate Dowel**, and moved the joint by 0.1 mm on its interface. Both sockets and the separate printable dowel updated. The panel exposed material-depth and edge limits, fit clearance, and a custom-size option. The seven offered connector families were integrated pin, integrated holes only, separate dowel, mortise/tenon, ball joint, keyed snap-lock and threaded. Only the pin and dowel were exercised; the other families were inspected in the menu.

**Add Part Numbers** created two labels with engraving enabled. **Select Small Pieces to Merge** correctly reported no likely residuals for the two substantial cube halves and offered manual selection; no merge was executed. **Auto Split** described minimum axis cuts to fit the active printer volume, plus a support-minimising option. It required a printer profile. **Freeform Cut** exposed a drawn cut and plane tolerance; it was inspected without executing another cut. None of this verifies the unpublished point-based segmentation algorithm or the printed fit of its connectors.

I found no public 3DSplitter source repository and open-source licence in the reviewed material. Its free browser interface and local processing are not evidence that its code is open source. YAB3D's detector is an original implementation; no 3DSplitter source was incorporated.

## What is built, and what should follow

The [2.6.48 release notes](shape-selection-release-2.6.48.md) describe the completed first stage: deterministic mesh-region detection, additive selection, selection Undo, reviewed recolouring and conservative detachment with a locating pin/socket. Detection works on original triangle adjacency and concavity, with preview mapping and a worker; it does not currently use the sampled-point algorithm shown by 3DSplitter. The pumpkin test identifies hands, arms and stalk, but only the stalk passes the current seam-closure checks. Recognising a part and constructing a sound printable joint remain separate milestones.

The live application suggests this order for subsequent work:

1. Store each cut and its two mating faces as a persistent joint, so its connector can be edited after separation and survives project save/reload.
2. Add separate dowels with two sockets and a printable dowel object. This permits independent pin orientation without turning the model's attached pin downwards.
3. Add direct connector positioning with paired previews, local material-depth checks and conservative size limits; keep manual overrides explicit.
4. Add assembly inspection, exploded views and optional internal part numbers.
5. Propose tiny adjacent fragments for merging, with the target visible and user-confirmed; size alone must not delete intended details.
6. Add boundary correction and a validated shared cutting surface for curved organic joins. This is the missing geometry needed for reliable hand/arm detachment, rather than another selection UI alone.

These are follow-on features, not capabilities claimed by 2.6.48. Numerical validation and slicer acceptance precede a small physical fit test for any new connector family.
