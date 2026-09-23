# YAB3D — Yet Another Bloody 3D Tool

Convert, recolour and arrange. YAB3D is a browser-based 3MF tool: it
moves a painted project between Snapmaker Orca, Bambu Studio, OrcaSlicer and
PrusaSlicer without losing a colour, recolours onto your own reels with predicted
blends, and arranges the filament slots so the printer matches the model.

Formerly yab3u1 — Yet Another Bloody 3MF-to-U1 converter. The name on the page
changed; the repository, <https://yab3u1.netlify.app> and the module and storage
identifiers did not.

Open **[yab3d.uk](https://yab3d.uk)**. The original Netlify address remains available.

Three ways to use the project, with different workflows:

| | where | what it is |
| --- | --- | --- |
| **`U1 Converter` shortcut** | this machine | local web UI (`u1ui.py` + `u1ui.html`), reads your installed Orca profiles and can verify a plate by slicing |
| **`u1convert.py`** | any machine with Python | the command line tool; `--fill-bed`, `--verify`, `--supports`, `--colors` |
| **`web/`** | any static host — live at <https://yab3u1.netlify.app> | [browser version](#the-browser-version-web) — v2.4.3, the whole conversion in the page, nothing uploaded |

A local replacement for [bl2u1.nbn.cat](https://bl2u1.nbn.cat) /
[josuanbn/bl2u1](https://github.com/josuanbn/bl2u1) that actually works on
PrusaSlicer-family files, actually keeps the painted colours, and can fill the
plate without producing a file that refuses to slice.

These are not the same program. The `U1 Converter` shortcut and `u1convert.py`
run on your machine, so they read the profiles installed in Snapmaker Orca and
can ask the slicer to verify a plate; the browser copy ships a fixed baseline
profile, cannot reach your machine and cannot verify a slice. The browser has the newer
format converter and assignment interface; cross-language tests check the common
paint, palette and export rules. The interfaces and target behaviours are not
feature-identical.

**Built and tested against Snapmaker Orca (SnOrca).** That is not the same thing as
testing against OrcaSlicer generally: the setting *names* and *values* move between
versions, and a 3MF written by a newer build can carry enums or ranges an older one
rejects outright. Snapmaker Orca is what the U1 ships with, so that is the target.

## The browser version (`web/`)

The conversion is pure byte-shuffling — unzip, rewrite the project, the palette
and the paint, rezip — so it runs entirely in the page. No backend, no uploads, no
server upload limits; practical model size depends on browser memory. Your
model never leaves the machine.

There are two routes, both static:

* **`index.html` — convert.** A painted 3MF moves between Snapmaker Orca, Bambu
  Studio, OrcaSlicer and PrusaSlicer in any direction, keeping every source
  filament definition, the paint and the geometry. The filament assignment table
  has two modes: **Arrange slots** (the default) keeps every colour and moves it
  to the filament you pick — the colour already in that slot takes the vacated
  one, so nothing is merged and the model looks exactly as it did — and
  **Repaint colours** prints a source colour in another filament's colour, where
  two colours sent to one filament merge. Choose directly in each colour's row;
  **Reset assignments** restores the original mapping. Every row and option
  names its colour beside the hex, and a rearranged file says so in its metadata. Projects carrying native Full Spectrum blends are refused rather
  than flattened.
  An optional **Show preview** draws Original and Output views of the model
  (prepared only when you ask), and every download carries a thumbnail rendered
  from the output colours, so Explorer and the slicers show what you saved.
  Slot numbers are the file's own filament list: Bambu Studio's import dialog
  reads that list and may rebind it to your AMS, so the file cannot promise a
  particular physical slot.
* **`recolour.html` — Full Spectrum recolouring.** Recolour onto four reels of
  your own, with predicted blends, review and a native export — which also saves
  a regenerated output thumbnail.

Parsing, writing and the (optional) preview all run in a module worker, so a big
project never blocks the page.

```
web/
  index.html                the converter (drop zone, plate/format, assignment, download)
  convert-page.js           the converter's page logic (thin: state lives in the session)
  recolour.html             the Full Spectrum recolouring page
  recolour.js               its page logic
  converter.js              the earlier single-object U1 conversion, kept for selftest.html
  shared/project.js         read, assess and rewrite a 3MF
  shared/assignment.js      slot arrangement / repaint, and the offline colour names
  shared/convertSession.js  epoch-guarded load/assignment/export state
  shared/raster.js          software rasteriser for the saved thumbnail (no WebGL)
  shared/png.js             canvas-free PNG encoder/reader
  shared/thumbnail.js       target thumbnail members, sizes and relationships
  shared/preview.js         the shared WebGL preview used by both pages
  shared/targets.js         the four dialects and their palette/recipe schemas
  shared/recolour-worker.js the worker: parse, preview and write, off the UI thread
  shared/workerClient.js    the page's typed wrapper around that worker
  zip.js                    ZIP read/write on DecompressionStream/CompressionStream
  base_settings.js          bundled U1 project settings (see make_base_settings.py)
  selftest.html             self-test page for converter.js
  selftest-fixture*.3mf     tiny Prusa and Bambu fixtures it uses
  make_fixtures.mjs         regenerates those fixtures
  icon.ico                  the same icon, as the favicon
```

The pages report their own version (`VERSION` in `web/convert-page.js` and
`web/recolour.js`); the live deployment is **v2.4.3**.

**Deploying.** The Python UI cannot go on a static host — it needs your Orca
install and the slicer — but the browser converter can, and that is what
<https://yab3u1.netlify.app> serves. `tools/build_site.py` builds the publishable
site into `dist/`: the two pages, the modules and the worker they load, the icon,
`LICENSE` and `THIRD_PARTY_NOTICES.txt`, and nothing else. The tests, the
fixtures, the Python applications, the private models and the planning notes are
never copied. Nothing you drop on either page is uploaded anywhere — the
conversion and downloaded files stay on your machine.

```
python tools/build_site.py     # writes dist/ from web/
python serve.py                # http://127.0.0.1:8231 serves web/ for local checks
npx netlify deploy --prod --dir dist --site 9a37f1d8-ee76-4b19-ab7d-382277fb7850
```

`Deploy U1 site.bat` runs the build and then that deploy. `netlify.toml` runs the
same script on Netlify with `dist` as the publish directory, so a Git-connected
build produces the same site as a local one. `dist/` is generated and is not
committed.

`web/` is the site's source; `dist/` is only ever a copy of the parts of it that
belong online. Being a static folder, the build also drops straight onto
**Netlify Drop** (drag `dist/` onto the page) or **GitHub Pages** — neither needs
a CLI login. (`vercel.json` at the root still points a Vercel import at `web/`;
Netlify is what this project actually deploys to.)

**Previewing locally:** `python serve.py` serves `web/` on
http://127.0.0.1:8231 (opening `index.html` straight off disk will not work —
ES modules need a server).

**What it gives up** relative to the desktop tool, both because a web page can't
reach your machine:

* it cannot read the profiles installed in Snapmaker Orca, so the settings come
  from the bundled baseline (a fixed `0.20mm Standard @Snapmaker U1` project). The
  Snapmaker export uses that baseline with the compatible source settings you
  choose to retain. Choose the appropriate printer and filament profiles in your
  slicer after importing.
* it cannot run Orca to verify a plate slices, so `Fill plate` reports the
  geometric capacity only.
* `Fill plate` reserves the prime tower's space by default — **Leave room for the
  prime tower** is ticked when a model loads, the same reservation the local
  `Fill bed` makes — and the checkbox can be cleared for a print that does not
  need it.
* **what each target carries differs.** A Snapmaker Orca (U1) export keeps the U1
  profile and the source file's own *compatible* print settings — the support
  decision, the shell and the infill — through the same reviewed allowlist the
  local tool uses, while the printer, the speeds, the temperatures and the
  filaments stay the bundled baseline's. Bambu Studio and PrusaSlicer exports are
  **colour projects**: geometry, parts, the palette, the paint and the recipes,
  with the U1's printer, process and start/end G-code left out, and no
  `Metadata/Slic3r_PE.config` for PrusaSlicer to override your own preset with.

## Multi-object files: one plate, some objects, honest options

Real projects are not one object with four painted colours. A plate can hold
twenty parts assembled from shared mesh files, the colours can live in per-part
metadata rather than in the paint, and the palette in the project settings is a
*menu* rather than the colours a print actually uses. The local tool
(`u1ui.py`) and the command line now handle that deliberately:

* **the plate comes first.** Drop a file and the page lists its plates, the
  objects on the first one, and how many source colours *that selection* really
  uses — not how many the palette holds. One plate is exported at a time and only
  the ticked objects go into it; nothing else can leak in from another plate.
* **the four loaded reels are yours.** Slot 1-4 have editable colour and material
  and are remembered between sessions; they start as white, black, green and
  orange PLA. They are never silently equated with colours from the file.
* **every option says what it costs.** A selection that fits four colours offers a
  direct print that keeps them exactly. One that needs more offers separate prints
  per object group (objects are never split into parts) or an explicit
  approximation onto the loaded reels, with the original and the result side by
  side and a tick to confirm you have looked at it. Full Spectrum mixing and
  mid-print swaps are listed as candidates, with no button, because neither is
  trustworthy from this tool yet.
* **the mapping is an estimate, and says so.** Source colours are compared with
  the reels in CIELAB using the graphic-arts CIE94 weighting (plain Lab distance
  thinks brown is closest to white). Every colour can be pointed somewhere else.
* **support and seam painting are renamed, never renumbered**, and sub-divided
  (brush-painted) triangles are rewritten state by state. A paint value the tool
  cannot decode stops a remap rather than being written back as something else.

The command line does the same thing:

```
python u1convert.py --list-plates "project.3mf"        # plates, objects, colours, options
python u1convert.py "project.3mf" --plate 1 --objects 11   # direct, if it fits four
python u1convert.py "project.3mf" --plate 1 --objects 11 \
    --slots "#FFFFFF,#000000,#3D9140,#FF9500" --approximate --map "5:3"
```

`--list-plates` prints what each plate uses and what the tool would do with it,
and refuses to guess: a selection with more colours than slots tells you to split
it or to name your reels first.

## Recolouring onto your own reels, with Full Spectrum mixing

A painted model is rarely painted in the colours you have loaded. The page treats
the four reels you tell it about as the palette you are printing onto, and offers
three honest ways across:

* **Direct** — when the selection needs four colours or fewer, they print from
  slots 1-4 exactly as the file has them.
* **Approximation onto the reels** — every source colour is matched to the
  closest loaded reel in CIELAB (CIE94), shown side by side with the original,
  and nothing is substituted until you accept the mapping. The row for each
  colour is a dropdown, so any match can be overridden.
* **A mixture, when mixing actually helps** — the page predicts every two-reel
  blend at 25/50/75 % with the MIT FilamentMixer polynomial and compares it with
  the nearest single reel. A recipe is offered only when it comes closer; a
  colour that already matches a reel is left alone, and two different materials
  are never blended. Tick the recipes you want, tick that you have reviewed the
  predicted shades, and the export writes them.

The mixture export is a **native Full Spectrum project** for Snapmaker Orca:

```bash
python u1convert.py "model.3mf" --plate 1 --spectrum \
    --slots "#FFFFFF,#000000,#3D9140,#FF9500"
```

The four reels keep ids 1-4 and each recipe becomes the next virtual filament
(5, 6, …); painted triangles are repointed at whichever id is closest. The
recipe table is written as `mixed_filament_definitions` with the custom rows
first and every unused automatic pair tombstoned, so the ids cannot shift when
the slicer rebuilds its own pair rows. Twelve recipes (16 ids) is the ceiling,
because newer Prusa-format files encode higher ids with a different escape — and
a file that arrives already using one is refused rather than rewritten. The
project is written for the Snapmaker Orca build that carries Full Spectrum
(2.4.0 is the installed target) and announces itself as
`BambuStudio-2.3.5` without a painting-version tag, so it opens as a project
rather than as a pile of geometry.

**Predicted shades are not a calibration.** They are interpolated from the
swatch colours you type, with no knowledge of translucency, extrusion effects or
the mixing hardware. What the prediction is good for is *ranking*: telling you
that a blend comes closer than either reel, or that it does not, so you can
decide whether mixing is worth trying. Nothing is mixed unless you say so.

## Preview, three targets, and planning from a real slice

`python u1ui.py` (local) and `web/recolour.html` (online) are the same feature set;
the second runs entirely in the browser and shares its modules with the first, so
the picture, the palette and the plan cannot drift apart.

**Preview.** The selection is drawn as it will print, in the colours the export
would write, with orbit, pan, zoom and reset. Sub-divided (brush-painted) facets
are drawn in the dominant colour of their leaves, which the page says out loud:
the exported attribute still carries every leaf. A facet whose paint this tool
will not rewrite is drawn in a warning colour and counted instead of guessed at.

**Targets.** One click exports a project for any of:

| Target | What is written |
| --- | --- |
| Snapmaker Orca (default) | The U1 profile with the recipes as native `mixed_filament_definitions` rows; the four physical slots stay four, so the first recipe is filament id 5. |
| Bambu Studio | A portable colour project whose palette covers the physical reels *and* the recipes, with Bambu's own `filament_is_mixed` / `filament_mixed_components` / `filament_mixed_sublayer_ratios` fields. |
| PrusaSlicer | A portable colour project with `Metadata/Prusa_Slicer_full_spectrum.json` (the palette: four physical extruders, then the recipes), every mesh inlined into the model file, and paint as `slic3rpe:mmu_segmentation`. No `Metadata/Slic3r_PE.config` is written, so the project cannot override your own print preset. |

Bambu and Prusa exports deliberately carry **none** of the U1's printer, process or
start/end G-code: they are colour projects to open with your own profile. The
Snapmaker one is the appliance project it always was.

Open a Prusa export as a **project** with a four-extruder profile. Both readers
take the colours from whichever place the project keeps them: the print config
when PrusaSlicer wrote the file, or the Full Spectrum description when it is a
portable colour project. A project with neither is refused with a sentence rather
than reopened as white defaults, and a PrusaSlicer object built from several
volumes (triangle ranges, including negative volumes) is refused instead of
flattened into one filament.

**Planning from a real slice.** Everything the assessment says about colour is a
surface estimate until the file is sliced. Drop the sliced `.gcode` (or a sliced
3MF, in which case the page asks **which** G-code member inside it to read rather
than guessing) and the plan is read from the slicer's own toolpath:

```bash
python u1gcode.py  # not a CLI: import u1gcode; u1gcode.analyse(text)
```

It reports which filaments really extrude in each layer, refuses a file whose
layers need more than four colours (those layers cannot be separated by changing
reels between layers), and otherwise prints the initial load and every boundary
change, as a text plan plus a JSON record of the evidence. Your G-code is never
modified or rewritten, and no pause is ever inserted into it.

## Why the online tool failed

Two separate problems.

**1. The file isn't a Bambu file.** `Flippin Pumpkin painted.3mf` is a
**PrusaSlicer 2.9.6 project for an Original Prusa XL 5T**, not a Bambu Studio
project. The online tool only looks for Bambu files:

```python
if 'Metadata/slice_info.config' in names: ...          # absent
if not filaments and 'Metadata/project_settings.config' in names: ...   # absent
→ "Could not parse filaments from the uploaded file"
```

Your file contains `Metadata/Slic3r_PE.config` and
`Metadata/Slic3r_PE_model.config` instead, so the tool finds nothing.

**2. The two families name the painting attribute differently.** This is the
subtle one. PrusaSlicer, Bambu Studio and OrcaSlicer all share one code base,
so the painted-triangle bitstream is byte-for-byte identical — but the XML
attribute carrying it is spelled differently:

| meaning                | PrusaSlicer                        | Bambu Studio / OrcaSlicer |
| ---------------------- | ---------------------------------- | ------------------------- |
| multi-material paint   | `slic3rpe:mmu_segmentation`        | `paint_color`             |
| support painting       | `slic3rpe:custom_supports`         | `paint_supports`          |
| seam painting          | `slic3rpe:custom_seam`             | `paint_seam`              |
| fuzzy skin painting    | `slic3rpe:fuzzy_skin`              | `paint_fuzzy_skin`        |

Both readers call the *same* `TriangleSelector::set_triangle_from_string`, they
just look for a different attribute name (`src/libslic3r/Format/3mf.cpp` uses the
`slic3rpe:` names, `src/libslic3r/Format/bbs_3mf.cpp` uses the `paint_*` names).
Snapmaker Orca loads a project through the Bambu reader, so a Prusa model file
copied into a Bambu container drops every painted triangle and collapses the
model to one colour. This tool renames the attributes instead, so the paint
survives untouched.

## What carries over, and what does not

Carried from the source file:

* **multi-colour painting** — the whole point, renamed not re-encoded
* **support painting** (`slic3rpe:custom_supports` → `paint_supports`), and
  seam/fuzzy-skin painting when present
* **the support decision** — `support_material`, `support_material_auto` and
  `support_material_style` become `enable_support` / `support_type`
  (`support_material_auto = 0`, i.e. "only where I painted", maps onto Orca's
  `(manual)` form). The U1 process default is supports **off**, so without this
  both the painted regions and the intent would be silently dropped. The
  **Supports** control has three settings:

  | setting | result |
  | ------- | ------ |
  | `From the source file` (default) | follows the file — for this pumpkin `tree(manual)` at 40° |
  | `On` | enables supports but keeps the *profile's* type and angle, i.e. `tree(auto)` at 30° — Orca's normal behaviour, and what you get if the source was painted-only and you would rather not be limited to the painted regions |
  | `Off` | no supports |

  Both models here carry **painted support enforcers**, and Orca refuses to leave
  those alone with support switched off — it warns "Support enforcers are used but
  support is not enabled". So the tool never does that quietly:

  * `From the source file` with a source whose flag is off but which carries
    enforcers → supports are enabled anyway (which is what Orca's warning asks for)
    and the log says so;
  * `Off` on a model with enforcers → honoured, with a note that Orca will warn and
    the enforcers will do nothing.
* **the object's own colours/material per slot**, and its placement

Deliberately *not* carried: the print settings (layer height, infill, speeds,
temperatures, retraction). Those belong to the Prusa XL and would be wrong for
the U1, so the output gets the installed `0.20mm Standard @Snapmaker U1` process
and your chosen filament profile instead. Per-object setting overrides stored in
the source project are also not copied.

## Use it

Nothing to install — Python 3.8+ and its standard library is all either entry
point needs.

### The easy way

Double-click **`U1 Converter`** (the shortcut — it has the icon), then drag a
`.3mf` onto the page it opens (http://127.0.0.1:8756). You get the detected source
format, the painted triangle counts, an editable colour/material row per slot, the
filament and process profiles, a **Supports** choice and the **Fill bed** button.
Close the console window to stop it.

A `.bat` file can never show a custom icon in Explorer — Windows always draws the
generic console icon for it — so `U1 Converter.lnk` is a shortcut to
`Start U1 Converter.bat` that carries `u1convert.ico`. Both work; the plain `.bat`
is still there if you would rather not have the shortcut. The icon is drawn by
`make_icon.py` (`python make_icon.py --png` also writes a preview), and the same
`.ico` is served as the page favicon.

You can also start it by hand:

```
python u1ui.py
python u1ui.py --port 9000 --no-browser
```

It listens on `127.0.0.1` only and serves one HTML file; nothing leaves the
machine.

### The command line

```
python u1convert.py "model.3mf"
python u1convert.py "model.3mf" -o out.3mf
python u1convert.py "model.3mf" --fill-bed
python u1convert.py "model.3mf" --copies 6 --gap 4
python u1convert.py "model.3mf" --colors "#FF8000,#008000,#000000,#FFFFFF"
python u1convert.py "model.3mf" --filament "Snapmaker PLA Silk @U1"
python u1convert.py --list-filaments
```

| option            | meaning                                                       |
| ----------------- | ------------------------------------------------------------- |
| `--profile-dir`   | Orca profiles folder; auto-detected from the usual installs    |
| `--machine`       | printer preset (default `Snapmaker U1 (0.4 nozzle)`)           |
| `--process`       | process preset (default `0.20mm Standard @Snapmaker U1 (0.4 nozzle)`) |
| `--filament`      | filament preset for all four slots                             |
| `--colors`        | override slot colours, comma separated                         |
| `--types`         | override slot filament types, comma separated                  |
| `--copies N`      | lay N copies out across the plate                              |
| `--fill-bed`      | lay out as many copies as actually fit                         |
| `--gap MM`        | spacing between copies (default 5 mm)                          |
| `--supports`      | `auto` (follow the source, default), `on` or `off`             |
| `--verify`        | slice each candidate layout, keep the largest that slices      |
| `--no-reposition` | keep the original placement                                    |

`u1_base_project_settings.json` is the baseline key set (lifted from
bl2u1's `u1_template.3mf`); the installed profiles are overlaid on top of it,
so the result tracks your Orca version.

## Filling the plate

Orca's own clone tool happily produces a plate that then fails to slice. The
failure mode is specific:

```
error: gcode path conflicts found between WipeTower and <plate>
error: plate 1: found slicing result conflict!
```

The prime tower anchors at `wipe_tower_x/y` (it is *not* relocated at slice time —
`Print.cpp` passes that position straight into the conflict checker), so a layout
that overlaps it gets flagged. Two things make that hard to predict from geometry:

* the tower's footprint is computed *while slicing* — for a 30 mm tower with a
  5 mm brim it measures about 47 × 47.5 mm, starting ~10 mm before the anchor;
* it **grows with the number of tool changes**, so more copies means a deeper
  tower than the one the previous attempt measured.

The grid keeps the tower's rectangle clear — including each copy's brim, which is
what makes a grid that merely *looks* clear actually collide — and then, because a
wide enough layout has to be judged by the slicer rather than by arithmetic,
`Fill bed` **checks its work by slicing** the largest layout and reporting what it
finds:

```
copies       : 12 (3 x 4 grid, 5 mm apart, geometry allows 12)
verify       : asking snapmaker-orca.exe how many fit
verify       : 12 copies sliced, with a prime-tower warning
warning      : gcode path conflicts found between WipeTower and Flippin Pumpkin
warning      : the command line gates on a stricter prime-tower model than the GUI
               and refuses to export; Orca itself only warns, so this plate should
               preview and slice normally there.
```

For the pumpkin that is **12 copies** — which is what a hand-made 12-up plate for
this model has, and what Orca previews and slices.

The layout slides the grid aside to clear the tower's corner rather than deleting
the copies that land on it (the hand-made plate does the same: same 5 mm grid,
block shifted ~18 mm right).

## About the "gcode path conflicts" warning

`Fill bed` can check its work by slicing (`Check it slices`, or `--verify`). Early
versions treated the slicer's conflict message as fatal and quietly dropped copies
— which was wrong, and worth explaining because the message is alarming:

```
gcode path conflicts found between WipeTower and <plate>
```

The **command line** refuses to export on any of these, but it runs a *stricter*
prime-tower model than the GUI, as its own message says:

> "G-code conflicts detected after slicing. Please make sure the 3mf file can be
> successfully sliced in the latest Orca Slicer. If the file slices normally in
> Orca Slicer, try moving the wipe tower further from other models, **as we use
> more conservative parameters for it during upload**."

It is a pre-upload gate for cloud printing, not a verdict on the plate. The GUI
only records the conflict (`Print.cpp` stashes it in the result and carries on) —
which is why a hand-made plate that the CLI refuses previews and slices fine in
Orca. So `--verify` now downgrades a conflict to a **warning**, reports it, and
keeps the copies instead of backing off. Only real errors cause it to step down.

The practical hint stands: if Orca does complain, **Arrange** in Orca packs the
silhouettes and positions the tower in one pass, which a file written in advance
cannot do.

One wrinkle when checking someone else's saved plate with the CLI: Orca refuses
files whose `Application` metadata names a version newer than the CLI is, e.g.

```
Version Check: File Version 2.4.0.0 not supported by current cli version 01.10.01.50
```

so a project saved by the 2.4 GUI cannot be sliced by the bundled CLI at all. Files
written by this tool say just `Snapmaker Orca` with no version, so they pass.

## Result for `Flippin Pumpkin painted.3mf`

```
palette      : 5 slots from extruder_colour
paint        : extruder 1 on 416561 tris, extruder 2 on 26256 tris, extruder 3 on 33203 tris
slots        : 1<-1 #FF8000, 2<-2 #008000, 3<-3 #000000, 4<-4 #FFFFFF
placement    : recentred on the U1 bed
```

Verified headlessly against the installed Snapmaker Orca
(`C:\Program Files\Snapmaker_Orca\snapmaker-orca.exe`):

| check                                          | result |
| ---------------------------------------------- | ------ |
| `--info` on the output                          | exit 0 — 639959 facets, size 63.9 × 53.0 × 56.9 mm, volume 76818.3 mm³: identical to the source |
| `--slice 0` on the output, single copy          | exit 0, 12.2 MB of G-code |
| tools used in that G-code                       | slot1 51.7 %, slot2 1.8 %, slot3 20.3 %, slot4 26.2 % |
| printed footprint                               | X 2.0–185.0, Y 1.0–248.8, Z 0.2–53.5 — inside the U1 area |
| supports carried over                           | source says `support_material=1`, organic, painted-only → output `enable_support=1`, `tree(manual)`, 40°; G-code contains 416 Support/Support-interface sections where forcing supports off contains none |
| `--fill-bed --verify`                           | exit 0, **12 copies**; the CLI reports its prime-tower conflict, which it downgrades to a warning |
| capacity vs spacing (UI, `/api/replan`)         | 5 mm → 12, 10 mm → 10, 20 mm → 8, 40 mm → 5, 7777 mm → 1 |
| the same layout without the tower reservation   | exit ≠ 0, "gcode path conflicts found between WipeTower and ..." |
| `--slice 0` on the original file as-is          | exit ≠ 0 |

The paint rename was isolated with a controlled A/B: an earlier build left the
namespace prefix on (`slic3rpe:paint_color`) and the slice came out **100 % one
tool**; with the attribute spelled `paint_color` the same model slices with **four
tools**. That is the difference between "colours preserved" and "colours lost",
and it is invisible until you slice.

One more trap worth naming, because it bites silently: the two containers put the
translation in different places. A 3MF `<item transform>` is a 4×3 matrix with the
translation in the **last row**; the `matrix` metadata PrusaSlicer and Orca write
for a volume/part is a 4×4 with the translation in the **last column**. Treating
them alike happens to work when the volume matrix is identity — which is the case
for `Flippin Pumpkin painted.3mf` — and produces a six-metre-wide model the
moment it isn't. `Flippin Pumpkin flat bottom painted.3mf` is such a file; it now
reports 63.9 × 56.9 × 51.3 mm, as it should.

Note on the original file being opened directly: Orca does apply its Prusa-format
reader to it, but that reader path deliberately ignores `Metadata/Slic3r_PE.config`
(the call is commented out in `3mf.cpp`), so no U1 printer, process or filament
settings are applied — you get the geometry under whatever preset happens to be
active. Slicing it that way failed here.

## Checking it still works

Everything is runnable offline, and each check has paid for itself — the browser
self-test is what caught the attribute-rename slip that silently dropped support
enforcers.

```
python u1convert.py "model.3mf" --fill-bed --verify   # convert, then slice to check
node inspect_3mf.mjs "model.3mf"                      # what the JS reader makes of it
python make_base_settings.py                          # regenerate web/base_settings.json
node web/make_fixtures.mjs                            # regenerate the self-test fixtures
python serve.py                                       # serve web/ for the browser test
.\run_browser_test.ps1 -Url "http://127.0.0.1:8231/selftest.html" -Wait 15
python -m unittest discover -s tests -t . -v          # the focused tests (local, fast)
python -m unittest tests.test_real_files -v           # acceptance, if the example files are here
python tests/browser_qa.py --full                     # drives the local page in Chromium
```

The focused tests build their own small projects (shared mesh members, per-part
colours, inline parts, sub-divided paint, five-colour selections) so nothing
copyrighted is kept here; the acceptance module only runs when the user's own
example files are present, and never writes next to them. `tests/browser_qa.py`
uploads the real files through the page, edits a reel, exports directly and as an
approximation, switches plate, and puts its screenshots and transcript in
`docs/agent-work/colour-assessment/evidence/`.

`web/selftest.html` converts a fixture in the browser, checks the archive it
produced (one object and one item per copy, every painted triangle renamed, nothing
left in the Prusa spelling), round-trips the single-copy result back through the
reader, and reports PASS/FAIL. `run_browser_test.ps1` drives it in headless Edge
and kills only the browser it started, never your own windows.

The two fixtures are a 20 mm painted cube in each container flavour — Prusa with the
mesh inline, Bambu with the mesh in `3D/Objects/` and a `<component>` transform.
The second one matters: it is the shape Orca itself saves, and it is what exposed
both the `<item>`-in-the-wrong-document bug and the base-extruder bug below.

Verified on the real file (68 MB mesh, 476,020 painted triangles) in headless Edge:
the conversion runs in ~4.9 s and the archive it produces is accepted by Orca —
`--info` exit 0 with 12 instances and 639,959 facets, `paint_color` 476,020 and
`paint_supports` 35,319 (byte-for-byte the same object sizes as the desktop tool).

## Attribution and licence

Based on [bl2u1](https://github.com/josuanbn/bl2u1) by josuanbn.

Exactly one file here comes from that project: `u1_base_project_settings.json` is
extracted from its `u1_template.3mf` — the Snapmaker U1 machine, process and
filament baseline — and `web/base_settings.js` is generated from that. Everything
else is not derived from bl2u1. Additional sources used by later features are:

* [FilamentMixer](https://github.com/justinh-rahb/filament-mixer) by Justin Hayes:
  the MIT-licensed polynomial coefficients used for predicted blend colours,
  brought across through Strata's JavaScript port. The original notice is in
  [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
* [PaintPort](https://github.com/perspektive3D/paintport): format documentation
  consulted for interoperability; its implementation was not copied.
* [OrcaSlicer FullSpectrum](https://github.com/ratdoux/OrcaSlicer-FullSpectrum)
  and [Snapmaker Orca](https://github.com/Snapmaker/OrcaSlicer): reference for
  native mixed-filament settings and identifiers.
* [Bambu Studio](https://github.com/bambulab/BambuStudio) and
  [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer): importer behaviour and
  the `TriangleSelector::perform_split` algorithm used to implement exact
  subdivision of painted faces for standard-colour 3MF export.

bl2u1 ships the **GNU GPL v3**: its README says MIT, but the `LICENSE` file in the
repository is the full GPL-3.0 text, so that is the licence that actually applies.
Because this project redistributes a file taken from it, those terms come with it,
and `LICENSE` here is the same GPL-3.0 text. In practice, if you publish or pass
this on: keep the attribution and the `LICENSE` file alongside it, and note it if
you change that settings file. The source is the source — it's all here.

If you'd rather not carry any of that, delete `u1_base_project_settings.json` and
`web/base_settings.js` and build the baseline from your own Snapmaker Orca install
instead. The desktop tool already overlays your installed profiles, so this mostly
matters for the web copy; `make_base_settings.py` regenerates it.

Not legal advice — just what those two files say. Worth a heads-up to josuanbn
either way, since the README/LICENSE mismatch is easy to trip over.

## Limitations of the local Python workflows

The four-reel limits below apply to the local assessment/recolour workflows.
The browser's main converter retains all source filament entries without imposing
a four-slot limit; its target-specific settings are described above.

* One plate and any subset of its objects per export. Objects are never split
  into parts, and a single object that needs more than four colours cannot be
  split by object at all — simplify its palette or print it in more than one job.
* At most four *physical* colours per export, which is the U1's hardware limit.
  A selection that uses more is not refused any more, but nothing is substituted
  quietly: you either split it into per-object groups or confirm a mapping onto
  the reels you have loaded.
* Sub-divided (brush-painted) triangles are remapped state by state, whole and
  sub-divided alike. A value the codec cannot explain is copied through untouched
  when nothing needs renumbering, and stops the export when a remap would have to
  look inside it — never written back as a different colour.
* Full Spectrum mixing is implemented as an export (`--spectrum`, or the card in
  the page) up to twelve recipes / sixteen filament ids. Whether the rebuilt
  project reopens identically in the installed slicer has **not** been verified
  here: the earlier Orca command-line crash means the slicer is not launched by
  this tool, and confirming it is a manual step.
* Mid-print reel changes are planned from a **sliced** file, never from the mesh:
  the page reads the real toolpath (infill and supports included) and reports the
  changes, but it does not modify the G-code or insert pauses into it. The plan is
  a separate document you act on.
* Foreign-target projects are **colour projects**. They carry geometry, parts, the
  palette and the recipes; they do not carry the U1's printer, process or G-code,
  and the local portable exporters preserve the source arrangement. The browser
  converter has separate centring, copies and Fill plate controls.
* The exported Bambu and Prusa schemas follow the published format notes and are
  checked offline (structure, ids, attribute spellings). They have **not** been
  opened in Bambu Studio or PrusaSlicer, and the Snapmaker mixture project has been
  confirmed working in the installed 2.4.0 build by the user.
* The plate is centred on the U1 bed by measuring the selection's own bounding
  box through the source transforms; objects keep their relative arrangement, but
  nothing is re-arranged or re-oriented for you.
* Filaments are set to PLA by default; use `--types` / `--filament` if you are
  printing something else.
* `Fill bed` cannot match Orca's own arranger, which nests real silhouettes and
  places the prime tower in the same pass. It packs bounding boxes, so a round
  model wastes its corners. Use it to get a working plate, then press Arrange in
  Orca if you want more on there.
* The plate layout is a grid; there is no per-copy rotation and no nesting.
