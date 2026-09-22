# yab3u1 — Yet Another Bloody 3MF → U1 converter

Three ways to run it, sharing the same conversion logic:

| | where | what it is |
| --- | --- | --- |
| **`U1 Converter` shortcut** | this machine | local web UI (`u1ui.py` + `u1ui.html`), reads your installed Orca profiles and can verify a plate by slicing |
| **`u1convert.py`** | any machine with Python | the command line tool; `--fill-bed`, `--verify`, `--supports`, `--colors` |
| **`web/`** | deployable, e.g. Vercel | [browser version](#the-browser-version-web) — the whole conversion in the page, nothing uploaded |

A local replacement for [bl2u1.nbn.cat](https://bl2u1.nbn.cat) /
[josuanbn/bl2u1](https://github.com/josuanbn/bl2u1) that actually works on
PrusaSlicer-family files, actually keeps the painted colours, and can fill the
plate without producing a file that refuses to slice.

## The browser version (`web/`)

The conversion is pure byte-shuffling — unzip, rename attributes, rewrite a JSON,
rezip — so it runs entirely in the page. No backend, no uploads, no size limits,
and your model never leaves the machine.

```
web/
  index.html                the UI (drop zone, slots, options, download)
  converter.js              the conversion (a port of u1convert.py)
  zip.js                    ZIP read/write on DecompressionStream/CompressionStream
  base_settings.js          bundled U1 project settings (see make_base_settings.py)
  selftest.html             self-test page: converts a fixture in the browser and reports
  selftest-fixture*.3mf     tiny Prusa and Bambu fixtures it uses
  make_fixtures.mjs         regenerates those fixtures
  icon.ico                  the same icon, as the favicon
```

**Deploying.** Vercel's request/response limit is 4.5 MB and functions are
short-lived, so the Python app cannot go there — but this can, as a static site.
From the repository root:

```
cd web
npx vercel --prod
```

`web/` *is* the site, so there is nothing to build. Two notes:

* `cd web && npx vercel` fails in Windows PowerShell 5.1 — `&&` is a PowerShell 7
  feature. Run the two lines separately, as above, or use `;` if you don't mind
  the second command running even when the first fails.
* the first run asks you to log in (`npx vercel login`) and then to link or create
  a project; after that `npx vercel --prod` is a single command.
* `npx vercel deploy --temporary` skips the account entirely and gives you a live
  URL you can claim later — handy for seeing it work before signing up.
* the CLI may offer to upgrade itself and then fail with `spawn npm ENOENT`. That
  is a Vercel CLI bug on Windows (`npm` is installed); ignore it.

Being a static folder, it also drops straight onto **Netlify Drop** (drag `web/`
onto the page) or **GitHub Pages** — neither needs a CLI login.

`vercel.json` at the repo root also sets `outputDirectory: "web"`, so importing
the repository works too. (I could not test the deploy itself — no Vercel account
here — so if the root import complains, deploy from `web/`.)

**Previewing locally:** `python serve.py` serves `web/` on
http://127.0.0.1:8231 (opening `index.html` straight off disk will not work —
ES modules need a server).

**What it gives up** relative to the desktop tool, both because a web page can't
reach your machine:

* it cannot read the profiles installed in Snapmaker Orca, so the settings come
  from the bundled baseline (a fixed `0.20mm Standard @Snapmaker U1` project). The
  filament and process dropdowns change the *names* Orca shows, not the underlying
  numbers — the per-slot filament values are flattened onto the bundled profile so
  the four slots stay consistent.
* it cannot run Orca to verify a plate slices, so `Fill bed` reports the geometric
  capacity only.

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
```

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
else (the converter, the paint handling, the layout, both UIs) was written for
this project.

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

## Limitations

* Single-object, single-part geometry only — including Orca/Bambu projects that
  place several objects on a plate. Anything else is refused with a clear message
  rather than silently mangled. (A project re-saved by Orca often ends up with
  several objects; re-export just the one you want, or merge them.)
* At most four extruders, since that is the U1's hardware limit. A file using
  more is refused — merge colours in a slicer first.
* When a colour remap *is* required the tool rewrites whole-triangle paint
  states. Sub-divided (brush-painted) triangles are copied through unchanged and
  reported, so they are never corrupted, but they are not remapped either.
* Filaments are set to PLA by default; use `--types` / `--filament` if you are
  printing something else.
* `Fill bed` cannot match Orca's own arranger, which nests real silhouettes and
  places the prime tower in the same pass. It packs bounding boxes, so a round
  model wastes its corners. Use it to get a working plate, then press Arrange in
  Orca if you want more on there.
* The plate layout is a grid; there is no per-copy rotation and no nesting.
