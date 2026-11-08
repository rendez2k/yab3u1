# Shape selection — 2.6.48

Select an object, then choose **Select parts by shape…**, or **Split → By shape · review parts**. **Detect parts** proposes regions from the mesh geometry independently of its paint. Fewer/Balanced/More parts controls the detail. Select regions on the model, add/remove with Shift or Ctrl/Cmd, or use the labelled region buttons. Undo restores the previous selection.

Choose **Recolour selection** to preview a filament on those regions, or **Separate from the body** to create closed parts where the join permits it. The original model remains unchanged until Apply, and the common Undo restores committed edits. A failed separation leaves the selection available for correction or recolouring.

Separation supports the existing matching locating pin and socket, with diameter, length, fit clearance, pin side and pin-up orientation controls. New cap and pin surfaces use the selected surface's dominant colour, so a green stalk remains a single-colour part. Position is fitted automatically; joints are not yet editable after applying the split. Printed fit still needs a physical test.

The detector is original, deterministic geometric code, not a neural model or copied 3DSplitter implementation. It groups original triangles by connectivity and concavity. Processing runs in a cancellable browser worker, with a small revision-specific cache. Detection is limited to 750,000 triangles per selected object and 96 proposed regions. Highlighting maps the simplified preview back to regions; committed edits use the original triangle indices and preserve other surface paint.

## Limits

A detected region is not automatically a printable part. Separation checks shared boundary edges, closure and positive volume. The current cap method supports near-planar joins; curved wrapping seams and flat paint patches can be refused. Use the region for recolouring or choose a plane cut. Objects containing negative volumes or settings modifiers remain protected. Existing authored components are respected.

This release does not include surface-brush boundary correction, arbitrary curved cuts, post-split connector editing, separate dowels, ball joints, threads or physical fit validation. Those remain separate geometry milestones, rather than claims implied by the region preview.

## Validation

- 220 automated checks pass, including deterministic face coverage, region-specific paint, selection Undo, worker cancellation, preserved source resources, closed solids, cap/pin colour and 3MF export round trips.
- The 600,220-triangle painted pumpkin produced seven coarse regions, including both hands, both arms and the stalk. The stalk passed current closure checks; the curved hand/arm joins did not. The Grinch produced 15 coarse regions; that count does not establish printable separation.
- Browser checks confirmed a hand-only colour preview and applied recolour, committed model Undo and toolbar selection Undo. Desktop and 390px mobile controls were reviewed; the active shape inspector allocates extra mobile editing space and 44px action/connector targets.
- Installed Snapmaker Orca 2.4.1 sliced the generated two-part sample with a 3mm pin/socket into a 165-layer job. Both parts remained single-colour. This validates slicer acceptance, not a physical print or fit. No print was started.

The original source model files, screenshots, slicer outputs and private photos are not included in the release. Research is recorded in [the Smart Split assessment](smart-splitting-research-2026-11-08.md).
