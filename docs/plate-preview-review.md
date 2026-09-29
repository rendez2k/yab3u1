# 3D plate preview — 2.6.23-review

The normal converter and Full Spectrum share Model / Plate camera controls,
Arrange plate and Reset view above the canvas. The plate uses the layout
planner's bed dimensions and origin. Green areas reserve prime-tower space;
rust areas mark printer keepouts where supplied by the selected printer setup.

The bed is a separate GPU draw pass. It never enters the model soup, thumbnail
or exported archive. Camera framing includes both the bed and any geometry
outside it, so a reservation is a planning guide, not a claim of printability.
Model view hides the bed and fits the selection. Responsive resizing preserves
relative zoom and orbit. Supports remain a slicer result.

Validation:

- Four renderer tests cover U1 origin and tower coordinates, generic strips and
  printer keepouts, framing, responsive resize and independent buffer binding.
- Layout, Full Spectrum and PETG regression tests pass (23 checks including the
  renderer tests); the 12 site-build isolation checks pass.
- Browser checks: actual painted pumpkin in the normal converter, generated PETG
  arch in Full Spectrum, Fill plate (24 arches), Model / Plate, Arrange plate,
  light/dark themes and narrow mobile controls. No WebGL or JavaScript warnings
  were recorded during these flows.
- Impeccable static scan reviewed: existing font, glow, halo, card-shadow and
  compact-options inset findings are outside this camera-toolbar change. No
  new controls introduce those patterns. The existing visual identity is retained.

The accompanying local JS-rendered PETG video is 15 seconds, 1280 × 720, 30 fps,
H.264. It shows enabling PETG, freeing a model-colour input, choosing a PETG
slot and an exploded illustration of support contact layers. It is explicitly
labelled as an animated walkthrough rather than a sliced preview. Video files
and render scripts live in the ignored docs/agent-work/plate-layout-video folder.
