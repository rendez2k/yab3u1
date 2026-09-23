# Changelog

The version shown on the page comes from `VERSION` in `web/convert-page.js` (and
`VERSION` in `web/recolour.js`), and is surfaced as a badge in the header and in
the collapsed "What's new" block in the footer. Bump those constants and add a
section here together.

## Unreleased — experimental U1 reel-change export

Added an optional Spool Studio link and local saved-data JSON import under Loaded
reels. Choose stocked filaments per slot and explicitly apply their colour and
material; account and purchase fields are ignored, and no inventory is uploaded.
This is file import, not a live account connection.

Corrected Organic support-style translation: Snapmaker/Orca serialize `organic`,
Bambu serializes `tree_organic`. Covered project and object settings in every
destination. Also guarded export rendering while colour analysis is pending.

The real alien slice now parses Orca's object-definition/fan-off preamble and XY
arc-plane commands. It correctly refuses printable export: 59 layers deposit
five colours, first at layer 406 (81.20 mm); three palette entries are unused.
Infeasible jobs now retain a downloadable explanation and analysis.

Added a separate slice-only project export and U1 G-code postprocessor. It remaps
logical tools, heaters, tool fans and pre-extrusion indices to four physical heads,
inserts layer-boundary M600 pauses and downloads a companion change sheet. An
independent replay checks every source command, physical tool index and pause
location before a file is offered. Unused slice palette entries are reported and
excluded from the reel load. Work runs in a cancellable worker with stale results
and download URLs discarded. Existing pauses and unsupported commands are refused.

The Full Spectrum destination selector is now first, explaining U1's four slots
and distinguishing other slicer formats from a particular printer. The U1 swap
controls are shown only for that destination. Slice-only projects keep the original
palette and designer settings, regardless of recolouring choices, with thumbnails.

Validated automated two-pause cases, failed/tampered inputs, cancellation,
desktop/mobile layouts, and real alien project preparation. The installed
Snapmaker CLI still crashes during plate initialisation. The user confirmed native
GUI slicing and supplied its G-code; physical printer validation is outstanding. This feature remains on a review
build and is not part of the stable v2.5.1 release.

## 2.5.1 — retain custom settings when Snapmaker loads its preset

Restored the process override metadata required by Snapmaker Orca's preset
importer. The shared exporter wrote the correct values but omitted this list,
allowing a matching installed preset to replace transferred quality, strength,
support and adhesion settings. This applies to single-file, bulk and Full Spectrum
Snapmaker exports. The list is rebuilt from reviewed destination settings; foreign
machine or filament overrides are not imported. Explicit support Off still wins.

Regression checks cover supports, seam, infill, shells, layer height, rafts,
Prusa aliases and settings opt-out. A real six-copy Frankenstein browser export
contains both the designer values and their override declarations. Native
Snapmaker GUI confirmation is still required; archive checks alone do not prove
the slicer's final loaded state. Previously downloaded files need re-exporting.

## 2.5.0 — bulk conversion

Added Bulk conversion alongside Single file on the existing homepage. Add files
in any supported source format, select one destination and download a ZIP. Each
plate is exported separately with its existing objects/copies, filament order,
compatible settings and rendered thumbnails. Multiple files selected through the
normal picker or drop zone now open the batch instead of using only the first.

Files run sequentially in fresh workers; ZIP assembly also stays off the main
thread. Failed files or plates are reported while successful ones still export.
Stopping keeps completed outputs. Readable and JSON reports identify outputs,
failures, skipped/unprocessed plates, transferred values and recognised settings
omissions. Duplicate filenames cannot overwrite one another. Limits are 50
sources, 96 MB per input and 256 MB of completed outputs per ZIP.

Validated real browser exports to all four destinations, mixed-source input,
multiple plates, duplicate filenames, corrupt input, cancellation and a real
Frankenstein export with its designer settings. Checked desktop/mobile layouts,
light/dark themes and return to the original single-file converter.

## 2.4.4 — designer settings and print-aware clone spacing

Expanded browser settings transfer for quality, strength and supports across all
four destinations. Compatible settings are selected by default. Per-object
overrides travel with every copy, including seam placement, shell counts, infill
and its anchors, support placement, interface distances and raft settings.
Prusa names and supported enum values are translated explicitly. Transfer details
show the recognised settings that cannot be carried to a destination. Hardware,
temperatures and machine G-code continue to use the destination profiles.

U1 Fill plate now reserves a 60 × 70 mm tower corner instead of full-height side
strips. The reported Frankenstein fits six at 5 mm spacing, with a 3 mm support
allowance. Clone spacing includes explicit outer brims, raft expansion and skirts;
automatic support reach is an estimate and automatic brims need a final slicing
check. Painted support enforcers remain enabled on every copied U1 object unless
the user explicitly switches support off.

Validated shared settings through all 16 format pairs, real browser export and
native Bambu Studio/PrusaSlicer import and re-save. Snapmaker Orca CLI validation
could not complete: the installed command-line importer crashes on both this
candidate and the previous release. These checks do not replace slicing a plate.

## 2.4.3 — compact preview, website address and source credits

Added a visible yab3d.uk link above the title on both pages, including when
visiting through the original Netlify address. Expanded the credits to identify
FilamentMixer's blend coefficients and the format/algorithm references used by
later features. Both pages now link to the third-party notices.

The converter's 3D viewer starts collapsed behind a Show 3D preview button,
with no empty canvas or inactive view controls taking up space. It can be
hidden again, and rendering remains on demand for large models.

## 2.4.2 — U1 fill-plate placement and copy colours

Fixed Fill plate using the source printer's bed dimensions for a Snapmaker U1
export. U1 layout, preview, thumbnail and export now share its 270 × 270 mm bed
and height limit. Other targets retain their editable planning area.

Native Orca exports give every copy its own object and filament metadata while
sharing the mesh. This preserves the base colour on every copy and restores the
original converter's copy structure. Thumbnail plate metadata now lists every
instance, including shared instances in printer-independent Bambu models.

Validated with the reported Frankenstein source: four copies at 5 mm spacing
with tower room, each within the U1 build volume and with green in slot 3.

## 2.4.1 — simpler filament assignment

Removed the separate Exchange row. Choose a slot beside each colour and the
other colour moves automatically; Reset assignments restores the original mapping.
Shortened the instructions for arranging slots and repainting colours.

## 2.4.0 — arrange filament slots without changing a colour

The assignment table could only repaint: sending green to filament 3 printed
green *in black*, because the file kept its palette and re-pointed the paint at
another filament. That is right when the point is to change a colour and wrong
when the point is to match the spools in the printer, which is what most people
open it for. The table now has two modes, and the one that keeps your colours is
the default.

- **The tool is now YAB3D — Yet Another Bloody 3D Tool.** The converter and the
  Full Spectrum page carry that name in their headings, page titles and meta
  tags, and the subtitle says what it does: convert, recolour, arrange. Only the
  name changed: the repository, <https://yab3u1.netlify.app>, the module names and
  the local-storage keys are the ones they always were, so saved themes and reel
  setups survive, and earlier entries in this changelog keep the old name.
- **Arrange slots (the default) keeps every colour where you can see it.** The
  palette itself is rearranged: every colour travels to the filament it was sent
  to and the paint follows it, so the model prints exactly the appearance it had.
  The map is a bijection, so sending green to filament 3 gives the white that was
  in 3 back to the slot green left — nothing is merged, nothing is lost, and a
  destination that is already taken displaces its colour rather than colliding
  with it. A permutation that merges two colours, or names a filament the file
  does not have, is refused with a sentence instead of written.
- **Repaint colours is the old behaviour, kept and named.** A source colour is
  printed in the destination filament's colour, several colours may share one
  filament, and the model's colours change. An engine call that names no mode
  writes exactly the bytes it always did; the two modes keep separate maps, so
  looking at one never destroys the other, and switching modes discards a
  download (or an export still writing) that belongs to the old one.
- **Every swatch now reads as words as well as hex.** Source rows, destination
  options and both exchange controls name the colour (`Green #3F8E43`) from an
  offline, deterministic approximation, so two similar shades can still be told
  apart by the hex beside the name. No brand is guessed and nothing is looked up
  over the network.
- **The saved file says which kind of assignment wrote it**, and the Output
  preview and the saved thumbnail are drawn from the rearranged palette the
  archive actually carries, so what you see is what the file does. Original
  colours still shows the file as it was read.
- **Bambu Studio's import dialog reads the file's filament list and may rebind it
  to your AMS.** The page says so rather than promising a physical slot.

## 2.3.2 — reserve prime-tower space by default

The converter starts each newly loaded model with "Leave room for the prime
tower" checked. Fill plate therefore reserves the space automatically; the
checkbox can still be cleared for a print that does not need it.

## 2.3.1 — the U1 export carries the source's print settings again

A regression fix for the homepage converter. It writes a Snapmaker Orca project
through the shared `web/shared/` modules now, and that path had lost the print
intent the original converter carried: supports painted onto the model survived,
but the project's own `enable_support`, support type and angle, and the compatible
shell and infill settings fell back to the bundled U1 baseline.

- **A Snapmaker Orca (U1) export carries the source's own compatible print settings
  again, and it says which ones.** The reviewed allowlist, the PrusaSlicer
  spellings and the enum values this Orca accepts are the ones the desktop tool
  (`u1convert.py`) and the original page converter already used, moved into
  `web/shared/printSettings.js`. A value Orca would warn about or refuse is skipped
  and the U1 profile's own value stays; nothing about the printer, the speeds, the
  temperatures or the filaments is copied.
- **Supports have their own control: From source, On, or Off.** "From source" reads
  the file the way the original converter did — PrusaSlicer's `support_material*`
  or Orca's `enable_support` / `support_type` / `support_threshold_angle` — and
  writes that decision into the project. Painted support enforcers are never left
  contradicting support off unnoticed: choosing Off writes support off and says
  that the model's painted enforcers then do nothing, and only "From source"
  enables support when a file says supports off but its geometry carries painted
  enforcers.
- **The page shows what it will do, and the file reports what it did.** The
  settings panel lists the values that will really be applied, or says that nothing
  is; the sentence after a save repeats it from the converter's own report.
- **Bambu Studio and the other targets are unchanged.** The printer-independent
  Bambu colour model keeps its own optional, default-off control, and the
  OrcaSlicer and PrusaSlicer exports say plainly that they carry no print settings.

## 2.0.0 — preview, three targets, and a plan from a real slice

The browser version is no longer behind. `web/` now carries a recolour page that
does what the local one does, using the *same* JavaScript modules (`web/shared/`),
and the two are kept in step by cross-language tests.

- **One shared browser toolkit, no framework and no CDN.** `web/shared/colour.js`
  (CIELAB/CIE94), `mix.js` + `mix_model.js` (the MIT FilamentMixer polynomial,
  generated from the Python model), `paint.js` (the painted-triangle bitstream),
  `targets.js`, `planner.js`, `project.js` (read, assess, rewrite a 3MF) and
  `preview.js` (a ~200-line WebGL renderer) are used by both applications.
- **Interactive original/result preview.** The selection is drawn in the colours
  the export would write, with orbit, pan, zoom and reset. Sub-divided facets are
  drawn in their dominant colour and that is said on the page; the exported
  attribute still keeps every leaf. Facets whose paint this tool will not rewrite
  are shown in a warning colour and counted.
- **Three real project targets.** Snapmaker Orca keeps the U1 profile and its
  native `mixed_filament_definitions` (physical arrays stay at four). Bambu Studio
  gets its own mixed-filament schema (`filament_is_mixed`,
  `filament_mixed_components`, `filament_mixed_sublayer_ratios`,
  `filament_multi_colour`). PrusaSlicer gets
  `Metadata/Prusa_Slicer_full_spectrum.json` (the palette) and an inlined model
  with `slic3rpe:mmu_segmentation` paint, no production-extension attributes and
  **no** `Metadata/Slic3r_PE.config`, so the project cannot override your own
  print preset. Bambu and Prusa exports are *portable colour projects*: the U1's
  printer, process and start/end G-code are dropped.

### 2.0.1 — review corrections (`VERSION` in `web/recolour.js`)

Astra's review found failures the first round of green tests did not cover. All
eight items are fixed:

- **Real-file export and preview.** The browser export handles inline (`hasMesh`)
  objects, so a Prusa or generic project no longer writes an empty `<components>`
  block; a missing transform is the identity; nested inline graphs resolve; member
  names cannot collide; and copied members' own references are rewritten.
- **Placement matrix.** `u1preview` transposed the rotation (a column mixed with a
  row); it now matches `u1convert.apply`, and both languages are checked against a
  rotation-*and*-translation fixture with hand-computed corners.
- **Preview buffers and camera.** Three colour floats per vertex (nine per facet),
  an explicit mode for the original view, the camera kept when only the colouring
  changes, and a zoom clamp scaled to the model instead of 0.2–6mm.
- **All-off recipes and empty selection.** Turning every blend off stays off and
  clears the review tick and the export; clearing every object disables the export
  instead of exporting the whole plate.
- **Planner accuracy.** Exact command tokens, unmodelled words refused, retract
  debt tracked, arcs and G92 handled, supports/infill/startup counted, layer
  markers coalesced, ZIP members size-checked before decompression.
- **Sliced-3MF member choice.** Both pages list the `.gcode` members inside a
  sliced 3MF and plan only the one chosen; the local page used to fail outright.
- **Palette provenance.** A portable Prusa project keeps its palette in
  `Metadata/Prusa_Slicer_full_spectrum.json`; both readers use it, refuse a project
  with no palette rather than reopening it white, refuse extruder ids that are not
  `1..N`, and report paint states the palette does not describe. PrusaSlicer
  multi-volume objects (triangle ranges, negative volumes) are refused rather than
  flattened.
- **QA that actually runs the real route.** `tests/web_qa.py` drives the real
  alien file online and checks the states above (it had been using a selector that
  no longer existed); `tests/targets_real_qa.py` reads each target's own palette
  source and reopens every archive it writes.

### 2.0.2 — export and analysis integrity (`VERSION` in `web/recolour.js`)

The second review pass (cases A–E of `FINAL_FIXES.md`), verified by two
independent root probes (`docs/agent-work/preview-targets-swaps/evidence/`):

- **Base colours follow the part.** An unpainted or state-0 facet prints in *its
  part's* filament, not in palette 1: both previews resolve it per part, and the
  assessment adds a base colour only where such geometry exists (a fully painted
  part no longer counts its unused base). Split-node leaves are aggregated too.
- **Selections and reachability.** Unticking everything is an error, never "all";
  a plate entry selects the build item its `instance_id` names (no copies from
  another plate); a component pointing at a missing mesh, and a mapping naming a
  filament the export does not write, are both refused before a download.
- **Control volumes are refused.** A negative volume, parameter modifier or
  support blocker would be solidified by this writer (`normal_part`), so the
  project is refused by both readers instead.
- **Prusa writer.** Correct `lastid` (no `<triangles>` off-by-one), both build
  items of a repeated object, no ghost metadata for inlined parts, and the item
  transform composes the part matrix with the plate offset.
- **Planner.** Per-tool retract debt consumed by paybacks (a moving payback is not
  a colour), a stationary purge still needs its reel, `G92 E` resets the
  coordinate only, whole-number tokens only (`E1oops` refused), hook-only layers
  found behind a real header, repeated start markers coalesced, and an `M600`
  followed by more printing refused.
- **ZIP.** Bounded compressed/per-member/total sizes with a streaming inflate
  limit, duplicate-name and checksum refusal.
- **State.** Upload epoch, review cleared on every semantic edit (reels, objects,
  plate, strategy, target, recipes), stale downloads cleared, and planner request
  epochs in both pages.

### 2.0.3 — final integration safeguards (`VERSION` in `web/recolour.js`)

### 2.2.0 — optional preview and real saved thumbnails

- **A saved project now carries a picture of itself.** Every download from the
  homepage converter and from the recolour page renders a fresh thumbnail from
  the *output* colours, the current assignment and the real transforms — never the
  source's own image, and never the file's old one.
- **It works whether or not you open the 3D view.** The picture is rasterised in
  the worker from the cached simplified surface and encoded to PNG there, with no
  canvas and no WebGL. On a machine with no WebGL the interactive preview says so
  and the saved thumbnail is still correct.
- **The camera cannot spoil it.** The thumbnail uses a fixed isometric view fitted
  to the model, so orbiting or panning the preview away cannot save a blank frame.
- **Packaged the way the importers read it.** Bambu Studio, OrcaSlicer and
  Snapmaker Orca projects get `Metadata/plate_1.png` (512) and
  `Metadata/plate_1_small.png` (128) with the standard package thumbnail
  relationship plus Bambu's `cover-thumbnail-middle`/`cover-thumbnail-small`, and
  the plate metadata names the file; PrusaSlicer gets `Metadata/thumbnail.png`
  (256) with the standard relationship. Every PNG is validated (signature and
  dimensions) before it is written, and a thumbnail that cannot be rendered fails
  the save rather than shipping a project without one.
- **Optional Show preview** on the homepage converter: Original and Output views,
  Reset view, orbit/pan/zoom, prepared only when you press the button, with the
  sub-divided-facet and "approximate surface, not toolpaths" notes.
- **A logical colour is still not a nozzle**: see 2.1.0 — the sharpened rule now
  also applies to the recolour page's Bambu export.

### 2.1.0 — portable conversion between dialects, with a simple repaint

- **One converter on the homepage.** The earlier single-object U1 upload, its
  four-slot limit and its inline script are gone; the page is now the N-colour
  converter, with the four supported dialects in the format chooser and the U1
  profile written only for the Snapmaker target.
- **Every source filament definition, the paint, the split-paint leaves, the
  default extruders and the geometry travel unchanged** — in any direction, with
  no four-slot veto and no colour substitution. A painted triangle or a part whose
  default extruder names a filament the palette does not describe is refused
  rather than replaced with filament 1.
- **A simple repaint table**: one labelled row per source colour with its own
  swatch and the destination it will be written as, an identity default, a
  simultaneous two-filament exchange and a reset. The chosen mapping is shown
  before download, and the swatch the page displays is the colour actually
  written.
- **Native Full Spectrum blends in the source are refused**, not flattened: the
  reader detects Bambu's `filament_is_mixed`/`filament_mixed_components`, the U1's
  enabled `mixed_filament_definitions` rows and PrusaSlicer's `virtual_extruders`,
  and conversion stops with a sentence explaining why. Tombstoned auto-pair rows
  are not mistakes and still convert.
- **Race-safe page state** (`web/shared/convertSession.js`): a new file terminates
  the old worker and rejects its replies, replies from a replaced file or a
  changed assignment are discarded, export is single-flight with a snapshot of
  file, plate, format and mapping, and any edit revokes the previous download.
- **Lightweight loading**: pure conversion asks the worker for metadata, the plate
  list and a triangle count only — no recolour mesh preparation, no per-facet
  state scan, no main-thread XML. A multi-plate project exposes a plate chooser
  instead of silently writing the first plate.
- **OrcaSlicer is a conversion target, not a blend target.** The new `orca`
  dialect writes Bambu-family paint with the application named `OrcaSlicer` (no
  invented build number); blend export to stock OrcaSlicer is refused, and the
  recolour page keeps its own proven three-target list.
- **A logical colour is not a nozzle.** A portable conversion to Bambu Studio or
  OrcaSlicer no longer writes a `nozzle_diameter` list sized to the filament
  palette (AMS slots are not nozzles), and the export refuses to claim one. The
  recolour exporters keep their own nozzle list.
- The recolour page is promoted with a button-style **Full Spectrum recolouring**
  link on the homepage, and links **back to the converter**.

### 2.0.4 — background worker, real simplification, accessible UI

- **Everything heavy runs in a same-origin module worker** (`recolour-worker.js`
  + `workerClient.js`): reading the ZIP, parsing, assessing, preparing the preview
  and writing the export. A new file gets a brand-new worker (the old one is
  terminated and its pending promises rejected), tokens are invalidated before any
  early return, and export is single-flight with a revision check.
- **The preview is a real reduced surface.** The worker now asks for the *whole*
  unsampled mesh as typed arrays and welds vertices onto a fitted grid
  (`simplify.js`), re-filling any edge the welding opens; a closed fixture stays
  closed (naked-edge test) and small fixtures are drawn exactly. The alien preview
  is 100,717 welded facets of 1,333,448 and reads as the model. Geometry is
  transferred once per selection and identified by id, so a stale reply cannot
  lose it.
- **Interaction costs**: Original/Result ~30 ms, a reel colour change ~30 ms (the
  assessment is cached per file+selection), the export ~6.6 s in the worker.
- **UI**: the drop zone is keyboard-operable, the status line is a polite live
  region with plain language, a "Choose another file" button appears while
  loading, elements have visible focus, the mapping table scrolls instead of
  overflowing on a phone, and the header says which of the three tasks this page
  is.

- **Sampled preview.** A capped preview now strides evenly across every triangle
  of the selection (one cursor across parts and instances) instead of keeping the
  first `cap`, so a big model shows its whole silhouette rather than one corner;
  both pages label it "sampled preview … the export is complete", and the export
  is unchanged.
- **Nested assemblies are refused** by the browser reader (assess, preview and
  export) with a sentence; a top-level assembly of leaf meshes still works.
- **Paint outside the palette is refused**: every source leaf must name a colour
  the file describes, and every remapped leaf must be within the written range.
- **Planner guards**: whole finite numbers only, `G92` accepts a tab, unknown
  commands/macros/mode lookalikes (`M820`, `G91.1`, `M1002 …`) are refused rather
  than skipped, passive commands are ignored on purpose, and `G90/G91` follow the
  declared `gcode_flavor` (Klipper independent E, Marlin resets E, undecided
  refuses at the next E word). `plan_text` no longer calls an included prime
  "ignored".
- **Prusa instructions** in both pages: open the export as a project with a
  four-extruder profile.
- **Reel-change planning from a real slice.** `u1gcode.py` was rebuilt (the
  earlier prototype double-counted layer markers): layers are coalesced, T0 tools,
  `M82`/`M83`, `G92`, retractions, arcs, supports/infill/wipe-tower deposition and
  startup extrusion are all handled, `M600`/pause sentinels are reported, and
  inches, volumetric extrusion and firmware retract are refused with a sentence.
  A layer needing more than four colours is reported as impossible to solve by
  boundary changes; otherwise the plan lists the initial load and every change,
  with the plan text and the evidence JSON downloadable.
- **Cross-language checks.** `python tests/export_js_fixtures.py` writes the Python
  answers as fixtures; `node web/tests/parity.test.mjs` fails if the browser
  modules disagree (131 checks), `node web/tests/project.test.mjs` exercises the
  browser reader/writer (27 checks), and `tests/test_js_exports.py` opens the
  archives the *browser* wrote with the Python readers.

## 1.3.0 — recolour onto your reels, with native Full Spectrum mixing

Still local only: `u1ui.py`, `u1ui.html`, `u1convert.py`, `u1project.py`,
`u1colour.py`, `u1paint.py`, and the new `u1mix.py` / `u1spectrum.py`. The
browser version in `web/` is unchanged and still reports 1.1.0.

- **The four loaded reels are the palette you recolour onto.** They are editable,
  remembered, and used as the destination of a direct print (when the selection
  fits four colours), a reviewed approximation, or the mixtures below. An
  imported source palette is never silently equated with what is in the machine.
- **A real mixture comparison, not a promise.** `u1mix.py` predicts every
  two-reel blend worth offering at 25/50/75 % with the MIT FilamentMixer
  polynomial (the same model Strata ships), compares it with the nearest single
  reel in CIELAB/CIE94, and offers a recipe **only** when it genuinely comes
  closer. Colours already matched exactly by a reel are never mixed, different
  materials are never blended, and a palette whose best match is still poor is
  answered with "load closer filament" rather than a mixture.
- **Native Full Spectrum export.** `u1spectrum.py` writes the four physical reels
  plus the recipes you tick as virtual filaments 5 onward:
  `mixed_filament_definitions` with the custom rows first and every unused
  automatic pair tombstoned (`d1/o1`, unique stable `u` ids), the
  `mixed_color_*` / `mixed_filament_*` settings, and every per-filament array
  extended to the new palette. Painted triangles are remapped to whichever id is
  closest, and the written archive is re-read and checked before it is published.
  The row grammar and the id rule come from the Snapmaker Orca 2.4.0 sources kept
  in `docs/agent-work/colour-strategy/references/`.
- **Bounded on purpose.** Twelve recipes (16 ids) is the writer's ceiling, because
  newer Prusa-format files encode higher ids with a different escape; a value
  above that is refused rather than rewritten. The project announces
  `Application = BambuStudio-2.3.5` and deliberately writes no
  `BambuStudio:MmPaintingVersion`, so the target build recognises the document.
- **The UI says what it does.** The candidate cards no longer say "not available
  yet": the Full Spectrum card shows the comparison table, each predicted recipe
  with its reels and swatch, a per-recipe tick, and a review tick that gates the
  export. Reel changes between layers are described as what the slicer decides,
  not as something this page guesses.

## 1.2.0 — local colour assessment

Local only: `u1ui.py`, `u1ui.html`, `u1convert.py` and the new modules below. The
browser version in `web/` is deliberately unchanged and still reports 1.1.0.

- **Multi-object and multi-plate files open instead of being refused.** A new
  project reader (`u1project.py`) reads the plate/object/component graph, the
  per-part colours in `Metadata/model_settings.config`, and the inner objects of
  shared mesh files, so a plate of twenty parts assembled from three meshes is
  understood rather than flattened. Choosing a plate and ticking objects drives
  the assessment, the colour mapping and the export; one plate at a time, and
  nothing from another plate can leak into the output. Repeated instances and
  path-less ("inline") components both resolve.
- **The palette in a file is a menu, not the colours a print uses.** The page and
  `--list-plates` report the source slots that are actually used by the selection,
  per object, with the painted-triangle counts that back it up.
- **Colour assessment with honest options.** A selection that fits four colours
  offers a direct print that keeps them; one that needs more offers separate
  prints per object group (objects are never split into parts) or an explicit
  approximation onto four editable, remembered "loaded reels" (white, black,
  green, orange PLA by default). Full Spectrum mixing and mid-print swaps are
  listed as candidates with no button, because neither is trustworthy yet. The
  nearest-colour suggestion is a CIELAB/CIE94 estimate with the original and the
  result shown side by side, and every colour can be overridden.
- **Sub-divided paint is remapped properly.** `u1paint.py` decodes and re-encodes
  the shared paint bitstream, including the split-node form used by brush painting,
  so a colour that has to move slot moves in every triangle it appears in. A value
  the codec cannot explain is copied through when nothing is renumbered and stops
  the export when a remap would have to look inside it. The format was checked
  against 671 sub-divided values from the user's own PrusaSlicer file: every one
  round-trips bit for bit.
- **A Prusa file's `extruder_colour` is preferred over its placeholder
  `filament_colour`**, so a five-colour model with eight identical
  `filament_colour` entries is counted as five colours, not eight (the existing
  behaviour, now also covered by a real-file test).
- **The export is verified against the source it came from.** `verify_export`
  re-reads the archive it just wrote, walks its own object graph and compares
  triangle counts and post-mapping paint totals with the source selection, checks
  that no Prusa attribute name survived and that no paint state points outside the
  four U1 slots. The log reports the result; the tests assert it.
- **The plate is normalised, not rebuilt.** Objects keep their relative
  arrangement; the whole selection is translated so it is centred on the U1 bed
  with its lowest point on Z=0. Orca's own slice of a converted plate reports the
  object's centre at the bed centre (135.5, 136 on a 270 mm bed).
- **Copies/fill-bed are refused for multi-object plates** with an explanation,
  rather than flattening the layout or dropping parts.

## 1.1.0

- Carry the source's print-intent settings instead of discarding them. Layer
  heights, shells, infill density *and pattern*, ironing, fuzzy skin, elephant
  foot, brim/raft and the painted-region knobs now come from the file, and
  PrusaSlicer's names for the same settings are mapped across so a Prusa project
  carries as much as a Bambu one. On the pumpkin that means `ironing_type = top`
  survives instead of becoming "no ironing".
  Machine and filament settings still come from the U1 profile — bed and filament
  temperatures, speeds, accelerations, retraction, purge and prime-tower numbers,
  toolchange g-code, and the bed geometry all describe the printer that wrote the
  file. The log says how many settings were carried, and a checkbox turns it off.
- Fix the plate layout running over the bed edge, which is what produces Orca's
  "Model too close to bed boundary" warning. The column and row counts were
  measured against the whole bed and then the block was required to fit *with* a
  margin, so a wide grid had no valid position, and the fallback centred it over
  the edge instead. The margin — the brim, plus 4 mm for the clearance spiral
  lifting needs — is now subtracted before counting, so the grid comes out a
  little smaller and stays inside. A 15-piece plate of ghosts now fits 45 copies
  with the brim edge ~27 mm from the boundary, rather than 52 hanging off it.
- Plates holding several copies of one model now convert, which covers MakerWorld
  downloads and plates someone arranged and saved. The first placement carries the
  scale and orientation and the layout is rebuilt from the copies/spacing controls.
  A plate of several *different* models still cannot be handled.
- The local UI page (`u1ui.py`) catches up with the browser version: same version
  badge, light/dark themes, full-size Save button and footer links. Its `.sub` line
  now also says what it does that the browser version cannot (your installed Orca
  profiles, and checking a plate by slicing it).
- Light and dark themes. The page follows your system setting until you use the
  toggle in the header, after which your choice is remembered.
- The file picker is reachable from the keyboard. It was `display: none`, which
  hid it from the tab order entirely; it is now visually hidden but still
  focusable, and there are visible focus rings throughout.
- Footer links: Product Kit, a contact address, the renamed GitHub repo, and two
  more 3D tools by the same author (Strata, Spool Studio).
- The output carries the source's preview image, written as both `Metadata/thumbnail.png`
  (what Windows and PrusaSlicer look for) and `Metadata/plate_1.png` (Bambu Studio and
  Orca), so the file shows a thumbnail rather than a generic icon.
- A full-size Save button replaces the small link that used to appear in the log.
- The `Supports: Off` option now says so when the model carries painted support
  enforcers, because that combination is the one Orca warns about.
- `og:` tags so a shared link gets a proper preview, a `<noscript>` notice, and
  roomier spacing on narrow screens.
- The log panel and button hover state now come from the theme variables, so
  nothing stays dark-on-dark in light mode.

## 1.0.0

First release.

- Converts Bambu Studio, OrcaSlicer and PrusaSlicer 3MF projects into Snapmaker U1
  (Snapmaker Orca) projects.
- Keeps multi-colour painting, support painting and the source's support decision
  intact. Orca reads only `paint_color` / `paint_supports`, while PrusaSlicer writes
  `slic3rpe:mmu_segmentation` / `slic3rpe:custom_supports` — without the rename,
  every painted triangle is silently dropped.
- Maps the source's extruders down to the U1's four slots, taking colours from the
  file's tool palette rather than its filament palette.
- Fills the plate with a prime-tower aware layout, reporting the geometric count and
  optionally checking the result by slicing.
- Two front ends over one implementation: `web/` runs entirely in the browser with no
  backend, and `u1convert.py` (CLI) plus `u1ui.py` (local UI) do the same offline.
- The web version's settings baseline is derived from
  [bl2u1](https://github.com/josuanbn/bl2u1), which is GPL-3.0 licensed — see
  "Attribution and licence" in the README.
