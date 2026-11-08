# Editable boundaries and split inspection — 2.6.50

Split now includes **Draw boundary · place points**. Open the original surface, place points around a part, rotate to reach the back, and close the loop. Select a numbered point to move it with another surface click. Remove point, Undo point and Select other side adjust the selection before committing it. Ctrl/Cmd+Z also undoes boundary edits.

The path follows edges of the original mesh using deterministic shortest paths. The preview's simplified geometry is never used to modify the source. A loop must isolate a region on one connected mesh; crossings, repeated vertices, open/overlapping edges and unsupported joins are refused.

**Preview split** uses the same closure and connector calculation as Apply. It shows the actual closed parts, pins, sockets and separate dowels. Separate pieces changes the inspection spacing; Show assembled restores original assembly positions. Back to editing returns to the boundary. The inspection canvas does not alter the workspace file, selection, quantities, layout or camera. Printing orientation and grounding are applied when committing the split.

Inspection hides the ordinary plate controls and restores them on exit. The camera fits the actual separated bounds. On phones, Expand preview gives the model the full workspace height; Show settings returns to the controls. Preview and separation controls have 44 px touch targets. Boundary connectors refer to the selected part and remaining model.

Existing plane, painted-colour, shape and disconnected-part splits also gain assembly inspection. Changing the source or split settings invalidates an old check. Workers can be cancelled, and stale replies cannot replace the current inspection.

## Validation and limits

- 232 automated checks pass, including boundary partitioning, deterministic paths, invalid loops, source preservation, movable points, undo, cancellation, stale results, closed export solids and reversible explosion.
- A sample boundary exports the body, stalk and separate dowel as three closed solids. Snapmaker Orca 2.4.1 sliced the exported 3MF into 165 layers. No print was sent.
- Browser checks covered numbered point edits, default and maximum separation, assembled view, desktop and phone layouts, Apply, Undo, cancellation and restored plate controls. No browser JavaScript errors were observed.
- The supplied 600,220-triangle pumpkin supports surface tracing and a closed stalk separation. Loops sampled around its hands and arms do not isolate those parts; they remain rejected. This release does not claim automatic separation of those joins.
- Closure still requires a suitable approximately planar seam and sufficient solid material for connectors. Arbitrary curved caps, multiple cut loops and multiple/keyed connectors are not included.
- Inspection keeps the source paint. The cut boundary is shown through the surface so points at the back remain locatable; rotate to inspect their actual placement.
- Geometry and slicer checks do not establish a physical connector fit. A small printed fit test is still needed.

No new shipping raster assets were introduced. The established Workbench visual system is preserved.
