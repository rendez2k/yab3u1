// The homepage converter: any supported dialect in, any out, every colour kept.
//
// The page is deliberately thin.  It owns the markup and nothing else:
// ConvertSession owns the worker, the epoch guards, the source→destination
// assignment and the one download it will hand over, so a race (a second file, a
// stale export) is resolved there rather than in half-applied DOM state.

import { RecolourWorker } from "./shared/workerClient.js";
import { TARGETS } from "./shared/targets.js";
import { ConvertSession } from "./shared/convertSession.js";
import { Preview } from "./shared/preview.js";
import { thumbnailSizes } from "./shared/thumbnail.js";
import { planLayout } from "./shared/layout.js";
import { appliedSettings, supportOf } from "./shared/printSettings.js";

const VERSION = "2.3.2";
const LABELS = {snapmaker:"Snapmaker Orca (U1)", bambu:"Bambu Studio", orca:"OrcaSlicer", prusa:"PrusaSlicer"};
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hex = (value) => String(value || "#FFFFFF").toUpperCase();
const cap = (text) => String(text || "").replace(/^[a-z]/, (c) => c.toUpperCase());

/* ---------- version and what's new ---------- */

const CHANGES = [
  "The homepage converts a painted 3MF between Snapmaker Orca, Bambu Studio, OrcaSlicer and PrusaSlicer, in any direction.",
  "Every source filament definition, the paint and the geometry travel unchanged; there is no four-slot limit and no colour substitution.",
  "An optional filament assignment table lets you send a source colour to another filament, or exchange two at once, before downloading.",
  "A project carrying native Full Spectrum blends is refused with a sentence rather than quietly written as a solid colour.",
  "Optional Show preview with Original/Output views, drawn only when you ask for it.",
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
  if (meta) meta.setAttribute("content", toLight ? "#14161a" : "#f7f8fa");
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
  setStatus(`Wrote ${entry.name} with ${entry.colours.length} filament(s)`
    + (changed.length ? ` and ${changed.length} reassigned` : " and no reassignment")
    + (entry.target === "snapmaker"
      ? ". The project carries the U1 printer profile and its own speeds, "
        + "temperatures and machine g-code."
      : ". Open it as a project in the destination slicer and choose your own "
        + "printer and filament profile there; no machine settings are copied across.")
    + applied
    + (entry.target === "bambu"
      ? " Bambu Studio may ask you to map the file's colours to your own "
        + "filaments; the file itself carries no printer or process preset."
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
  },
  loaded: (state) => renderChoices(state),
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
  error: (message) => showError("This file could not be used", message),
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
  const rendered = await snapshot.worker.thumbnail(snapshot.plateId, null,
                                                   paletteTable(snapshot.colours),
                                                   snapshot.mapping,
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

function renderChoices(state) {
  clearError();
  const plate = $("convertplate");
  plate.innerHTML = state.plates.map((entry) =>
    `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("");
  plate.value = String(state.plateId);
  plate.disabled = state.plates.length < 2;

  const target = $("converttarget");
  target.innerHTML = TARGETS.map((id) =>
    `<option value="${esc(id)}">${esc(LABELS[id])}</option>`).join("");
  target.value = session.target;

  const options = state.colours.map((colour, index) =>
    `<option value="${index + 1}">${index + 1} · ${esc(hex(colour))}</option>`).join("");
  $("convertswapa").innerHTML = options;
  $("convertswapb").innerHTML = options;
  $("convertswapa").value = "1";
  $("convertswapb").value = String(Math.min(3, state.colours.length));

  const rows = state.colours.map((colour, index) => {
    const source = index + 1;
    return `<div class="maprow" data-source="${source}">`
      + `<span class="swatch" style="background:${esc(hex(colour))}" aria-hidden="true"></span>`
      + `<span class="mapid">${source} · ${esc(hex(colour))}</span>`
      + `<span class="arrow" aria-hidden="true">&rarr;</span>`
      + `<span class="swatch" id="mapswatch-${source}" aria-hidden="true"></span>`
      + `<label class="sr-only" for="mapdest-${source}">Destination filament for `
        + `source colour ${source}</label>`
      + `<select id="mapdest-${source}" data-source="${source}">`
      + state.colours.map((entry, at) =>
        `<option value="${at + 1}">${at + 1} · ${esc(hex(entry))}</option>`).join("")
      + "</select></div>";
  }).join("");
  $("convertmap").innerHTML = rows;

  $("convertpick").classList.remove("hidden");
  syncRule();
  syncLayout();
  syncSettings();
  const summary = state.summary || {};
  window.__convertLoaded = { kind: state.kind, colours: state.colours.length,
                             triangles: summary.triangles || 0,
                             plates: state.plates.length };
  setStatus(`${state.title || "model"}: ${state.colours.length} source filament(s), `
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

const valueWithUnit = (key, value) => (LENGTH_KEYS.has(key) ? `${value} mm` : value);

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

/** The print-settings controls, which differ per target.  A U1 project *is* a
 *  printer project, so the source's compatible print intent travels there; the
 *  Bambu colour model stays printer-independent, and the portable colour projects
 *  carry no print settings at all -- each is said on the page rather than implied. */
function syncSettings() {
  const isU1 = session.target === "snapmaker";
  const isBambu = session.target === "bambu";
  const state = session.state;
  // The U1 exporter reads the *project's* settings and nothing else, so the U1
  // controls describe exactly those.  Per-object settings belong to our own
  // standard colour model, and the Bambu control keeps using them so it stays
  // usable when such a file is reimported; they are deliberately not offered as a
  // U1 carry, because this export would not apply them.
  const perObject = (state && state.objectSettings) || [];
  const objectSettings = perObject.length
    ? { ...perObject[0].settings,
        objectName: perObject[0].name || perObject[0].id }
    : null;
  const projectSettings = (state && state.sourceSettings) || null;
  const source = projectSettings || objectSettings;
  const applied = isU1 ? appliedSettings(projectSettings, session.carrySettings) : [];

  const carryBox = $("carrysettings");
  if (carryBox) carryBox.checked = Boolean(session.carrySettings);
  const supportSelect = $("supportmode");
  if (supportSelect && document.activeElement !== supportSelect) {
    supportSelect.value = session.supportMode;
  }
  const bambuBox = $("preservesettings");
  if (bambuBox) bambuBox.checked = Boolean(session.preserveSourceSettings);

  const u1Block = $("u1settings");
  if (u1Block) u1Block.classList.toggle("hidden", !isU1);
  const bambuKeep = $("bambukeep");
  if (bambuKeep) bambuKeep.classList.toggle("hidden", !isBambu);

  const note = $("sourcesettings");
  if (note) {
    const list = applied.map(({ key, value }) =>
      `${labelFor(key)} ${valueWithUnit(key, value)}`);
    if (isU1) {
      note.textContent = (session.carrySettings
        ? (list.length
          ? `Will carry ${list.length} of the source's print setting(s): `
            + `${list.slice(0, 6).join(", ")}${list.length > 6 ? ", …" : ""}.`
          : "The source states no setting this U1 profile can take, so nothing is carried.")
        : "Left at the U1 profile's own values.")
        + ` ${supportSentence(projectSettings, state)}`
        + " Your printer, speeds and filaments stay the U1 profile's.";
    } else if (isBambu) {
      const bits = [];
      if (source && source.layer_height !== undefined) {
        bits.push(`layer height ${source.layer_height} mm`);
      }
      const support = supportOf(source);
      if (support) {
        bits.push(`supports ${support.enabled ? "on" : "off"}`
          + (support.type ? ` (${support.type})` : "")
          + (support.angle ? ` at ${support.angle}°` : ""));
      }
      const where = source && source.objectName
        ? `object "${source.objectName}" says` : "The source says";
      note.textContent = bits.length
        ? `${where}: ${bits.join(", ")}. Tick to carry those values; your printer, `
          + "process and filaments stay your own."
        : "The source file states no layer height or support setting, so there is "
          + "nothing to carry.";
      if (bambuBox) {
        bambuBox.disabled = !bits.length;
        if (bambuBox.disabled) bambuBox.checked = false;
      }
    } else {
      note.textContent = `${LABELS[session.target]} gets a portable colour project: `
        + "the source's layer height, supports and print settings are not carried, so "
        + "your own print preset keeps working. Convert to Snapmaker Orca (U1) to "
        + "carry them.";
    }
  }
  window.__convertSettings = {
    target: session.target,
    carry: session.carrySettings,
    supportMode: session.supportMode,
    applied: applied.map(({ key, value }) => ({ key, value })),
    supportsPainted: Boolean(state && state.supportsPainted),
  };
}

/** The layout controls mirror the session, and the note says what will happen.
 *  The capacity comes from the *shared* plan the export uses, so the page can
 *  never promise a copy the file will not write. */
function layoutPlanNow() {
  const bounds = (session.state && session.state.bounds) || null;
  if (!bounds || !bounds.size) return null;
  const box = { min: bounds.min, max: bounds.max };
  return planLayout(box, session.layout);
}

function syncLayout() {
  const layout = session.layout;
  const set = (id, value) => {
    const node = $(id);
    if (node && !session.layoutProblem && document.activeElement !== node
        && String(node.value) !== String(value)) node.value = String(value);
  };
  set("layoutcopies", layout.copies);
  set("layoutspacing", layout.spacing);
  set("layoutwidth", layout.width);
  set("layoutdepth", layout.depth);
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
      note.push(`prime-tower space of ${plan.reserve / 2} mm reserved on each X side`);
    }
    if (plan.capped) note.push(`only ${plan.capacity} fit, so that is what is written`);
  }
  note.push("your printer and process stay yours: pick them in the slicer");
  const problem = session.layoutProblem
    || (session.boundsPending ? "the selection's size is still being measured" : "")
    || (plan && plan.blocked ? "no copy fits this layout box" : "")
    || (!plan && session.state ? "the selection's size is unknown" : "");
  $("layoutnote").textContent = (problem ? `cannot write: ${problem} · ` : "")
    + note.join(" · ");
  // An invalid or impossible layout blocks the export outright.
  const go = $("convertgo");
  if (go) go.disabled = Boolean(problem) || session.busy || !session.state;
  if ($("layoutfill")) $("layoutfill").disabled = Boolean(problem) || !session.state;
}

/** Update the destination swatches, selects and the plan line from the rule. */
function syncRule() {
  if (!session.state) return;
  const { colours } = session.state;
  for (let source = 1; source <= colours.length; source += 1) {
    const destination = session.rule[source] ?? source;
    const select = $(`mapdest-${source}`);
    if (select && select.value !== String(destination)) select.value = String(destination);
    const swatch = $(`mapswatch-${source}`);
    if (swatch) swatch.style.background = hex(colours[destination - 1]);
  }
  const changes = session.changes();
  $("convertplan").innerHTML = changes.length
    ? "Chosen for export: " + changes.map(({ source, destination }) =>
      `<b>${source}</b> (${esc(hex(colours[source - 1]))}) `
      + `&rarr; <b>${destination}</b> (${esc(hex(colours[destination - 1]))})`).join(", ")
      + `; ${colours.length - changes.length} other filament(s) keep their own colour.`
    : "Chosen for export: every colour keeps its own filament, so the "
      + "file is converted without changing any colour.";
}

/* ---------- controls ---------- */

/* ---------- preview (only when asked for) ----------
 *
 * Nothing is prepared for the 3D view until Show preview is pressed: the file
 * load stays metadata-only.  In a conversion the source palette *is* the
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
  if (!preview) {
    preview = new Preview($("convertpreview"));
    $("previewreset").addEventListener("click", () => preview.reset());
    window.addEventListener("resize", () => preview.resize());
  }
  if (!preview.ok) {
    note(preview.error);
    window.__convertPreview = { mode: previewMode, triangles: 0,
                                error: preview.error };
    return;
  }
  const state = session.state;
  const colours = paletteTable(state.colours);
  const mapping = previewMode === "result" ? session.rule : null;
  let soup;
  try {
    soup = await session.worker.preview(state.plateId, null, previewMode, colours,
                                        mapping, previewGeometryId,
                                        state.coloursUsed || 0,
                                        { ...session.layout, centre: session.target === "bambu"
                                          ? [0, 0] : [session.layout.width / 2, session.layout.depth / 2] });
  } catch (error) {
    if (token !== previewToken) return;
    preview.setSoup(new Float32Array(0), new Float32Array(0));
    note(`the preview could not be drawn: ${error.message}`);
    window.__convertPreview = { mode: previewMode, triangles: 0,
                                error: error.message };
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
                              total: soup.total, simplified: soup.simplified };
}

function resetPreview() {
  previewToken += 1;
  previewShown = false;
  previewKey = null;
  previewGeometryId = null;
  previewPositions = null;
  previewMode = "result";
  if ($("previewmode")) $("previewmode").value = "result";
  if ($("previewshow")) $("previewshow").textContent = "Show preview";
  if (preview && preview.ok) preview.setSoup(new Float32Array(0), new Float32Array(0));
  note("");
  window.__convertPreview = null;
}

const input = $("convertfile");
const drop = $("convertdrop");

// Opening the picker from the drop zone must not re-enter through the input's own
// click bubbling back up to the drop zone.
drop.addEventListener("click", (event) => {
  if (event.target === input) return;
  input.click();
});
input.addEventListener("click", (event) => event.stopPropagation());
input.addEventListener("change", () => {
  const file = input.files[0];
  input.value = "";
  if (file) session.load(file);
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
  if (event.dataTransfer.files[0]) session.load(event.dataTransfer.files[0]);
});

$("convertmap").addEventListener("change", (event) => {
  const select = event.target.closest("select[data-source]");
  if (select) session.setSource(select.dataset.source, select.value);
});
$("convertswap").addEventListener("click", () => {
  if (!session.state) return;
  session.swap($("convertswapa").value, $("convertswapb").value);
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

$("previewshow").addEventListener("click", () => {
  previewShown = true;
  $("previewshow").textContent = "Refresh preview";
  refreshPreview();
});
$("previewmode").addEventListener("change", () => {
  previewMode = $("previewmode").value;
  refreshPreview();
});

paintChrome();
