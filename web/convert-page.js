import {receiveModel} from './shared/modelHandoff.js';
// The homepage converter: any supported dialect in, any out, every colour kept.
//
// The page is deliberately thin.  It owns the markup and nothing else:
// ConvertSession owns the worker, the epoch guards, the source→destination
// assignment and the one download it will hand over, so a race (a second file, a
// stale export) is resolved there rather than in half-applied DOM state.

import { RecolourWorker } from "./shared/workerClient.js";
import { TARGETS } from "./shared/targets.js";
import { ConvertSession } from "./shared/convertSession.js";
import { REPAINT, SLOTS, assignmentPlan, colourName } from "./shared/assignment.js";
import { Preview } from "./shared/preview.js";
import { thumbnailSizes } from "./shared/thumbnail.js";
import { planLayout } from "./shared/layout.js";
import { supportOf, transferSettings } from "./shared/printSettings.js";
import { renderFilamentPicker } from './shared/filamentPicker.js';
import { buildU1Profile, profileDescription, constrainLayers } from './shared/u1Profiles.js';
import { initBatch } from "./batch-page.js";
import {createTextureImport} from './shared/textureImport.js';

const VERSION = "2.6.5";
const LABELS = {snapmaker:"Snapmaker Orca (U1)", bambu:"Bambu Studio", orca:"OrcaSlicer", prusa:"PrusaSlicer"};
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hex = (value) => String(value || "#FFFFFF").toUpperCase();
/** "Green (#3F8E43)": the name is an offline approximation, the hex is the fact. */
const swatchLabel = (value) => `${colourName(value)} (${hex(value)})`;
const cap = (text) => String(text || "").replace(/^[a-z]/, (c) => c.toUpperCase());

/* ---------- version and what's new ---------- */

const CHANGES = [
  "MakerWorld extension: open the original 3MF directly in Analyse & convert or Full Spectrum, with transfer and analysis status. Model data stays in your browser.",
  "Send applied physical filament colours to your existing Spool Studio Bridge for slot review and explicit confirmation.",
  "Fixed a Snapmaker Orca slicing crash caused by object-level support-speed overrides; the speed is retained at project level.",
  "Full Spectrum keeps Apply and Download within reach, with compact palette comparisons and collapsible settings.",
  "Full Spectrum: direct U1 filament setup, copy layout, clearer apply action and equal mode buttons.",
  "Full Spectrum: larger original-to-result swatches and physical slot ordering for suggested palettes, with blend recipes preserved.",
  "Bulk U1 layer heights: preserve each designer’s settings, use a standard nozzle preset or choose a custom height. Review source-to-output heights before conversion; incompatible custom heights are blocked.",
  "Import textured GLB, OBJ/MTL texture ZIPs and dense vertex-colour 3MFs. Compare a reduced 2–16 colour palette, edit swatches, confirm size and orientation, then convert or use Full Spectrum.",
  "ZIP bundles: find the 3MF projects inside, list skipped STL and other files, and analyse source formats, materials, nozzle sizes and plate fit before converting.",
  "U1 profiles now match 0.2, 0.4, 0.6 and 0.8 mm nozzles and material-specific presets. Lower source speeds are retained; higher values are capped to the selected U1 process.",
  "Optional filament presets: choose from the source project or import resolved brand JSON presets. U1 exports also offer bundled Snapmaker profiles. Reviewed material properties transfer across all four output formats.",
  "Arrange slots offers all four U1 positions, even for fewer colours. A colour assigned to slot 4 stays in slot 4; any empty gap is unused by the model.",
  "U1 layouts keep 4 mm clear at every bed edge for spiral lifting. Compacted exports no longer retain extra filament diameter entries that could create an unnamed preset.",
  "Negative cutout volumes now open in the main converter and keep their roles and transforms in Snapmaker, Bambu and Orca projects. Prusa multi-volume output remains unsupported; preview cutouts must be checked in the slicer.",
  "Unused filaments start unticked on the main converter. Restore any individually before export; model colours, part defaults and reserved process slots are kept.",
  "Fixed Snapmaker Orca reverting transferred quality, strength and support settings to preset defaults on opening an export. Download a fresh conversion to apply this fix to older files.",
  "Bulk conversion: add several projects, choose one destination and download a ZIP with one 3MF per plate plus a conversion report. Files run one at a time; stopping keeps completed outputs.",
  "Compatible designer quality, strength and support settings now travel to every target by default, with a transfer-details list.",
  "U1 Fill plate reserves a tower corner instead of full side strips. Clone spacing includes explicit brims/rafts and an estimated support allowance; check automatic contours after slicing.",
  "The main converter opens a simplified preview automatically, beside settings on wide screens. Loaded projects replace the large drop zone with a compact file control.",
  "Fill plate now uses the U1's destination bed and keeps the assigned colours on every copy.",
  "The homepage converts a painted 3MF between Snapmaker Orca, Bambu Studio, OrcaSlicer and PrusaSlicer, in any direction.",
  "Every source filament definition, the paint and the geometry travel unchanged; there is no four-slot limit and no colour substitution.",
  "Filament assignment has two modes. Arrange slots (the default) keeps every colour and moves it to the filament you pick, displacing the colour that was there; Repaint colours prints a source colour in another filament's colour.",
  "Choose a slot beside each colour; the other colour moves automatically. The separate Exchange controls have been removed.",
  "Every row and option names its colour in plain words beside the hex.",
  "A project carrying native Full Spectrum blends is refused with a sentence rather than quietly written as a solid colour.",
  "Compare Original/Output views in the preview, or hide it while adjusting settings.",
  "Every download carries a thumbnail rendered from the output colours, so Windows Explorer and the slicers show the model you actually saved.",
  "A Snapmaker Orca (U1) export carries the source's own compatible print settings and support decision again, with a checkbox for the settings and a From source / On / Off control for supports.",
  "Full Spectrum recolouring (own reels, predicted blends, review) is its own page, one button away.",
];

function paintChrome() {
  if ($("ver")) $("ver").textContent = "v" + VERSION;
  if ($("whatsnew")) {
    $("whatsnew").innerHTML = "<summary>What's new in " + VERSION + "</summary><ul>"
      + CHANGES.map((line) => "<li>" + esc(line) + "</li>").join("") + "</ul>";
  }
}

/* ---------- theme ----------
   The pre-paint script in <head> has already resolved the theme to an explicit
   value, so here we only label the button and handle switching. */

const THEME_KEY = "yab3u1-theme";
const themeBtn = $("theme");
const systemLight = window.matchMedia("(prefers-color-scheme: light)");

function setTheme(theme, remember) {
  document.documentElement.setAttribute("data-theme", theme);
  if (remember) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* a blocked localStorage is not worth failing over */
    }
  }
  const toLight = theme === "dark";
  themeBtn.textContent = toLight ? "Light" : "Dark";
  themeBtn.setAttribute("aria-label",
                        toLight ? "Switch to light theme" : "Switch to dark theme");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", toLight ? "#0e141f" : "#fbfcf8");
}

setTheme(document.documentElement.getAttribute("data-theme") || "dark", false);
themeBtn.addEventListener("click", () => {
  setTheme(document.documentElement.getAttribute("data-theme") === "dark"
    ? "light" : "dark", true);
});
systemLight.addEventListener("change", (event) => {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (error) {
    saved = null;
  }
  if (!saved) setTheme(event.matches ? "light" : "dark", false);
});

/* ---------- output ---------- */

function clearError() {
  const node = $("loaderror");
  if (!node) return;
  node.innerHTML = "";
  node.classList.add("hidden");
}

function showError(title, message) {
  const node = $("loaderror");
  if (!node) return;
  node.innerHTML = '<strong class="err">' + esc(title) + "</strong><p>"
    + esc(message) + "</p>";
  node.classList.remove("hidden");
}

function setStatus(text) {
  const node = $("convertstatus");
  if (node) node.textContent = text || "";
}

function renderOutput(entry) {
  const out = $("convertout");
  if (!out) return;
  out.innerHTML = "";
  if (!entry) return;
  const link = document.createElement("a");
  link.href = entry.url;
  link.download = entry.name;
  link.className = "save";
  link.textContent = `Save ${entry.name} (${(entry.bytes / 1048576).toFixed(2)} MB)`;
  out.appendChild(link);
  // Start the download as well: the link stays for a second attempt, but the
  // user asked for a file, not for one more click.
  const auto = link.cloneNode(true);
  document.body.appendChild(auto);
  auto.click();
  auto.remove();
  const changed = Object.keys(entry.mapping)
    .map(Number).sort((a, b) => a - b)
    .filter((source) => entry.mapping[source] !== source);
  const rearranged = entry.assignmentMode === SLOTS;
  // What the export really did with the source's print intent, from the converter
  // itself rather than from what the page hoped: a U1 project carries compatible
  // print settings and a support decision, and the sentence names them.
  const applied = entry.settings
    ? (entry.settings.carry
      ? ` Carried ${entry.settings.carried.length} compatible print setting(s) from `
        + "the source."
      : " The source's print settings were left at the U1 profile's own values.")
      + ` ${cap(entry.settings.support)}.`
    : "";
  const filamentSummary = rearranged && entry.target === "snapmaker"
    && entry.colours.length > session.activeColourIds().length
    ? `${entry.colours.length} slot entries (${session.activeColourIds().length} selected colours; gaps are unused)`
    : `${entry.colours.length} filament(s)`;
  setStatus(`Wrote ${entry.name} with ${filamentSummary}`
    + (changed.length
      ? (rearranged
        ? `, with ${changed.length} colour(s) printed from another filament and `
          + "their appearance unchanged"
        : ` and ${changed.length} reassigned, which changes those colours`)
      : " and no colour change")
    + (entry.target === "snapmaker"
      ? ". The project carries the U1 printer profile and its own speeds, "
        + "temperatures and machine g-code."
      : ". Open it as a project in the destination slicer and choose your own "
        + "printer and filament profile there; no machine settings are copied across.")
    + applied
    + (entry.target === "bambu" && !session.state?.negativeVolumes
      ? " Bambu Studio may ask you to map the file's colours to your own "
        + "filaments: its colour dialog reads the file's filament list and may "
        + "rebind it to your AMS, and the file itself carries no printer or "
        + "process preset."
      : "")
    + " Where a painted facet was split, the export writes its exact leaf "
    + "triangles, so the mesh may hold more triangles than the source.");
}

/* ---------- session ---------- */

const session = new ConvertSession(() => new RecolourWorker(), {
  status: (text) => setStatus(text),
  cleared: () => {
    clearError();
    $("convertpick")?.classList.add("hidden");
    $("convertout").innerHTML = "";
    window.__convertLoaded = null;
    resetPreview();
    document.body.classList.remove('has-model');
    $("sourcepreview").classList.add('hidden');
    $("convertreplace").classList.add('hidden');
    $("dropheading").textContent='Drop a .3mf, GLB or ZIP bundle here';
  },
  loaded: (state) => {
    const firstLoad=!document.body.classList.contains('has-model');
    renderChoices(state);
    document.body.classList.add('has-model');
    $("sourcepreview").classList.remove('hidden');
    $("convertreplace").classList.remove('hidden');
    $("dropheading").textContent='Choose another model';
    if(firstLoad) {
      previewShown=true;
      syncPreviewVisibility();
      requestAnimationFrame(()=>refreshPreview());
    }
  },
  mode: () => syncMode(),
  rule: () => {
    syncRule();
    // A new assignment changes the Output view only; the geometry is reused.
    refreshPreview();
  },
  layout: () => { syncLayout(); refreshPreview(); },
  settings: () => syncSettings(),
  bounds: () => {
    // Bounds are unresolved: the layout/export must not run against the previous
    // plate's numbers.  The support note follows the same selection, so it is
    // re-synced here as well as the layout.
    syncLayout();
    syncSettings();
  },
  output: (entry) => renderOutput(entry),
  error: (message,file) => {
    showError("This file could not be used", message);
    if(file && /colour group|colours.*at most|per-corner colours/.test(message))textureImporter.open(file);
  },
  busy: (busy) => {
    syncLayout();
  },
  progress: (progress) => {
    window.__convertProgress = { stage: progress.stage, ms: progress.ms };
  },
});

/* ---------- the saved thumbnail ----------
 *
 * Every save carries a *rendered* output thumbnail, asked for with this export's
 * own palette and assignment.  The worker rasterises the cached simplified
 * surface and encodes the PNG itself, so this needs no canvas and no WebGL and
 * works even when the 3D view was never opened.  A render failure fails the
 * save: better a sentence than a project that silently has no thumbnail.
 */
session.setThumbnailer(async (snapshot) => {
  const sizes = thumbnailSizes(snapshot.target);
  const started = Date.now();
  // The saved picture is the *output* view, so it is drawn from the very palette
  // and map the archive is written with -- a slot arrangement has a rearranged
  // palette, and painting it with the source's would show a different file.
  const plan = assignmentPlan(snapshot.assignmentMode, snapshot.colours,
                              snapshot.mapping);
  const rendered = await snapshot.worker.thumbnail(snapshot.plateId, null,
                                                   paletteTable(plan.palette),
                                                   plan.mapping,
                                                   { size: sizes.main,
                                                     small: sizes.small,
                                                     layout: snapshot.layout });
  window.__convertThumbnail = { target: snapshot.target, ms: Date.now() - started,
                                bytes: rendered.main ? rendered.main.length : 0,
                                triangles: rendered.triangles };
  return rendered;
});

/** The worker addresses colours by filament id (1-based), so an array of the
 *  palette in order has to become that table before it is sent. */
function paletteTable(colours) {
  const table = {};
  colours.forEach((colour, index) => { table[index + 1] = colour; });
  return table;
}

/** One label shape everywhere a filament is chosen: the slot number, the plain
 *  name, then the hex that tells two similar shades apart. */
function optionsFor(palette) {
  const active = session.activeColourIds();
  const occupied = new Set(active.map(id=>session.rule[id]));
  return session.destinationIds().map(id => {
    if (session.physicalSlots() && !occupied.has(id)) return `<option value="${id}">${id} · Unused slot</option>`;
    const colour = palette[id-1];
    return `<option value="${id}">${session.physicalSlots() ? id : active.indexOf(id)+1} · ${esc(colourName(colour))} · ${esc(hex(colour))}</option>`;
  }).join("");
}

const paletteSignature = (palette) => JSON.stringify([palette, session.activeColourIds(), session.destinationIds(), session.rule, session.physicalSlots()]);

/** Point a select at one palette, keeping the choice that is already made.
 *
 * An arranged slot moves the colours, so a slot's own name and hex change with
 * them: the labels have to be rebuilt from the palette this export writes, not
 * from the one the file was read with, or the selected option would contradict
 * the swatch beside it.  The user's choice is preserved across the rewrite.
 */
function syncOptions(select, palette, signature, value) {
  if (!select) return;
  if (select.dataset.palette !== signature) {
    const keep = select.value;
    select.innerHTML = optionsFor(palette);
    select.dataset.palette = signature;
    if (keep !== "") select.value = keep;
  }
  if (value !== undefined && select.value !== String(value)) {
    select.value = String(value);
  }
}

function renderChoices(state) {
  clearError();
  const plate = $("convertplate");
  plate.innerHTML = state.plates.map((entry,index) =>
    `<option value="${esc(entry.id)}">${esc(entry.name || `Plate ${index+1}`)}</option>`).join("");
  plate.value = String(state.plateId);
  plate.disabled = state.plates.length < 2;

  const target = $("converttarget");
  target.innerHTML = TARGETS.map((id) =>
    `<option value="${esc(id)}">${esc(LABELS[id])}</option>`).join("");
  target.value = session.target;

  // One label shape everywhere a filament is chosen or shown: the slot number,
  // the plain name, then the hex that tells two similar shades apart.
  const options = optionsFor(state.colours);
  const signature = paletteSignature(state.colours);

  const rows = state.colours.map((colour, index) => {
    const source = index + 1;
    if (!session.activeColourIds().includes(source)) return '';
    return `<div class="maprow" data-source="${source}">`
      + `<span class="swatch" style="background:${esc(hex(colour))}" aria-hidden="true"></span>`
      + `<span class="mapid">${source} · ${esc(colourName(colour))} · `
      + `${esc(hex(colour))}</span>`
      + `<span class="arrow" aria-hidden="true">&rarr;</span>`
      + `<span class="swatch" id="mapswatch-${source}" aria-hidden="true"></span>`
      + `<label class="sr-only" for="mapdest-${source}">Destination filament for `
        + `source colour ${source}</label>`
      + `<select id="mapdest-${source}" data-source="${source}" `
      + `data-palette="${esc(signature)}">${options}</select></div>`;
  }).join("");
  $("convertmap").innerHTML = rows;
  $("negativevolumes").hidden = !state.negativeVolumes;
  $("layeractions").hidden = !state.customLayerActions;
  const unused = state.filamentUsage?.unused || [];
  $("unusedfilaments").innerHTML = unused.length ? `<strong>${unused.length} unused filament${unused.length===1?'':'s'} found</strong><p>Unticked filaments are left out of the export. Tick any you want to keep. Changing this selection resets slot assignments.</p>`
    + unused.map(id=>`<label style="display:flex;align-items:center;gap:8px;margin:8px 0"><input type="checkbox" data-unused="${id}" ${state.includeUnused.includes(id)?'checked':''}><span class="swatch" style="background:${esc(hex(state.colours[id-1]))}"></span>Keep unused filament ${id} · ${esc(swatchLabel(state.colours[id-1]))}</label>`).join('') : '';
  $("unusedfilaments").querySelectorAll('[data-unused]').forEach(input=>input.addEventListener('change',()=>{session.setUnused(Number(input.dataset.unused),input.checked);refreshPreview();}));

  $("convertpick").classList.remove("hidden");
  syncMode();
  syncRule();
  syncLayout();
  syncSettings();
  const summary = state.summary || {};
  window.__convertLoaded = { kind: state.kind, colours: state.colours.length,
                             triangles: summary.triangles || 0,
                             plates: state.plates.length };
  $("convertstatus").title=state.title && state.title!==state.displayName ? `Embedded project name: ${state.title}` : '';
  setStatus(`${state.displayName || state.title || "model"}: ${session.activeColourIds().length} of ${state.colours.length} source filaments selected${unused.length ? ` · ${unused.length-state.includeUnused.length} unused left out` : ''}, `
    + `${(summary.triangles || 0).toLocaleString()} triangles on `
    + `${state.plates.length} plate(s). Nothing has been uploaded.`);
}

/** The settings whose value is a length, so the note can say "mm" where that is
 *  what the number means and leave a count, a percentage or an enum alone. */
const LENGTH_KEYS = new Set([
  "layer_height", "initial_layer_print_height", "top_shell_thickness",
  "bottom_shell_thickness", "brim_width", "brim_object_gap",
  "elefant_foot_compensation", "resolution", "ironing_spacing",
  "fuzzy_skin_thickness", "fuzzy_skin_point_distance", "infill_anchor",
  "infill_anchor_max", "mmu_segmented_region_max_width",
  "mmu_segmented_region_interlocking_depth",
]);

const valueWithUnit = (key, value) => (LENGTH_KEYS.has(key) && !String(value).endsWith("%") ? `${value} mm` : value);

/** Short, human names for the settings a U1 export can carry.  A key with no
 *  entry is shown as it is spelled in the file, which is what a user comparing
 *  against their slicer profile needs anyway. */
const SETTING_LABELS = {
  layer_height: "layer height",
  initial_layer_print_height: "first layer height",
  wall_loops: "wall loops",
  top_shell_layers: "top shell layers",
  top_shell_thickness: "top shell thickness",
  bottom_shell_layers: "bottom shell layers",
  bottom_shell_thickness: "bottom shell thickness",
  sparse_infill_density: "infill density",
  sparse_infill_pattern: "infill pattern",
  top_surface_pattern: "top surface pattern",
  bottom_surface_pattern: "bottom surface pattern",
  brim_width: "brim width",
  brim_object_gap: "brim gap",
  brim_type: "brim type",
  elefant_foot_compensation: "elephant foot",
  resolution: "resolution",
  ironing_type: "ironing",
};

const labelFor = (key) => SETTING_LABELS[key] || key.replace(/_/g, " ");

/** The sentence for the support control, describing what the export will really do. */
function supportSentence(source, state) {
  const painted = Boolean(state && state.supportsPainted);
  const support = supportOf(source);
  if (session.supportMode === "off") {
    return painted
      ? "Supports off. The model still carries painted support enforcers, which "
        + "do nothing with support off; Orca warns about them."
      : "Supports off.";
  }
  if (session.supportMode === "on") return "Supports on, using the U1 profile's own type.";
  if (!support) {
    return "Supports: the file states no support setting, so the U1 profile's own "
      + "value stays.";
  }
  if (!support.enabled) {
    return painted
      ? "Supports on: the source has them off but carries painted support enforcers, "
        + "which are meaningless without support."
      : "Supports off, as the source had them.";
  }
  return `Supports on: ${support.type || "the source's own type"}`
    + (support.angle ? ` at ${support.angle}°` : "") + ".";
}

/** Report the destination's reviewed settings and known omissions. The U1 uses
 *  a bundled profile; portable projects carry designer intent on each object. */
function syncSettings() {
  const isU1 = session.target === "snapmaker";
  const state = session.state;
  const ids = state?.plates.find(p => String(p.id) === String(state.plateId))?.objectIds;
  const objects = (state?.objectSettings || []).filter(o => !ids || ids.map(String).includes(String(o.id)));
  const source = { ...(state?.sourceSettings || {}), ...(objects[0]?.settings || {}) };
  const enabled = isU1 ? session.carrySettings : session.preserveSourceSettings;
  if(state)renderFilamentPicker($('filamentprofiles'),{types:state.types,source:state.filamentProfiles,selected:session.filamentProfiles,
    target:session.target,nozzle:session.u1Nozzle,sourceSettings:state.sourceSettings,
    onChange:(index,preset)=>{if(index===null)syncSettings();else session.setFilamentProfile(index,preset);}});
  let profile = null;
  session.profileError='';
  $('u1nozzle').value=session.u1Nozzle;
  try {
    if (isU1 && state) profile=buildU1Profile(state.sourceSettings, session.activeColourIds().map(id=>state.types[id-1] || 'PLA'), session.u1Nozzle, {carry:enabled});
    $('u1profilenote').textContent=profile ? profileDescription(profile) : '';
  } catch(error) { session.profileError=error.message; $('u1profilenote').textContent=error.message; }
  const report = transferSettings(source, session.target, { object: !isU1, baseline:profile?.cfg });
  if(profile) report.skipped.push(...constrainLayers(report.values,profile.match));
  const applied = enabled ? Object.entries(report.values).map(([key, value]) => ({ key, value })) : [];
  $("carrysettings").checked = session.carrySettings;
  $("preservesettings").checked = session.preserveSourceSettings;
  $("preservesettings").disabled = false;
  $("supportmode").value = session.supportMode;
  $("u1settings").classList.toggle("hidden", !isU1);
  $("bambukeep").classList.toggle("hidden", isU1);
  $("sourcesettings").textContent = enabled
    ? `Carrying ${applied.length} compatible print settings, including quality, strength and support settings.`
      + (objects.length > 1 ? " Details below describe the first object; each object's overrides are exported separately." : "")
      + (isU1 ? ` ${supportSentence(source, state)}` : " These are model settings; select your printer and filament profiles in the slicer.")
    : "The destination's print settings will be used.";
  $("settinglist").innerHTML = (applied.length ? "<ul>" + applied.map(({key,value}) =>
    `<li>${esc(labelFor(key))}: ${esc(valueWithUnit(key,value))}</li>`).join("") + "</ul>" : "")
    + (enabled && report.skipped.length ? `<p>Not transferred to this target: ${report.skipped.map(k => esc(labelFor(k))).join(", ")}.</p>` : "")
    + "<p>Printer, nozzle, filament temperatures, motion limits and machine G-code use the destination profiles. Generated supports and rafts need re-slicing.</p>";
  window.__convertSettings = { target: session.target, carry: enabled,
    supportMode: session.supportMode, applied, skipped: report.skipped,
    supportsPainted: Boolean(state?.supportsPainted) };
  syncLayout();
  refreshPreview();
}

/** The layout controls mirror the session, and the note says what will happen.
 *  The capacity comes from the *shared* plan the export uses, so the page can
 *  never promise a copy the file will not write. */
function layoutPlanNow() {
  const bounds = (session.state && session.state.bounds) || null;
  if (!bounds || !bounds.size) return null;
  const box = { min: bounds.min, max: bounds.max };
  return planLayout(box, session.planningLayout());
}

function syncLayout() {
  const layout = session.layout;
  $("layouthint").textContent = session.target === "snapmaker"
    ? "Choose how many copies to arrange and their spacing. The area is fixed to the Snapmaker U1 bed."
    : "Choose how many copies to arrange, their spacing and the available area. Select your printer in the slicer after importing.";
  const set = (id, value) => {
    const node = $(id);
    if (node && !session.layoutProblem && document.activeElement !== node
        && String(node.value) !== String(value)) node.value = String(value);
  };
  set("layoutcopies", layout.copies);
  set("layoutspacing", layout.spacing);
  set("layoutwidth", layout.width);
  set("layoutdepth", layout.depth);
  for (const id of ["layoutwidth", "layoutdepth"]) {
    $(id).disabled = session.target === "snapmaker";
  }
  if ($("layouttower")) $("layouttower").checked = Boolean(layout.tower);
  const bounds = session.state && session.state.bounds;
  const plan = layoutPlanNow();
  const note = [];
  if (bounds && bounds.size) {
    note.push(`model ${bounds.size[0].toFixed(1)} × ${bounds.size[1].toFixed(1)} `
      + `× ${bounds.size[2].toFixed(1)} mm`);
  }
  if (!plan) {
    note.push("the selection's size is still being measured");
  } else if (plan.blocked) {
    note.push(`this model does not fit the ${layout.width} × ${layout.depth} mm box`);
  } else {
    note.push(`${plan.copies} of ${plan.capacity} possible copy(ies) in a `
      + `${layout.width} × ${layout.depth} mm box at ${layout.spacing} mm spacing`);
    if (plan.tower) {
      note.push(plan.towerBox
        ? "60 × 70 mm corner reserved for the prime tower; check its final size after slicing"
        : `prime-tower space of ${plan.reserve / 2} mm reserved on each X side`);
    }
    if (plan.capped) note.push(`only ${plan.capacity} fit, so that is what is written`);
    if (plan.padding) note.push(`${plan.padding.toFixed(1)} mm extra clearance per side for print additions`);
    if (plan.edgeMargin) note.push(`${plan.edgeMargin} mm kept clear at every bed edge for spiral lifting`);
    note.push(...plan.footprintNotes);
  }
  note.push(session.target === "snapmaker"
    ? "Snapmaker U1: copies are fitted to its 270 × 270 mm bed"
    : "your printer and process stay yours: pick them in the slicer");
  const problem = session.layoutProblem
    || (session.boundsPending ? "the selection's size is still being measured" : "")
    || (plan && plan.blocked ? "no copy fits this layout box" : "")
    || (!plan && session.state ? "the selection's size is unknown" : "");
  $("layoutnote").textContent = (problem ? `cannot write: ${problem} · ` : "")
    + note.join(" · ");
  // An invalid or impossible layout blocks the export outright.
  const go = $("convertgo");
  if (go) go.disabled = Boolean(problem) || Boolean(session.profileError) || session.busy || !session.state;
  if ($("layoutfill")) $("layoutfill").disabled = Boolean(problem) || !session.state;
}

/* ---------- the two assignment modes ----------
 *
 * The same table drives both, so switching the mode keeps the rows, the selects
 * where they are and only changes what they mean. Each
 * mode owns its own map in the session, so a look at one never loses the other.
 */

const MODE_HINT = {
  slots: "Choose the slot where each colour is loaded. The other colour moves "
    + "automatically. Your model keeps the same colours.",
  repaint: "Choose a replacement colour for each original colour. This changes "
    + "the model's colours; several original colours can use the same replacement.",
};

/** The mode radios, the hint under them and the "what it means" line above the
 *  preview follow the session; the rows themselves are re-synced by syncRule. */
function syncMode() {
  const mode = session.assignmentMode === REPAINT ? REPAINT : SLOTS;
  document.querySelectorAll('input[name="assignmentmode"]').forEach((node) => {
    node.checked = node.value === mode;
  });
  const hint = $("convertmaphint");
  if (hint) hint.textContent = session.physicalSlots()
    ? "Choose the physical U1 slot where each colour is loaded. All four slots are available, including unused ones. Moving onto an occupied slot swaps its colour. Unused slots have no model regions assigned."
    : MODE_HINT[mode];
  const note = $("previewmodehint");
  if (note) {
    note.textContent = mode === SLOTS
      ? "Output colours: the same appearance, printed from the filaments you "
        + "chose. Original colours: the file as it was read."
      : "Output colours: what the file will look like after the repaint. "
        + "Original colours: the file as it was read.";
  }
}

/** Update the mode radios, the destination swatches, the selects and the plan
 *  line from the session. */
function syncRule() {
  if (!session.state) return;
  syncMode();
  const { colours } = session.state;
  // What this mode really writes: an arranged slot has a rearranged palette, so
  // the swatch shows the colour that will be in that slot, not the one that was
  // there when the file was read.
  const plan = assignmentPlan(session.assignmentMode, colours, session.rule);
  // ...and the options have to say the same thing the swatch does.  A repaint
  // writes the palette it read, so its labels stay on the original colours.
  const labels = plan.mode === SLOTS ? plan.palette : colours;
  const signature = paletteSignature(labels);
  for (let source = 1; source <= colours.length; source += 1) {
    const destination = session.rule[source] ?? source;
    syncOptions($(`mapdest-${source}`), labels, signature, destination);
    const swatch = $(`mapswatch-${source}`);
    if (swatch) {
      swatch.style.background = hex(plan.palette[destination - 1]
        || colours[destination - 1]);
    }
  }
  const changes = session.changes();
  const slots = plan.mode === SLOTS;
  $("convertplan").innerHTML = changes.length
    ? "Chosen for export: " + changes.slice(0, 6).map(({ source, destination }) =>
      slots
        ? `<b>${esc(colourName(colours[source - 1]))}</b> `
          + `(${esc(hex(colours[source - 1]))}) prints from filament `
          + `<b>${session.physicalSlots() ? destination : session.activeColourIds().indexOf(destination)+1}</b>`
        : `<b>${source}</b> ${esc(swatchLabel(colours[source - 1]))} &rarr; `
          + `<b>${destination}</b> ${esc(swatchLabel(colours[destination - 1]))}`
    ).join(", ")
      + (changes.length > 6 ? `, and ${changes.length - 6} more` : "")
      + (slots
        ? `; ${session.activeColourIds().length - changes.length} other filament(s) keep their own `
          + "colour, and every colour keeps its appearance."
        : `; ${session.activeColourIds().length - changes.length} other filament(s) keep their own `
          + "colour.")
    : (slots
      ? "Chosen for export: every colour keeps its own filament and its own "
        + "appearance, so the file is converted without changing any colour."
      : "Chosen for export: no colour is repainted, so the file is converted "
        + "without changing any colour.");
}

/* ---------- controls ---------- */

/* ---------- automatic, simplified preview ----------
 *
 * Metadata loads first, then the worker prepares a bounded preview automatically.
 * Hide preview stops pending visual updates; exports keep the original geometry.  In a conversion the source palette *is* the
 * destination palette -- only the assignment differs -- so one colour table
 * serves both Original and Output.
 */

let preview = null;              // the shared WebGL renderer, made on first use
let previewToken = 0;
let previewMode = "result";
let previewShown = false;
let previewKey = null;           // "plate" whose geometry the renderer holds
let previewGeometryId = null;
let previewPositions = null;

/** A cheap fingerprint of the colours the view is showing, for the QA run. */
function hashColours(colours) {
  let hash = 0x811C9DC5;
  for (let index = 0; index < colours.length; index += 1) {
    hash ^= Math.round(colours[index] * 255) & 0xFF;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function note(text) {
  const node = $("previewnote");
  if (node) node.textContent = text || "";
}

async function refreshPreview() {
  if (!previewShown || !session.state) return;
  const token = (previewToken += 1);
  note("Preparing 3D preview…");
  if (!preview) {
    preview = new Preview($("convertpreview"));
    $("previewreset").addEventListener("click", () => preview.reset());
    window.addEventListener("resize", () => preview.resize());
  }
  if (!preview.ok) {
    note(preview.error);
    window.__convertPreview = { mode: previewMode, triangles: 0,
                                render: token, error: preview.error };
    return;
  }
  const state = session.state;
  // The Output view is drawn from the palette and map this export writes, which
  // for an arranged slot list is the rearranged palette; the Original view is the
  // file as it was read, by its own palette and with no map at all.
  const plan = assignmentPlan(session.assignmentMode, state.colours, session.rule);
  const colours = paletteTable(previewMode === "result" ? plan.palette
                                                        : state.colours);
  const mapping = previewMode === "result" ? plan.mapping : null;
  let soup;
  try {
    soup = await session.worker.preview(state.plateId, null, previewMode, colours,
                                        mapping, previewGeometryId,
                                        state.coloursUsed || 0,
                                        session.planningLayout());
  } catch (error) {
    if (token !== previewToken) return;
    preview.setSoup(new Float32Array(0), new Float32Array(0));
    note(`the preview could not be drawn: ${error.message}`);
    window.__convertPreview = { mode: previewMode, triangles: 0,
                                render: token, error: error.message };
    return;
  }
  if (token !== previewToken) return;              // a newer request wins
  const key = `${state.plateId}|${session.layout.copies}|${session.layout.spacing}`
    + `|${session.layout.width}|${session.layout.depth}|${session.layout.tower}`;
  if (soup.positions) {
    previewPositions = soup.positions;
    previewGeometryId = soup.geometryId;
  }
  const positions = (soup.geometryId === previewGeometryId && previewPositions)
    ? previewPositions : new Float32Array(0);
  if (!positions.length && soup.triangles) {
    note("the preview geometry had to be fetched again; press Reset view to retry");
    return;
  }
  const fit = key !== previewKey;
  previewKey = key;
  preview.setSoup(positions, soup.colors, { fit });
  preview.resize();
  note(`${soup.triangles.toLocaleString()} facets drawn`
    + (soup.subdivided ? ` · ${soup.subdivided.toLocaleString()} sub-divided facets `
       + "are shown in their dominant colour; the exported paint still keeps every leaf"
       : "")
    + " · approximate surface, not sliced toolpaths");
  window.__convertPreview = { mode: previewMode, triangles: soup.triangles,
                              floats: positions.length, reused: soup.reused,
                              colours: hashColours(soup.colors),
                              total: soup.total, simplified: soup.simplified,
                              // The render this reply belongs to, so a check can
                              // wait for the picture to catch up with an edit.
                              render: token };
}

function resetPreview() {
  previewToken += 1;
  previewShown = false;
  previewKey = null;
  previewGeometryId = null;
  previewPositions = null;
  previewMode = "result";
  if ($("previewmode")) $("previewmode").value = "result";
  syncPreviewVisibility();
  if (preview && preview.ok) preview.setSoup(new Float32Array(0), new Float32Array(0));
  note("");
  window.__convertPreview = null;
}

const input = $("convertfile");
const drop = $("convertdrop");
$("convertreplace").addEventListener('click', () => {
  $("mode-single").click();
  input.value=''; input.click();
});
const textureImporter=createTextureImport({buttonHost:document.getElementById('importtools'),onAccept:file=>session.load(file)});
const batch = initBatch({onTextureBundle:file=>textureImporter.open(file)});
function openFiles(files) {
  if(files.length===1 && /\.glb$/i.test(files[0].name))textureImporter.open(files[0]);
  else if (files.length > 1 || /\.zip$/i.test(files[0]?.name || "")) batch.addFiles(files);
  else if (files[0]) session.load(files[0]);
}

// Opening the picker from the drop zone must not re-enter through the input's own
// click bubbling back up to the drop zone.
drop.addEventListener("click", (event) => {
  if (event.target === input) return;
  input.click();
});
input.addEventListener("click", (event) => event.stopPropagation());
input.addEventListener("change", () => {
  const files = Array.from(input.files);
  input.value = "";
  openFiles(files);
});
drop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    input.click();
  }
});
["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => {
  event.preventDefault();
  drop.classList.add("over");
}));
["dragleave"].forEach((name) => drop.addEventListener(name, (event) => {
  event.preventDefault();
  drop.classList.remove("over");
}));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  // The drop zone owns this event: nothing above it may also read the file.
  event.stopPropagation();
  drop.classList.remove("over");
  openFiles(Array.from(event.dataTransfer.files));
});

$("convertmap").addEventListener("change", (event) => {
  const select = event.target.closest("select[data-source]");
  if (select) session.setSource(select.dataset.source, select.value);
});
// The two mode radios are native inputs in one group: arrow keys move between
// them, and the label is the whole target.
document.querySelectorAll('input[name="assignmentmode"]').forEach((node) => {
  node.addEventListener("change", () => {
    if (node.checked) session.setAssignmentMode(node.value);
  });
});
$("convertreset").addEventListener("click", () => {
  if (session.state) session.reset();
});
$("convertplate").addEventListener("change", async () => {
  if (!session.setPlate($("convertplate").value)) return;
  // The new plate has its own bounds: the layout box measures the selection the
  // export will actually use.
  await session.refreshBounds();
  syncLayout();
  refreshPreview();
});
["layoutcopies", "layoutspacing", "layoutwidth", "layoutdepth"].forEach((id) => {
  $(id).addEventListener("input", () => {
    const patch = {};
    for (const key of ["copies", "spacing", "width", "depth"]) {
      const value = $("layout" + key).value;
      patch[key] = value.trim() === "" ? NaN : Number(value);
    }
    session.setLayout(patch);
    // One plan drives the file and the picture: an open preview follows the box,
    // and an invalid box leaves the note (and the export) blocked.
    refreshPreview();
  });
});
$("layouttower").addEventListener("change", () => {
  session.setLayout({ tower: $("layouttower").checked });
  refreshPreview();
});
$("preservesettings").addEventListener("change", () => {
  session.setPreserveSourceSettings($("preservesettings").checked);
});
// The U1 controls: the same two decisions the original converter took from the
// command line, now on the page.  Every change invalidates the open download, so a
// file written before the tick cannot be saved after it.
$('u1nozzle').addEventListener('change',()=>session.setU1Nozzle($('u1nozzle').value));
$("carrysettings").addEventListener("change", () => {
  session.setCarrySettings($("carrysettings").checked);
});
$("supportmode").addEventListener("change", () => {
  session.setSupportMode($("supportmode").value);
});
$("layoutfill").addEventListener("click", () => {
  // Fill uses the *same* plan the export uses: one capacity, one truth.
  const plan = layoutPlanNow();
  if (!plan || plan.blocked) {
    session.setLayout({ copies: 1 });          // surfaces the block in the note
    return;
  }
  session.setLayout({ copies: plan.capacity });
  // The Fill button is a layout change like any other: the picture follows it.
  refreshPreview();
});
$("converttarget").addEventListener("change", () => {
  // A different target writes different bytes (and a different layout origin);
  // the old download does not apply, and the preview/note must follow.
  session.setTarget($("converttarget").value);
  syncSettings();
  refreshPreview();
});
$("convertgo").addEventListener("click", () => {
  if (!session.state || $("convertgo").disabled) return;
  session.convert($("converttarget").value, session.state.plateId);
});
$("convertagain").addEventListener("click", () => {
  // Clearing the value lets the *same* file be chosen again.
  input.value = "";
  input.click();
});

function syncPreviewVisibility() {
  $("previewpanel").classList.toggle("hidden", !previewShown);
  $("previewshow").textContent = previewShown ? "Hide preview" : "Show 3D preview";
  $("previewshow").setAttribute("aria-expanded", String(previewShown));
}

$("previewshow").addEventListener("click", () => {
  previewShown = !previewShown;
  syncPreviewVisibility();
  if (previewShown) refreshPreview();
  else previewToken += 1; // A pending reply cannot update the collapsed viewer.
});
$("previewmode").addEventListener("change", () => {
  previewMode = $("previewmode").value;
  refreshPreview();
});

paintChrome();

receiveModel({mount: document.getElementById("singlepanel"), canReceive:()=>!session.state&&!session.busy, load:async file=>{await session.load(file);return Boolean(session.state);}});
