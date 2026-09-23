// The online page: open a painted 3MF, recolour it onto four reels (with predicted
// blends if you want them), preview it, export a project for Snapmaker, Bambu or
// PrusaSlicer, and plan reel changes from a real slice.
//
// The browser engine has parity tests against the local Python implementation.
// The renderer is shared with the local page.

import { comparison, norm, suggestMapping } from "./shared/colour.js";
import { mappingFromPlan, mixHex, planMixtures } from "./shared/mix.js";
import { Preview } from "./shared/preview.js";
import { analyse as analyseGcode, decode as decodeGcode, planText } from "./shared/planner.js";
import { LABELS, RECOLOUR_TARGETS } from "./shared/targets.js";
import { thumbnailSizes } from "./shared/thumbnail.js";
import { RecolourWorker } from "./shared/workerClient.js";
import { readZip } from "./zip.js";

const REEL_KEY = "yab3u1-web-reels";
const VERSION = "2.4.3";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[c]));

const state = {
  entries: null, project: null, plateId: null, objects: [], reels: [], target: "snapmaker",
  mix: null, mapping: {}, recipes: [], ticked: new Set(),
  previewMode: "result", preview: null, previewGeometry: "", previewFailed: "",
  // What the export does with the file's colours: keep them, substitute them onto
  // the reels (with per-colour overrides), or use the blends that are ticked.
  strategy: "blend", overrides: {}, recipeKey: "", reviewed: false,
  // Bumped on every upload so a slow read of the previous file cannot land on top
  // of the new one and re-approve colours the user never reviewed.
  epoch: 0,
};

window.__recolour = state;                    // the QA harness and the console

function defaultReels() {
  try {
    const saved = JSON.parse(localStorage.getItem(REEL_KEY) || "null");
    if (Array.isArray(saved) && saved.length === 4) return saved;
  } catch (error) { /* fall through to the default */ }
  return [{ color: "#FFFFFF", type: "PLA" }, { color: "#000000", type: "PLA" },
          { color: "#3D9140", type: "PLA" }, { color: "#FF9500", type: "PLA" }];
}

state.reels = defaultReels();

function saveReels() {
  try { localStorage.setItem(REEL_KEY, JSON.stringify(state.reels)); } catch (e) { /* fine */ }
}

// ------------------------------------------------------------------ loading ---

$("drop").addEventListener("click", () => $("file").click());
$("file").addEventListener("click", (event) => event.stopPropagation());
$("drop").addEventListener("keydown", (event) => {
  // The drop zone is a button for the keyboard too.
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    $("file").click();
  }
});
$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (file) load(file);
});
for (const type of ["dragenter", "dragover"]) {
  $("drop").addEventListener(type, (event) => { event.preventDefault(); });
}
$("drop").addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) load(file);
});

// Keyboard-operable recovery while a big file is being read.
$("loadcancel").addEventListener("click", (event) => {
  event.stopPropagation();
  state.epoch += 1;               // abandon whatever is in flight
  assessToken += 1;
  previewToken += 1;
  restartWorker();
  setLoading(false);
  setBusy("");
  $("drop").classList.remove("hidden");
  $("file").click();
});

let worker = null;

function background() {
  if (!worker) worker = new RecolourWorker();
  return worker;
}

/** A new file gets a brand-new worker, so no old load can land on the new one. */
function restartWorker() {
  if (worker) worker.dispose();
  worker = new RecolourWorker();
  return worker;
}

/** Rebuild the light structures the page renders from, out of worker metadata. */
function applyMeta(meta, assessed) {
  state.project = {
    kind: meta.kind,
    title: meta.title,
    colors: meta.colors,
    types: meta.types,
    paletteCount: meta.paletteCount,
    paletteSource: meta.paletteSource,
    baseExtruder: meta.baseExtruder,
    warnings: meta.warnings,
    plates: meta.plates.map((plate) => ({ id: plate.id, name: plate.name,
                                          objectIds: plate.objectIds,
                                          entries: plate.entries })),
    objects: new Map(meta.objects.map((object) => [object.id, object])),
    meta: new Map(meta.meta.map((entry) => [entry.id, entry])),
    items: meta.items,
  };
  state.assessed = assessed;
}

function setBusy(text) {
  const node = $("loadstatus");
  if (node) node.textContent = text || "";
}

async function load(file) {
  const epoch = (state.epoch += 1);
  // Any assessment or preview already in flight belongs to the previous file.
  assessToken += 1;
  previewToken += 1;
  $("drop").classList.remove("hidden");
  // A new file invalidates everything the previous one approved: its mappings,
  // its recipe ticks, its preview and any download it left on the page.
  resetForUpload();
  setBusy(`reading ${file.name}…`);
  setLoading(true);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Checked *before* the worker is touched: a newer file may have been chosen
    // while this one was still being read from disk.
    if (epoch !== state.epoch) return;
    state.entries = null;                      // the worker owns the archive now
    const stageText = { zip: "Unpacking the file", parse: "Reading the model",
                        assess: "Measuring the colours",
                        preview: "Preparing the preview" };
    const result = await restartWorker().load(bytes.buffer, {}, (progress) => {
      if (epoch !== state.epoch) return;
      setBusy(`${stageText[progress.stage] || "Working"}… `
              + `${(progress.ms / 1000).toFixed(1)}s`);
      window.__loadProgress = { stage: progress.stage, ms: progress.ms };
    });
    if (epoch !== state.epoch) return;         // a newer file was chosen meanwhile
    applyMeta(result.meta, result.assessed);
    state.plateId = state.project.plates.length ? state.project.plates[0].id : null;
    state.objects = [];
    show();
    $("drop").classList.add("hidden");
    window.__loadTiming = { ms: result.ms, triangles: result.assessed.counts.triangles };
  } catch (error) {
    if (epoch !== state.epoch) return;
    state.project = null;
    state.entries = null;
    $("drop").classList.remove("hidden");
    $("loaderror").textContent = `That file could not be read: ${error.message}. Choose another file.`;
  } finally {
    if (epoch === state.epoch) setLoading(false);
    if (epoch === state.epoch) setBusy("");
  }
}

/** While a file is being read, the page offers a way out instead of a freeze. */
function setLoading(active) {
  state.loading = active;
  const cancel = $("loadcancel");
  if (cancel) cancel.classList.toggle("hidden", !active);
  const exportButton = $("export");
  if (exportButton) exportButton.disabled = active || !state.project;
  if (!active && state.project && state.mix) renderExport();
}

function resetForUpload() {
  // Bumped here too: this runs before any of the early returns below, so an
  // in-flight assessment or preview from the previous file can never apply.
  assessToken += 1;
  previewToken += 1;
  state.project = null;
  $("loaderror").textContent = "";
  ["project", "reelscard", "mixcard", "previewcard", "exportcard", "plannercard"]
    .forEach((id) => $(id).classList.add("hidden"));
  state.assessed = null;
  state.mix = null;
  state.recipes = [];
  state.ticked = new Set();
  state.recipeKey = "";
  state.mapping = {};
  state.overrides = {};
  state.reviewed = false;
  state.objects = [];
  state.previewGeometry = "";
  state.previewFailed = "";
  state.lastPositions = null;      // the next selection sends its own geometry
  state.geometryId = null;
  state.loading = false;
  state.exporting = false;
  state.assessedKey = "";          // a new file needs a new assessment
  const review = $("review");
  if (review) review.checked = false;
  if (state.preview) state.preview.setSoup(new Float32Array(0), new Float32Array(0));
  for (const id of ["maptable", "mixlist", "exportlog", "plandownloads"]) {
    const node = $(id);
    if (node) node.innerHTML = "";
  }
  const planOut = $("planout");
  if (planOut) planOut.classList.add("hidden");
  const note = $("mixnote");
  if (note) note.textContent = "";
}

function show() {
  ["project", "reelscard", "mixcard", "previewcard", "exportcard", "plannercard"]
    .forEach((id) => $(id).classList.remove("hidden"));
  $("version").textContent = "v" + VERSION;
  $("pfacts").textContent = `${state.project.kind} project · `
    + `${state.project.paletteCount} source slots in the file`
    + (state.project.title ? ` · ${state.project.title}` : "");
  $("plate").innerHTML = state.project.plates.map((plate) =>
    `<option value="${plate.id}">${esc(plate.name)} · ${plate.objectIds.length} `
    + "object(s)</option>").join("");
  $("plate").value = String(state.plateId);
  $("target").innerHTML = RECOLOUR_TARGETS.map((id) =>
    `<option value="${id}">${esc(LABELS[id])}</option>`).join("");
  $("target").value = state.target;
  renderReels();
  renderObjects();
  // The worker has already prepared the first preview; `refresh`/`refreshPreview`
  // pick it up (a cache hit, so it is one message, not another parse).
  refresh();
}

$("plate").addEventListener("change", () => {
  state.plateId = Number($("plate").value);
  state.objects = [];
  $("exportlog").innerHTML = "";
  clearReview();
  renderObjects();
  refresh();
});

function renderObjects() {
  const eligible = eligibleForPlate();
  $("objects").innerHTML = eligible.map((id) => {
    const object = state.project.objects.get(id);
    const meta = state.project.meta.get(id);
    const name = (meta && meta.name) || `object ${id}`;
    return `<label class="check"><input type="checkbox" data-object="${esc(id)}" checked>`
      + `<span>${esc(name)} <span class="hint">[${esc(id)}]</span></span></label>`;
  }).join("");
  $("objects").querySelectorAll("input[data-object]").forEach((box) => {
    box.addEventListener("change", () => {
      state.objects = selectedObjects();
      // A different selection is a different mapping: the tick above it no longer
      // approves what would be written.
      clearReview();
      refresh();
    });
  });
  state.objects = selectedObjects();
  $("selhint").textContent = `${eligible.length} object(s) on this plate; the `
    + "assessment, preview and export follow the ticked ones.";
}

function eligibleForPlate() {
  const plate = state.project.plates.find((p) => Number(p.id) === Number(state.plateId));
  const ids = plate ? plate.objectIds : [...state.project.objects.keys()];
  const out = [];
  for (const id of ids) {
    if (state.project.objects.has(String(id)) && !out.includes(String(id))) {
      out.push(String(id));
    }
  }
  return out.length ? out : [...state.project.objects.keys()];
}

function selectedObjects() {
  return [...$("objects").querySelectorAll("input[data-object]")]
    .filter((box) => box.checked).map((box) => box.getAttribute("data-object"));
}

function renderReels() {
  $("reels").innerHTML = state.reels.map((reel, index) =>
    `<div class="field"><label for="reel${index}">Slot ${index + 1}</label>`
    + `<input type="color" id="reel${index}" value="${esc(reel.color)}">`
    + `<select data-type="${index}">${["PLA", "PETG", "ABS", "TPU", "ASA", "PA"]
      .map((type) => `<option${type === reel.type ? " selected" : ""}>${type}</option>`)
      .join("")}</select></div>`).join("");
  state.reels.forEach((reel, index) => {
    $(`reel${index}`).addEventListener("input", (event) => {
      state.reels[index].color = event.target.value.toUpperCase();
      saveReels();
      clearReview();
      refresh();
    });
  });
  $("reels").querySelectorAll("select[data-type]").forEach((select) => {
    select.addEventListener("change", () => {
      state.reels[Number(select.getAttribute("data-type"))].type = select.value;
      saveReels();
      clearReview();
      refresh();
    });
  });
  $("reelnote").textContent = "These four are the reels you have loaded. Everything "
    + "below is compared against them; a predicted blend never replaces a reel that "
    + "already matches exactly.";
}

// -------------------------------------------------------------- assessment ----

let assessToken = 0;

async function refresh() {
  if (!state.project) return;
  if (!state.objects.length) {
    // The tokens move first: a reply already on its way must not repopulate a
    // selection the user has just cleared.
    assessToken += 1;
    previewToken += 1;
    /* Nothing ticked is a state of its own: no mapping, no preview, no export. */
    state.assessed = null;
    state.mix = null;
    state.recipes = [];
    state.recipeKey = "";
    $("maptable").innerHTML = "";
    $("mixlist").innerHTML = "";
    $("mixnote").innerHTML = '<span class="bad">Tick at least one object on this '
      + "plate.</span>";
    clearReview();
    refreshPreview();
    renderExport();
    return;
  }
  const token = (assessToken += 1);
  // The assessment depends on the file and the selection, not on the reels or the
  // strategy, so a palette/recipe change reuses it: no whole-XML pass at all.
  const assessKey = `${state.epoch}|${state.plateId}|${state.objects.join(",")}`;
  if (state.assessed && state.assessedKey === assessKey) {
    useAssessed(state.assessed);
    return;
  }
  let assessed;
  try {
    // The whole-XML assessment happens in the worker; the UI thread only ever
    // waits for a result (and drops it if the selection changed meanwhile).
    assessed = await background().assess(state.plateId, state.objects);
  } catch (error) {
    if (token !== assessToken) return;
    state.assessed = null;
    $("mixnote").innerHTML = `<span class="bad">${esc(error.message)}</span>`;
    state.previewFailed = error.message;
    refreshPreview();
    renderExport();
    return;
  }
  if (token !== assessToken || !state.project) return;
  state.assessedKey = assessKey;
  useAssessed(assessed);
}

/** Everything that follows an assessment, with the assessment already in hand. */
function useAssessed(assessed) {
  state.assessed = assessed;
  state.mix = planMixtures(assessed.sourceColors, state.reels);
  state.recipes = state.mix.recipes;
  /* Ticking belongs to one recipe set. A new set starts fully ticked; an empty set
     means the user turned every blend off, and that must stay off. */
  const key = JSON.stringify(state.recipes.map((r) => [r.id, r.a, r.b, r.percent]));
  if (key !== state.recipeKey) {
    state.recipeKey = key;
    state.ticked = new Set(state.recipes.map((recipe) => recipe.id));
    clearReview();
  }
  for (const id of [...state.ticked]) {
    if (!state.recipes.some((recipe) => recipe.id === id)) state.ticked.delete(id);
  }
  renderMix(assessed);
  refreshPreview();
  renderExport();
}

function clearReview() {
  state.reviewed = false;
  const box = $("review");
  if (box) box.checked = false;
  renderExport();
}

/** What the export would write for the selected strategy. */
function resultPlan() {
  const assessed = state.assessed;
  const slots = state.reels.map((reel) => norm(reel.color));
  if (!assessed) {
    return { mapping: {}, recipes: [], kept: [], physical: state.reels,
             blocked: "tick at least one object" };
  }
  if (state.strategy === "source") {
    const used = assessed.used;
    if (used.length > 4) {
      return { mapping: {}, recipes: [], kept: [], physical: state.reels,
               blocked: `this selection uses ${used.length} colours, so the file's own `
                 + "colours cannot all fit in four slots" };
    }
    const mapping = {};
    used.forEach((source) => { mapping[source] = source; });
    return {
      mapping, recipes: [], kept: [], source: true,
      physical: used.map((source) => ({
        color: (state.project.colors[source - 1] || "#FFFFFF"),
        type: (state.project.types[source - 1] || "PLA"),
      })),
    };
  }
  if (state.strategy === "solid") {
    const mapping = suggestMapping(assessed.sourceColors, slots);
    for (const [source, slot] of Object.entries(state.overrides)) {
      if (Number(slot) > 0) mapping[source] = Number(slot);
    }
    return { mapping, recipes: [], kept: [], physical: state.reels };
  }
  const kept = state.recipes.filter((recipe) => state.ticked.has(recipe.id));
  const ids = new Map(kept.map((recipe, index) => [recipe.id, 5 + index]));
  const byRow = new Map((state.mix.rows || []).map((row) => [row.source, row]));
  const suggested = mappingFromPlan(state.mix);
  const mapping = {};
  for (const [source, want] of Object.entries(suggested)) {
    const id = Number(want);
    if (id <= 4) { mapping[source] = id; continue; }
    if (ids.has(id)) { mapping[source] = ids.get(id); continue; }
    const row = byRow.get(Number(source));
    mapping[source] = (row && row.solid.slot) || 1;
  }
  for (const [source, slot] of Object.entries(state.overrides)) {
    if (Number(slot) > 0) mapping[source] = Number(slot);
  }
  return { recipes: kept.map((recipe) => ({ a: recipe.a, b: recipe.b,
                                            percent: recipe.percent })),
           mapping, kept, physical: state.reels };
}

function renderMix(assessed) {
  const payload = resultPlan();
  const slots = state.reels.map((reel) => norm(reel.color));
  const rows = comparison(assessed.sourceColors, payload.mapping, slots);
  const blendMode = state.strategy === "blend";
  $("maptable").innerHTML = "<table><thead><tr><th>Source</th><th>In the file</th>"
    + "<th>Export result</th><th>Closest blend</th><th>Difference</th>"
    + "<th>Use</th></tr></thead>"
    + "<tbody>" + rows.map((row) => {
      const mixRow = (state.mix.rows || []).find((item) => item.source === row.source);
      const blend = mixRow && mixRow.mixture
        ? `${mixRow.mixture.color} (${mixRow.mixture.error})` : "none improves";
      const chosen = state.strategy === "source" ? row.original
        : (payload.mapping[row.source] > 4
          ? (payload.kept[payload.mapping[row.source] - 5] || {}).color || row.result
          : slots[(payload.mapping[row.source] || 1) - 1]);
      const options = ["<option value=\"0\">"
        + (blendMode ? "planned blend / nearest" : "nearest") + "</option>"]
        .concat([1, 2, 3, 4].map((slot) =>
          `<option value="${slot}"${Number(state.overrides[row.source]) === slot
            ? " selected" : ""}>slot ${slot} · ${esc(slots[slot - 1])}</option>`))
        .join("");
      return `<tr><td>colour ${row.source}</td>`
        + `<td><span class="swatch" style="background:${esc(row.original)}"></span>`
        + `${esc(row.original)}</td>`
        + `<td><span class="swatch" style="background:${esc(chosen)}"></span>`
        + `${esc(chosen)}</td>`
        + `<td>${esc(blend)}</td>`
        + `<td>${esc(row.verdict)}${row.distance === null ? "" : ` (${row.distance})`}</td>`
        + (state.strategy === "source"
          ? '<td class="hint">kept</td>'
          : `<td><select data-source="${row.source}">${options}</select></td>`)
        + "</tr>";
    }).join("") + "</tbody></table>";
  $("maptable").querySelectorAll("select[data-source]").forEach((select) => {
    select.addEventListener("change", () => {
      const source = select.getAttribute("data-source");
      const value = Number(select.value);
      if (value > 0) state.overrides[source] = value;
      else delete state.overrides[source];
      clearReview();
      renderMix(state.assessed);
      refreshPreview();
    });
  });

  $("mixlist").innerHTML = (blendMode && state.recipes.length)
    ? '<ul class="reciperows">' + state.recipes.map((recipe) =>
      `<li><span class="swatch" style="background:${esc(recipe.color)}"></span>`
      + `<label class="check"><input type="checkbox" data-recipe="${recipe.id}"`
      + `${state.ticked.has(recipe.id) ? " checked" : ""}> reel ${recipe.a} + `
      + `${recipe.percent}% of reel ${recipe.b} · predicted ${esc(recipe.color)}`
      + "</label></li>").join("") + "</ul>"
    : "";
  $("mixlist").querySelectorAll("input[data-recipe]").forEach((box) => {
    box.addEventListener("change", () => {
      const id = Number(box.getAttribute("data-recipe"));
      if (box.checked) state.ticked.add(id); else state.ticked.delete(id);
      clearReview();
      refresh();
    });
  });
  $("mixnote").textContent = state.mix.advice
    + (state.strategy === "source"
      ? ` Keeping the file's own ${assessed.used.length} colour(s) in slots 1-`
        + `${assessed.used.length}; no substitution and no mixture.`
      : blendMode
        ? ` ${state.ticked.size} of ${state.recipes.length} recipe(s) ticked; the `
          + "export writes them after your four reels. Predicted shades are "
          + "uncalibrated."
        : " Substituting every source colour onto one of your four reels; use the "
          + "dropdowns to change any of them.");
}

document.querySelectorAll("[data-strategy]").forEach((button) => {
  button.addEventListener("click", () => {
    state.strategy = button.getAttribute("data-strategy");
    document.querySelectorAll("[data-strategy]").forEach((other) =>
      other.setAttribute("aria-pressed", String(other === button)));
    clearReview();
    refresh();
  });
});

$("review").addEventListener("change", () => {
  state.reviewed = $("review").checked;
  renderExport();
});
$("target").addEventListener("change", () => {
  state.target = $("target").value;
  clearReview();
});

// ----------------------------------------------------------------- preview ----

document.querySelectorAll("[data-preview]").forEach((button) => {
  button.addEventListener("click", () => {
    state.previewMode = button.getAttribute("data-preview");
    document.querySelectorAll("[data-preview]").forEach((other) =>
      other.setAttribute("aria-pressed", String(other === button)));
    refreshPreview();
  });
});

let previewToken = 0;

async function refreshPreview() {
  const token = (previewToken += 1);
  const canvas = $("preview");
  if (!state.preview) {
    state.preview = new Preview(canvas);
    $("previewreset").addEventListener("click", () => state.preview.reset());
    window.addEventListener("resize", () => state.preview.resize());
  }
  if (!state.preview.ok) {
    $("previewnote").textContent = state.preview.error;
    return;
  }
  if (!state.objects.length || !state.assessed) {
    state.preview.setSoup(new Float32Array(0), new Float32Array(0));
    $("previewnote").textContent = state.previewFailed
      ? ` the preview could not be drawn: ${state.previewFailed}`
      : " nothing is ticked, so there is nothing to show";
    window.__preview = { mode: state.previewMode, triangles: 0,
                         error: state.previewFailed || "empty" };
    return;
  }
  const payload = resultPlan();
  const table = paletteOf(payload, state.previewMode);
  const mapping = state.previewMode === "result" && state.strategy !== "source"
    ? payload.mapping : null;
  let soup;
  try {
    soup = await background().preview(state.plateId, state.objects,
                                      state.previewMode, table, mapping,
                                      state.geometryId,
                                      (state.assessed && state.assessed.counts
                                       && state.assessed.counts.triangles) || 0);
    // A newer request (another palette, another selection, another file) wins.
    if (token !== previewToken) return;
    state.previewFailed = "";
  } catch (error) {
    if (token !== previewToken) return;
    /* A preview problem must not stop the export review: it is reported here and
       the export path is untouched. */
    state.previewFailed = error.message;
    state.preview.setSoup(new Float32Array(0), new Float32Array(0));
    $("previewnote").innerHTML = ` the preview could not be drawn: ${esc(error.message)}`;
    window.__preview = { mode: state.previewMode, triangles: 0, error: error.message };
    return;
  }
  const geometry = `${state.plateId}|${state.objects.join(",")}`;
  const fit = geometry !== state.previewGeometry;
  state.previewGeometry = geometry;
  applyPreview(soup, fit);
}

/** Show one prepared soup: the only place the renderer and its note are updated. */
function applyPreview(soup, fit) {
  if (!state.preview || !state.preview.ok) return;
  // Positions arrive once per selection; a colour-only update reuses the array
  // the renderer already uploaded, so nothing big is copied or re-uploaded.
  if (soup.positions) {
    state.lastPositions = soup.positions;
    state.geometryId = soup.geometryId;
  }
  const positions = (soup.geometryId === state.geometryId && state.lastPositions)
    ? state.lastPositions : new Float32Array(0);
  if (!positions.length && soup.triangles) {
    $("previewnote").textContent = "the preview geometry had to be fetched again; "
      + "press Original/Result to retry";
    return;
  }
  state.preview.setSoup(positions, soup.colors, { fit });
  state.preview.resize();
  window.__preview = { mode: state.previewMode, triangles: soup.triangles,
                       floats: positions.length, colors: soup.colors.length,
                       strategy: state.strategy, truncated: soup.simplified,
                       subdivided: soup.subdivided, unknown: soup.unknown,
                       simplified: soup.simplified, reused: soup.reused,
                       total: soup.total, prepare_ms: soup.prepare_ms,
                       full: soup.full, soup_triangles: soup.soup_triangles };
  $("previewnote").textContent = `${soup.triangles.toLocaleString()} facets drawn`
    + (soup.subdivided ? ` · ${soup.subdivided.toLocaleString()} sub-divided facets are `
       + "shown in their dominant colour; the exported attribute still keeps every leaf"
       : "")
    + (soup.unknown ? ` · ${soup.unknown} facets carry paint this tool will not rewrite `
       + "(pink)" : "")
    + (soup.simplified
       ? ` · approximate preview of ${(soup.full || 0).toLocaleString()} triangles; `
         + "fine geometry and colour boundaries may differ. The export keeps the complete mesh"
       : "")
    + " · drag to orbit, shift-drag to pan, wheel to zoom."
    + (state.previewMode === "original" ? " Showing the file's own colours."
       : (state.strategy === "source"
         ? " Showing the file's own colours, which this export keeps."
         : " Showing the colours this export would write."));
}

function paletteOf(payload, mode) {
  const table = {};
  if (mode === "original" || state.strategy === "source") {
    // The file's own palette, by source extruder.
    state.project.colors.forEach((colour, index) => {
      if (colour) table[index + 1] = colour;
    });
    return table;
  }
  state.reels.forEach((reel, index) => { table[index + 1] = norm(reel.color); });
  payload.kept.forEach((recipe, index) => {
    table[5 + index] = mixHex(norm(state.reels[recipe.a - 1].color),
                              norm(state.reels[recipe.b - 1].color),
                              recipe.percent);
  });
  return table;
}

// ------------------------------------------------------------------ export ----

function renderExport() {
  const payload = resultPlan();
  const target = state.target;
  const mixtures = payload.recipes.length;
  const reviewBox = $("review");
  const blocking = !state.objects.length ? "tick at least one object"
    : payload.blocked;
  const needsReview = state.strategy !== "source" && !blocking;
  reviewBox.parentElement.classList.toggle("hidden", !needsReview);
  reviewBox.checked = state.reviewed;
  $("export").disabled = state.loading || state.exporting || Boolean(blocking)
    || (needsReview && !state.reviewed);
  $("exportnote").textContent = blocking
    ? `Cannot export yet: ${blocking}.`
    : mixtures
    ? (target === "snapmaker"
      ? `${mixtures} reviewed recipe(s) will be written as the U1's native `
        + "mixed_filament_definitions rows, with the four physical slots left at four."
      : `${mixtures} reviewed recipe(s) will be written in ${LABELS[target]}'s own `
        + "format. A foreign project is portable: it carries the geometry, the parts, "
        + "the palette and the recipes, and none of the U1's printer or G-code "
        + "settings.")
    : state.strategy === "source"
      ? "Each source colour keeps its own slot and its own filament; no substitution "
        + "and no mixture."
      : "Every source colour is written onto one of your four reels, exactly as the "
        + "table above shows.";
  if (!blocking && target === "prusa") {
    $("exportnote").textContent += " Open the file as a project in PrusaSlicer with a "
      + "four-extruder profile: the palette lives in the Full Spectrum description, "
      + "and this tool writes no print config that would override your preset.";
  }
}

function exportRevision() {
  const payload = resultPlan();
  return JSON.stringify({epoch: state.epoch, plate: state.plateId,
    objects: state.objects, target: state.target, reels: state.reels,
    physical: payload.physical, mapping: payload.mapping, recipes: payload.recipes,
    strategy: state.strategy, reviewed: state.reviewed});
}

$("export").addEventListener("click", async () => {
  if (!state.project || state.loading || state.exporting || $("export").disabled) return;
  const payload = resultPlan();
  const log = $("exportlog");
  log.innerHTML = '<span class="hint">writing the project&hellip;</span>';
  const epoch = state.epoch;
  // One export at a time, and the result is only offered if nothing that went
  // into it has changed meanwhile (a different target must never be labelled
  // with the previous archive).
  if (state.exporting) return;
  state.exporting = true;
  const button = $("export");
  if (button) button.disabled = true;
  const revision = exportRevision();
  const started = performance.now();
  try {
    // A fresh picture of what this export writes, rendered from the *output*
    // colours in the worker (no canvas, no WebGL): the file carries a thumbnail
    // whether or not the 3D view was ever opened, and never the source's own.
    const sizes = thumbnailSizes(state.target);
    const table = paletteOf(payload, "result");
    const previewMapping = state.strategy !== "source" ? payload.mapping : null;
    const rendered = await background().thumbnail(
      state.plateId, state.objects, table, previewMapping,
      { size: sizes.main, small: sizes.small,
        estimate: (state.assessed && state.assessed.counts
                   && state.assessed.counts.triangles) || 0 });
    if (exportRevision() !== revision) return;
    if (!rendered || !rendered.main) {
      throw new Error("the output thumbnail could not be rendered, so this project "
        + "was not saved without one");
    }
    // Remapping a million painted triangles and zipping the result is a worker
    // job too: the main thread only waits and then offers the file.
    const built = await background().export(state.plateId, state.objects, {
      target: state.target, reels: state.reels, physical: payload.physical,
      mapping: payload.mapping, recipes: payload.recipes,
      title: state.project.title,
      thumbnails: { main: rendered.main, small: rendered.small || null },
    });
    if (exportRevision() !== revision) return;
    const bytes = new Uint8Array(built.bytes);
    const blob = new Blob([bytes], { type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" });
    const name = (state.project.title || "model").replace(/[^\w.-]+/g, "-")
      + `-${state.target}-recoloured.3mf`;
    log.innerHTML = `<span class="ok">wrote ${esc(name)} `
      + `(${(blob.size / 1048576).toFixed(2)} MB in `
      + `${((performance.now() - started) / 1000).toFixed(1)}s)</span>`;
    window.__lastExport = { target: state.target, recipes: payload.recipes,
                            mapping: payload.mapping, strategy: state.strategy,
                            bytes: blob.size, name,
                            thumbnails: built.thumbnails || null };
    download(blob, name, $("exportlog"));
  } catch (error) {
    if (epoch === state.epoch && exportRevision() === revision) {
      log.innerHTML = `<span class="bad">${esc(error.message)}</span>`;
    }
  } finally {
    if (epoch === state.epoch) {
      state.exporting = false;
      if (state.project) renderExport();
    }
  }
});

function download(blob, filename, host) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.className = "save";
  link.textContent = `Save ${filename}`;
  host.appendChild(document.createElement("br"));
  host.appendChild(link);
  const auto = document.createElement("a");
  auto.href = url;
  auto.download = filename;
  document.body.appendChild(auto);
  auto.click();
  auto.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// ----------------------------------------------------------------- planner ----

let planEpoch = 0;

async function planChanges() {
  const epoch = (planEpoch += 1);
  const file = $("gcodefile").files[0];
  if (!file) {
    $("gcodemember").innerHTML = '<span class="bad">Choose the sliced file first.</span>';
    return;
  }
  const chosen = $("gcodememberlist").value || "";
  $("gcodemember").textContent = `reading ${file.name}\u2026`;
  $("planout").classList.add("hidden");
  $("plandownloads").innerHTML = "";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text;
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const entries = await readZip(bytes);
      if (epoch !== planEpoch) return;
      const members = [...entries.keys()].filter((name) => name.toLowerCase()
        .endsWith(".gcode"));
      if (!members.length) {
        throw new Error("that sliced 3MF has no .gcode member in it");
      }
      if (!chosen || !members.includes(chosen)) {
        // More than one toolpath can live in a sliced 3MF, and guessing which one
        // the user meant is how the wrong plan gets shown.  Ask instead.
        showMembers(members);
        return;
      }
      $("gcodemember").textContent = `using ${chosen} from the 3MF`;
      text = decodeGcode(entries.get(chosen));
    } else {
      $("gcodepick").classList.add("hidden");
      $("gcodememberlist").innerHTML = "";
      text = decodeGcode(bytes);
    }
    if (epoch !== planEpoch) return;
    const evidence = analyseGcode(text, { physical: 4 });
    evidence.plan_text = planText(evidence, file.name);
    if (epoch !== planEpoch) return;
    showPlan(evidence, file.name, chosen);
  } catch (error) {
    if (epoch !== planEpoch) return;
    $("planout").classList.add("hidden");
    $("plandownloads").innerHTML = "";
    $("gcodemember").innerHTML = `<span class="bad">${esc(error.message)}</span>`;
  }
}

function showMembers(members) {
  const list = $("gcodememberlist");
  list.innerHTML = "";
  members.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    list.appendChild(option);
  });
  $("gcodepick").classList.remove("hidden");
  $("gcodemember").innerHTML = "That sliced 3MF holds more than one G-code "
    + "member; choose the one to read, then press <b>Plan reel changes</b>.";
}

function showPlan(evidence, name, member = "") {
  $("gcodemember").textContent = member
    ? `${member}: ${evidence.summary}` : evidence.summary;
  const box = $("planout");
  box.classList.remove("hidden");
  box.innerHTML = `<pre>${esc(evidence.plan_text)}</pre>`;
  const downloads = $("plandownloads");
  downloads.innerHTML = "";
  const base = String(name).replace(/\.[^.]+$/, "");
  downloads.appendChild(linkFor(new Blob([evidence.plan_text], { type: "text/plain" }),
                                `${base}-reel-changes.txt`, "Download the plan (.txt)"));
  downloads.appendChild(linkFor(new Blob([JSON.stringify(evidence, null, 2)],
                                         { type: "application/json" }),
                                `${base}-plan-evidence.json`,
                                "Download the evidence (.json)"));
  window.__plan = { feasible: evidence.feasible, pause_count: evidence.pause_count,
                    reel_changes: evidence.reel_changes, layers: evidence.layers,
                    tools: evidence.tools, member };
}

$("gcodefile").addEventListener("change", () => {
  planEpoch += 1;                    // any plan in flight is for the old file
  // A new file invalidates any member choice made against the previous one, and
  // the old plan must not stay on screen next to it.
  $("gcodepick").classList.add("hidden");
  $("gcodememberlist").innerHTML = "";
  $("planout").classList.add("hidden");
  $("plandownloads").innerHTML = "";
  const file = $("gcodefile").files[0];
  $("gcodemember").textContent = file ? `selected ${file.name}` : "";
});

$("planbutton").addEventListener("click", () => planChanges());
$("gcodememberlist").addEventListener("change", () => planChanges());

function linkFor(blob, filename, label) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.className = "save";
  link.textContent = label;
  return link;
}

// ------------------------------------------------------------------ theme -----

const THEME_KEY = "yab3u1-theme";
const themeButton = $("theme");
function setTheme(theme, remember) {
  document.documentElement.setAttribute("data-theme", theme);
  if (remember) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (error) { /* fine */ }
  }
  // The same label the converter's header uses, so the two pages read alike.
  const toLight = theme === "dark";
  themeButton.textContent = toLight ? "Light" : "Dark";
  themeButton.setAttribute("aria-label",
                           toLight ? "Switch to light theme" : "Switch to dark theme");
}
setTheme(localStorage.getItem(THEME_KEY)
  || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
  false);
$("theme").addEventListener("click", () => setTheme(
  document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light",
  true));
$("version").textContent = "v" + VERSION;
