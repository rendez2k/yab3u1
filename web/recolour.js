// The online page: open a painted 3MF, recolour it onto four reels (with predicted
// blends if you want them), preview it, export a project for Snapmaker, Bambu or
// PrusaSlicer, and plan reel changes from a real slice.
//
// The browser engine has parity tests against the local Python implementation.
// The renderer is shared with the local page.

import { comparison, distance, norm, suggestMapping } from "./shared/colour.js";
import { describeColourMapping, mappingFromPlan, planBlends, plausibleBlend, swapPaletteSlots } from "./shared/mix.js";
import { Preview } from "./shared/preview.js";
import { LABELS, RECOLOUR_TARGETS } from "./shared/targets.js";
import { thumbnailSizes } from "./shared/thumbnail.js";
import { RecolourWorker } from "./shared/workerClient.js";
import { readZip } from "./zip.js";
import { mountSpoolImport } from "./shared/spoolImport.js";
import { colourName } from "./shared/assignment.js";

const REEL_KEY = "yab3u1-web-reels";
import { renderFilamentPicker } from './shared/filamentPicker.js';
import {createTextureImport} from './shared/textureImport.js';
import { buildU1Profile, profileDescription } from './shared/u1Profiles.js';

const VERSION = "2.6.1-preview.4";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[c]));

const state = {
  entries: null, project: null, plateId: null, objects: [], reels: [], target: "snapmaker", u1Nozzle: "auto",
  mix: null, mapping: {}, recipes: [], ticked: new Set(),
  previewMode: "original", preview: null, previewGeometry: "", previewFailed: "",
  // What the export does with the file's colours: keep them, substitute them onto
  // the reels (with per-colour overrides), or use the blends that are ticked.
  strategy: "blend", overrides: {}, recipeKey: "", reviewed: false, approximate: false,
  workflow: "model", modelType: "PLA", keepExact: [], useOwned: false, modelApplied: false, modeReels: {},
  stock: null, locked: [false,false,false,false], recommendation: null, recommendationSearch: null, reelView: "loaded",
  appliedSlotOrder: null, loadedTuning: null, recommendationOptions: [], recommendationIndex: 0, showMorePalettes: false,
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

state.modeReels.loaded = defaultReels();
state.modeReels.model = ['#FFFFFF','#000000','#0080C0','#FF0000'].map(color=>({color,type:'PLA'}));
state.reels = state.modeReels.model.map(r=>({...r}));

function saveReels() {
  if(state.workflow!=="loaded") return;
  try { localStorage.setItem(REEL_KEY, JSON.stringify(state.reels.map(({color,type})=>({color,type})))); } catch (e) { /* fine */ }
}

const spoolImport = mountSpoolImport({ host: $("spoolimport"), getReels: () => state.reels, apply: (reels) => {
  if(state.workflow!=="loaded") switchWorkflow("loaded");
  state.reels = reels;
  state.appliedSlotOrder=null;
  saveReels(); clearReview(); renderReels(); refresh();
}, onStock: rows => { state.stock=rows; if(rows===null) state.useOwned=false; renderWorkflow(); invalidateRecommendation(); refresh(); } });

let recommendationWorker=null, recommendationKey='';
function activeReels() {
  return state.reelView==='recommended' && state.recommendation ? state.recommendation.reels : state.reels;
}
function setReelView(view) {
  if(view===state.reelView) return;
  if(view==='recommended') {
    state.loadedTuning={overrides:state.overrides,ticked:state.ticked,recipeKey:state.recipeKey};
    state.overrides={}; state.ticked=new Set(); state.recipeKey='';
  } else if(state.loadedTuning) {
    Object.assign(state,state.loadedTuning); state.loadedTuning=null;
  }
  state.reelView=view;
}
function invalidateRecommendation() {
  recommendationWorker?.terminate(); recommendationWorker=null; recommendationKey='';
  state.recommendation=null; state.recommendationOptions=[]; state.recommendationIndex=0; state.showMorePalettes=false; setReelView('loaded');
  state.recommendationSearch=null; state.modelApplied=false;
  // Until a model palette is selected, only the actual source is a valid view.
  if(state.workflow==='model') state.previewMode='original';
  renderRecommendation('Updating colour suggestions…');
  clearReview();
}
function activeApproximation() {
  return state.reelView==='recommended' ? Boolean(state.recommendation?.approximate) : state.approximate;
}
function paletteTitle(option,index) {
  return option.approximate ? (option.usesLoaded ? 'Approximation with loaded reels' : 'Approximate blend palette')
    : index ? `Close-match alternative ${index}` : 'Closest reproduction';
}
// One comparison layout for palette choices and the selected export summary.
function colourChange(row) {
  const chip=(hex,label)=>`<span class="change-colour"><span class="change-label">${label}</span><i class="change-swatch" style="background:${esc(hex)}" aria-hidden="true"></i><strong>${esc(colourName(hex))}</strong><small>${esc(hex)}</small></span>`;
  const unresolved=row.kind==='unresolved';
  const change=unresolved ? '' : distance(row.original,row.result);
  return `<span class="colour-change"><span class="change-pair">${chip(row.original,'Original')}<span class="change-arrow" aria-hidden="true">→</span>${unresolved ? '<span class="change-colour"><span class="change-label">Result</span><strong>No suitable enabled blend</strong></span>' : chip(row.result,row.kind==='blended' ? 'Predicted blend' : 'New colour')}</span>
    ${row.recipe && !unresolved ? `<span class="change-recipe">${100-row.recipe.percent}% slot ${row.recipe.a} + ${row.recipe.percent}% slot ${row.recipe.b}</span>` : ''}
    ${change>12 ? `<span class="change-difference">${change>25?'Large colour change':'Noticeable colour change'}</span>` : ''}</span>`;
}
function renderPaletteSlots() {
  const host=$("paletteslots"), palette=state.recommendation;
  host.hidden=state.workflow!=='model' || !palette;
  if(host.hidden) { host.replaceChildren(); return; }
  host.innerHTML=`<h3>Arrange selected palette</h3><p class="hint">Match the slots on your printer. Choosing an occupied slot swaps the two colours; blend recipes follow automatically.</p>
    <div class="slot-arrangement">${palette.reels.map((reel,index)=>`<label class="slot-row"><i class="swatch" style="background:${esc(reel.color)}" aria-hidden="true"></i><span><strong>${esc(reel.name || colourName(reel.color))}</strong><small>${esc(reel.color)}</small></span><select data-palette-slot="${index}" aria-label="Slot for ${esc(reel.name || colourName(reel.color))} (${esc(reel.color)}), currently slot ${index+1}">${palette.reels.map((_,slot)=>`<option value="${slot}"${index===slot?' selected':''}>Slot ${slot+1}</option>`).join('')}</select></label>`).join('')}</div>`;
  host.querySelectorAll('[data-palette-slot]').forEach(select=>select.addEventListener('change',()=>{
    const destination=Number(select.value);
    const option=swapPaletteSlots(state.recommendation,Number(select.dataset.paletteSlot),destination);
    state.recommendationOptions[state.recommendationIndex]=option;
    state.recommendation=option;
    // The selected suggestion is a fresh arrangement to review and apply.
    setReelView('recommended');
    state.overrides={}; state.ticked=new Set(); state.recipeKey='';
    showReelView('recommended');
    host.querySelector(`[data-palette-slot="${destination}"]`)?.focus({preventScroll:true});
  }));
}
function paletteCoverage(option) {
  const {counts,rows,blendCount}=option.outcome;
  const missing=[...new Set(rows.filter(row=>row.kind==='unresolved').map(row=>row.original))];
  const recipes=rows.filter(row=>row.kind==='blended');
  const detail=missing.length
    ? `<strong>Cannot reproduce all colours</strong><span>No suitable blend for: ${missing.map(color=>`${esc(colourName(color))} (${esc(color)})`).join(', ')}.</span>`
    : counts.substituted ? `<strong>${counts.substituted} source colour(s) replaced</strong><span>Solid colours selected; no extra shades are created.</span>`
    : option.approximate ? '<strong>Approximation · colours will change</strong>' : `<strong>All source colours closely covered in the estimate</strong>`;
  return `<span class="palettecoverage">${detail}<span>${counts.preserved} matched to reels · ${blendCount} blend recipe${blendCount===1?'':'s'}</span>${recipes.map(colourChange).join('')}</span>`;
}
function renderRecommendation(message) {
  renderWorkflow();
  renderPaletteSlots();
  $("recommendstatus").dataset.busy=String(Boolean(recommendationWorker));
  const result=state.recommendation;
  const focusedPalette=document.activeElement?.dataset?.palette;
  const choices=state.recommendationOptions.map((option,index)=>({option,index}))
    .filter(({option,index})=>state.showMorePalettes || index<3 || option.usesLoaded || (option.approximate && state.recommendationOptions.findIndex(p=>p.approximate)===index) || (state.reelView==='recommended' && index===state.recommendationIndex));
  $("palettechoices").innerHTML=choices.map(({option,index})=>
    `<button type="button" class="palettechoice${option.approximate?' approximate':''}" data-palette="${index}" aria-pressed="${state.reelView==='recommended' && state.recommendationIndex===index && state.previewMode==='result'}">
      <span class="palettetitle"><strong>${paletteTitle(option,index)}</strong><small>${esc(option.type)}${state.reelView==='recommended' && state.recommendationIndex===index?' · Selected':''}</small></span>
      <span class="palettechips">${option.reels.map((r,i)=>`<span class="palettechip"><i style="background:${esc(r.color)}"></i>${i+1} · ${esc(r.name || colourName(r.color))}</span>`).join('')}</span>
      ${paletteCoverage(option)}
    </button>`).join('');
  $("palettechoices").querySelectorAll('[data-palette]').forEach(button=>button.addEventListener('click',()=>{
    state.recommendationIndex=Number(button.dataset.palette);
    const option=state.recommendationOptions[state.recommendationIndex];
    state.recommendation={...state.recommendation,...option};
    if(state.reelView==='recommended') { state.overrides={}; state.ticked=new Set(); state.recipeKey=''; }
    showReelView('recommended');
  }));
  if(focusedPalette!==undefined) $("palettechoices").querySelector(`[data-palette="${Number(focusedPalette)}"]`)?.focus({preventScroll:true});
  $("morepalettes").hidden=!state.showMorePalettes && choices.length===state.recommendationOptions.length;
  $("morepalettes").textContent=state.showMorePalettes ? 'Fewer palettes' : 'More palettes';
  $("morepalettes").setAttribute('aria-expanded',String(state.showMorePalettes));
  if(message) $("recommendstatus").textContent=message;
  else if(state.recommendationSearch?.found===false && result) $("recommendstatus").textContent=(state.workflow==='model' ? 'Load one of these sets of original colours and blend the remainder. ' : 'These recipes use only your four loaded filaments. ') + 'No close reproduction found: compare the original and predicted shades before accepting changes.';
  else if(state.recommendationSearch?.found===false) $("recommendstatus").textContent=state.recommendationSearch.reason
    + ' This is a search result, not proof that no palette could work.';
  else if(result) $("recommendstatus").textContent=state.workflow==='model'
    ? `${result.rough ? 'Original model colours to load.' : 'Closest options from your Spool Studio collection.'} Keep as many originals as possible and blend the rest. Ranking uses colour error and approximate prominence from painted-facet counts.`
    : 'Using only your four loaded filaments. Matching colours stay exact; remaining regions use the blend recipes below.';
  document.querySelectorAll('[data-reel-view]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.reelView===state.reelView && state.previewMode==='result'));
    const unavailable=button.dataset.reelView==='recommended' ? !result
      : state.workflow==='model' && !state.modelApplied;
    button.disabled=unavailable;
    button.title=button.dataset.reelView==='loaded' && unavailable
      ? 'Apply a suggested palette first to compare its exported result.' : '';
  });
  $("userecommended").disabled=!result;
  $("userecommended").hidden=!result;
  $("applypalettehint").hidden=!result;
  $("userecommended").textContent=state.workflow==='loaded' ? 'Use these blend settings' : result?.approximate ? 'Use this palette and approximate blends' : 'Use this palette';
  $("applypalettehint").textContent='Choose a palette to preview it. Apply when you want to use it in your export. Blend shades are estimates, not guaranteed print colours.';
  document.querySelectorAll('[data-preview]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preview===state.previewMode)));
  $("reelviewnote").textContent=state.strategy==='source' ? "Showing the file's original colours; loaded and recommended reels are not used."
    : state.previewMode==='original' ? 'Original colours from your file.'
    : state.reelView==='recommended' ? `Previewing ${paletteTitle(result,state.recommendationIndex).toLowerCase()}. ${resultPlan().blocked ? 'Resolve the colours below before exporting.' : 'Apply this palette before exporting.'}`
    : state.workflow==='model' ? (state.modelApplied ? 'Previewing the palette selected for export.' : 'Choose a suggested palette to preview.') : 'Previewing loaded filaments.';
}
function requestRecommendation() {
  if(!state.assessed) return;
  const weights={};
  for(const object of state.assessed.objects || []) if(object.selected) for(const colour of object.colours || []) {
    const key=norm(colour.color); weights[key]=(weights[key] || 0)+colour.painted_triangles*Math.max(1,object.instances || 1);
  }
  const sourceColours=Object.values(state.assessed.sourceColors).map(norm);
  state.keepExact=state.keepExact.filter(c=>sourceColours.includes(c));
  const input={mode:state.workflow,sources:state.assessed.sourceColors,
    loaded:state.workflow==='loaded' ? state.reels : [],
    stock:state.workflow==='model' && state.useOwned ? state.stock : null,
    type:state.modelType,keepExact:state.workflow==='model' ? state.keepExact : [],
    weights,blends:state.strategy!=='solid'};
  const key=JSON.stringify({...input,loaded:input.loaded.map(({color,type})=>({color,type}))});
  if(key===recommendationKey) { renderRecommendation(); return; }
  invalidateRecommendation(); recommendationKey=key;
  renderRecommendation(state.workflow==='model' ? 'Comparing sets of original model colours…' : 'Calculating blends from your loaded filaments…');
  const worker=new Worker(new URL('./shared/recommendWorker.js',import.meta.url),{type:'module'});
  recommendationWorker=worker;
  renderRecommendation('Comparing reels and blend recipes…');
  function finish(result,error) {
    if(recommendationWorker!==worker) return;
    worker.terminate(); recommendationWorker=null;
    state.recommendationSearch=result || null;
    state.recommendationOptions=result ? [...(result.found ? [result,...result.alternatives] : []),...(result.approximateOptions || [])] : [];
    state.recommendation=state.recommendationOptions.length ? {...result,...state.recommendationOptions[0]} : null;
    state.recommendationIndex=0;
    renderRecommendation(error);
    if(state.recommendation && !error && state.strategy!=="source") showReelView("recommended");
  }
  worker.onmessage=({data})=>finish(data.result,data.error);
  worker.onerror=()=>finish(null,'Colour suggestions could not be calculated. Change a slot or reconnect your library to try again.');
  worker.postMessage(input);
}
function showReelView(view) {
  if(view==='recommended' && !state.recommendation) return;
  if(view==='loaded' && state.workflow==='model' && !state.modelApplied) return;
  setReelView(view);
  if(state.strategy==='source') {
    state.strategy='blend';
    document.querySelectorAll('[data-strategy]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.strategy==='blend')));
  }
  state.previewMode='result';
  clearReview(); refresh(); renderRecommendation();
}
document.querySelectorAll('[data-reel-view]').forEach(button=>button.addEventListener('click',()=>showReelView(button.dataset.reelView)));
$("morepalettes").addEventListener('click',()=>{
  state.showMorePalettes=!state.showMorePalettes;
  // Collapsing alternatives never changes the selected palette or its overrides.
  renderRecommendation();
});
$("userecommended").addEventListener('click',()=>{
  if(!state.recommendation) return;
  state.modelApplied=state.workflow==='model';
  state.approximate=Boolean(state.recommendation.approximate);
  state.reels=state.recommendation.reels.map(reel=>({...reel}));
  state.appliedSlotOrder=state.recommendation.slotOrder?.slice() || null;
  if(state.strategy==='source') {
    state.strategy='blend';
    document.querySelectorAll('[data-strategy]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.strategy==='blend')));
  }
  state.reelView='loaded'; state.loadedTuning=null; state.overrides={}; state.recipeKey='';
  state.previewMode='result';
  saveReels(); clearReview(); renderReels(); renderWorkflow(); refresh();
});
$("advancedlink").addEventListener('click',()=>{
  $("advanced").open=true;
  $("advanced").querySelector('summary').focus({preventScroll:true});
});

function renderWorkflow() {
  const model=state.workflow==='model';
  document.querySelectorAll('[data-workflow]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.workflow===state.workflow)));
  $("modelchoices").hidden=!model;
  $("loadedcontrols").hidden=model && !state.modelApplied;
  $("reelheading").textContent=model ? 'Palette selected for export' : 'Loaded filaments';
  $("workflowhint").textContent=model
    ? "Which filaments should I load? Start with the model’s original colours, keep as many exact as possible and make the others with blends."
    : "What can I make with these filaments? Keep the four loaded reels fixed and find their closest achievable blends.";
  $("recommendheading").textContent=model ? 'Colours to load + colours to blend' : 'Blends from your loaded filaments';
  document.querySelector('[data-reel-view="loaded"]').textContent=model ? 'Applied' : 'Loaded';
  document.querySelector('[data-reel-view="recommended"]').textContent=model ? 'Suggested' : 'Blend result';
  $("useowned").disabled=state.stock===null;
  $("useowned").checked=state.useOwned;
  $("ownedhint").textContent=state.stock===null ? 'Connect Spool Studio below to limit suggestions to filaments you own.' : `${state.stock.length} available filaments in your connected collection.`;
  const colours=[...new Set(Object.values(state.assessed?.sourceColors || {}).map(norm))];
  const signature=JSON.stringify([colours,state.keepExact]);
  if($("exactcolours").dataset.signature!==signature) {
    $("exactcolours").dataset.signature=signature;
    $("exactcolours").innerHTML=colours.map(c=>`<label class="check"><input type="checkbox" data-exact="${c}" ${state.keepExact.includes(c)?'checked':''}><i class="swatch" style="background:${c}"></i>Keep ${esc(colourName(c))} exact (${c})</label>`).join('');
    $("exactcolours").querySelectorAll('[data-exact]').forEach(box=>box.addEventListener('change',()=>{
      state.keepExact=[...$("exactcolours").querySelectorAll('[data-exact]:checked')].map(b=>b.dataset.exact);
      invalidateRecommendation(); refresh();
    }));
  }
}
function switchWorkflow(mode) {
  if(mode===state.workflow) return;
  state.modeReels[state.workflow]=state.reels.map(r=>({...r}));
  state.workflow=mode;
  state.appliedSlotOrder=null;
  state.reels=state.modeReels[mode].map(r=>({...r}));
  invalidateRecommendation();
  state.approximate=false; state.overrides={}; state.ticked=new Set(); state.recipeKey='';
  state.previewMode='original';
  renderReels(); renderWorkflow(); refresh();
}
document.querySelectorAll('[data-workflow]').forEach(b=>b.addEventListener('click',()=>switchWorkflow(b.dataset.workflow)));
$("modelmaterial").addEventListener('change',()=>{state.modelType=$("modelmaterial").value;invalidateRecommendation();refresh();});
$("useowned").addEventListener('change',()=>{state.useOwned=$("useowned").checked;invalidateRecommendation();refresh();});

// ------------------------------------------------------------------ loading ---

$("drop").addEventListener("click", () => $("file").click());
$("file").addEventListener("click", (event) => event.stopPropagation());
$("replacefile").addEventListener("click", () => $("file").click());
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
    kind: meta.kind, sourceSettings:meta.sourceSettings, filamentProfiles:meta.filamentProfiles || [],
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

const textureImporter=createTextureImport({buttonHost:document.getElementById('destinationcard'),onAccept:file=>load(file)});
async function load(file) {
  if(/\.(glb|zip)$/i.test(file.name)){textureImporter.open(file);return;}
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
    $("modelname").textContent = file.name;
    $("loadedmodel").classList.remove("hidden");
    $("drop").classList.add("hidden");
    window.__loadTiming = { ms: result.ms, triangles: result.assessed.counts.triangles };
  } catch (error) {
    if (epoch !== state.epoch) return;
    state.project = null;
    state.entries = null;
    $("drop").classList.remove("hidden");
    $("loaderror").textContent = `That file could not be read: ${error.message}. Choose another file.`;
    if(/colour group|colours.*at most|per-corner colours/.test(error.message))textureImporter.open(file);
  } finally {
    if (epoch === state.epoch) setLoading(false);
    if (epoch === state.epoch) setBusy("");
  }
}

/** While a file is being read, the page offers a way out instead of a freeze. */
function setLoading(active) {
  state.loading = active;
  $("loadstatus").dataset.busy=String(active);
  const cancel = $("loadcancel");
  if (cancel) cancel.classList.toggle("hidden", !active);
  const exportButton = $("export");
  if (exportButton) exportButton.disabled = active || !state.project;
  if (!active && state.project && state.mix) renderExport();
}

function resetForUpload() {
  state.approximate=false;
  invalidateRecommendation();
  $("loadedmodel").classList.add("hidden");
  $("prepareswaps").disabled = true;
  $("preparestatus").textContent = "";
  cancelPlan();
  // Bumped here too: this runs before any of the early returns below, so an
  // in-flight assessment or preview from the previous file can never apply.
  assessToken += 1;
  previewToken += 1;
  state.project = null;
  $("loaderror").textContent = "";
  ["project", "reelscard", "mixcard", "previewcard", "exportcard"]
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
  $("prepareswaps").disabled = state.target !== "snapmaker";
  ["project", "reelscard", "mixcard", "previewcard", "exportcard"]
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
    + `<span class="hint reelname" id="reelname${index}">${esc(reel.name || colourName(reel.color))}</span>`
    + `<select aria-label="Slot ${index+1} material" data-type="${index}">${["PLA", "PETG", "ABS", "TPU", "ASA", "PA"]
      .map((type) => `<option${type === reel.type ? " selected" : ""}>${type}</option>`)
      .join("")}</select></div>`).join("");
  state.reels.forEach((reel, index) => {
    $(`reel${index}`).addEventListener("input", (event) => {
      state.reels[index].color = event.target.value.toUpperCase();
      delete state.reels[index].name;
      $(`reelname${index}`).textContent=colourName(state.reels[index].color);
      saveReels();
      clearReview();
      refresh();
    });
  });
  $("reels").querySelectorAll("select[data-type]").forEach((select) => {
    select.addEventListener("change", () => {
      state.reels[Number(select.getAttribute("data-type"))].type = select.value;
      delete state.reels[Number(select.dataset.type)].name;
      delete state.reels[Number(select.dataset.type)].profile;
      $(`reelname${select.dataset.type}`).textContent=colourName(state.reels[Number(select.dataset.type)].color);
      saveReels();
      clearReview();
      refresh();
    });
  });
  $("reels").querySelectorAll('[data-lock]').forEach(box=>box.addEventListener('change',()=>{
    state.locked[Number(box.dataset.lock)]=box.checked; refresh();
  }));
  $("reelnote").textContent = state.workflow==="loaded" ? "Set exactly what is loaded, including CMYK if that is your set. We keep these reels fixed and calculate their blends." : "These are the four reels selected for export. Load them in this order before printing.";
  spoolImport.refresh();
}

// -------------------------------------------------------------- assessment ----

let assessToken = 0;

async function refresh() {
  if (!state.project) return;
  if (!state.objects.length) {
    invalidateRecommendation();
    renderRecommendation('Select at least one object to suggest colours.');
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
  invalidateRecommendation();
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
  requestRecommendation();
  const surfaceColours = new Set(assessed.used || []).size;
  const extraColours = Math.max(0, state.project.paletteCount - surfaceColours);
  $("palettenote").textContent = extraColours
    ? `${surfaceColours} colours found on the selected model; ${extraColours} other palette entries are not used on its surface. The sliced-file check can confirm which can be left out of the reel load, including support and purge use.`
    : "";
  state.mix = planBlends(assessed.sourceColors, activeReels(),activeApproximation(),
    state.reelView==='recommended' ? state.recommendation?.slotOrder : state.appliedSlotOrder);
  state.recipes = state.mix.recipes.filter(recipe=>plausibleBlend(
    activeReels()[recipe.a-1].color,activeReels()[recipe.b-1].color,recipe.color));
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
  $("exportlog").replaceChildren();
  const box = $("review");
  if (box) box.checked = false;
  renderExport();
}

function modelPalettePending() {
  return state.workflow==='model' && state.strategy!=='source' && !state.modelApplied
    && !(state.reelView==='recommended' && state.recommendation);
}

/** What the export would write for the selected strategy. */
function resultPlan() {
  const assessed = state.assessed;
  const reels = activeReels();
  const slots = reels.map((reel) => norm(reel.color));
  if (!assessed || !state.mix) {
    return { mapping: {}, recipes: [], kept: [], physical: reels,
             blocked: assessed ? "Analysing the selected colours…" : "tick at least one object" };
  }
  if(modelPalettePending()) return {mapping:{},recipes:[],kept:[],physical:reels,
    blocked:"choose and apply a suggested palette"};
  if (state.strategy === "source") {
    const used = assessed.used;
    if (used.length > 4) {
      return { mapping: {}, recipes: [], kept: [], physical: reels,
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
    return { mapping, recipes: [], kept: [], physical: reels };
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
  const payload = { recipes: kept.map((recipe) => ({ a: recipe.a, b: recipe.b,
                                            percent: recipe.percent, model: recipe.model })),
           mapping, kept, physical: reels };
  payload.outcome=describeColourMapping(assessed.sourceColors,payload,true);
  if(payload.outcome.counts.unresolved) payload.blocked=`${payload.outcome.counts.unresolved} source colour(s) have no suitable enabled blend. Change reels or explicitly choose Solid colours in Advanced`;
  return payload;
}

function renderOutcome(payload=resultPlan()) {
  const host=$("colouroutcome");
  if(!state.assessed || !state.objects.length) { host.replaceChildren(); return; }
  if(modelPalettePending()) {
    host.innerHTML='<strong>Original model colours</strong><p class="hint">No palette has been applied yet. Select a suggestion to preview its blend recipes and colour changes.</p>';
    return;
  }
  const outcome=payload.outcome || describeColourMapping(state.assessed.sourceColors,payload);
  const {counts,rows}=outcome;
  const tally=[`${counts.preserved} matched to reels`,
    `${counts.blended} using blends`,
    ...(counts.substituted ? [`${counts.substituted} substituted`] : []),
    ...(counts.unresolved ? [`${counts.unresolved} unresolved`] : [])].join(' · ');
  const colours=outcome.sourceCount;
  const changed=rows.filter(r=>r.kind!=='preserved');
  host.innerHTML=`<strong>${state.previewMode==='original' ? 'Selected export: ' : ''}${colours} source colours · ${outcome.blendCount ? `${outcome.blendCount} blend recipe${outcome.blendCount===1?'':'s'}` : 'No blends'}</strong>
    <p class="hint">${esc(tally)}</p>
    <ul>${changed.map(row=>`<li>${colourChange(row)}</li>`).join('')}</ul>
    ${activeApproximation() && state.strategy==='blend' ? '<p><strong>Approximate blends selected. Review the changed shades before exporting.</strong></p>' : ''}
    ${counts.unresolved ? '<p class="outcomewarning">Export blocked. Unresolved regions are highlighted pink in Loaded and Suggested views; pink is not an output filament.</p>' : counts.substituted ? '<p class="hint">Solid-colour replacement is selected. The listed source colours will change.</p>' : counts.blended ? '<p class="hint">Blend shades are uncalibrated estimates; they may differ in print.</p>' : ''}`;
}

function renderMix(assessed) {
  const payload = resultPlan();
  renderOutcome(payload);
  const slots = activeReels().map((reel) => norm(reel.color));
  const rows = comparison(assessed.sourceColors, payload.mapping, [...slots,...payload.kept.map(r=>r.color)]);
  const blendMode = state.strategy === "blend";
  $("strategyhint").textContent = state.strategy === "source"
    ? "Keep the model's original filament colours. This choice does not use your loaded reel colours; this page can keep up to four original colours."
    : blendMode
      ? "Approximate the model's colours using the selected set and suggested blends. Matching reel colours stay unchanged; extra colours need an enabled blend. Unresolved colours block export. Shades are uncalibrated estimates."
      : "Use only the selected reel colours, with no blends. Each source colour goes to its closest reel unless you change its mapping below.";
  $("maptable").innerHTML = "<table><thead><tr><th>Source</th><th>In the file</th>"
    + "<th>Export result</th><th>Closest blend</th><th>Difference</th>"
    + "<th>Use</th></tr></thead>"
    + "<tbody>" + rows.map((row) => {
      const mixRow = (state.mix.rows || []).find((item) => item.source === row.source);
      const blend = mixRow && mixRow.mixture
        ? plausibleBlend(slots[mixRow.mixture.a-1],slots[mixRow.mixture.b-1],mixRow.mixture.color)
          ? `${mixRow.mixture.color} (${mixRow.mixture.error})` : 'Rejected: neutral reels cannot make this shade'
        : "none improves";
      const unresolved=payload.outcome?.rows.some(r=>r.source===row.source && r.kind==='unresolved');
      const chosen = state.strategy === "source" ? row.original
        : (payload.mapping[row.source] > 4
          ? (payload.kept[payload.mapping[row.source] - 5] || {}).color || row.result
          : slots[(payload.mapping[row.source] || 1) - 1]);
      const options = ["<option value=\"0\">"
        + (blendMode ? "matching reel / blend" : "nearest") + "</option>"]
        .concat([1, 2, 3, 4].map((slot) =>
          `<option value="${slot}"${Number(state.overrides[row.source]) === slot
            ? " selected" : ""}>slot ${slot} · ${esc(slots[slot - 1])}</option>`))
        .join("");
      return `<tr><td>colour ${row.source}</td>`
        + `<td><span class="swatch" style="background:${esc(row.original)}"></span>`
        + `${esc(row.original)}</td>`
        + `<td><span class="swatch" style="background:${unresolved ? "#FF00FF" : esc(chosen)}"></span>`
        + `${unresolved ? "Unresolved — no suitable enabled blend" : esc(chosen)}</td>`
        + `<td>${esc(blend)}</td>`
        + `<td>${unresolved ? "unresolved" : esc(row.verdict)}${unresolved || row.distance === null ? "" : ` (${row.distance})`}</td>`
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
  $("mixnote").textContent = (state.mix.recipes.length!==state.recipes.length
    ? 'An implausible prediction was rejected: neutral reels cannot create a strongly coloured shade.' : state.mix.advice)
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
    if(state.strategy==='source') setReelView('loaded');
    // A treatment choice should show its result, even after inspecting Original.
    state.previewMode = "result";
    document.querySelectorAll("[data-preview]").forEach((view) =>
      view.setAttribute("aria-pressed", String(view.dataset.preview === "result")));
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
$('spectrumnozzle').addEventListener('change',()=>{
  state.u1Nozzle=$('spectrumnozzle').value; clearReview(); renderExport();
});
$("target").addEventListener("change", () => {
  state.target = $("target").value;
  cancelPlan();
  syncDestination();
  clearReview();
});

// ----------------------------------------------------------------- preview ----

document.querySelectorAll("[data-preview]").forEach((button) => {
  button.addEventListener("click", () => {
    state.previewMode = button.getAttribute("data-preview");
    document.querySelectorAll("[data-preview]").forEach((other) =>
      other.setAttribute("aria-pressed", String(other === button)));
    renderRecommendation();
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
  renderOutcome(payload);
  const table = paletteOf(payload, state.previewMode);
  const mapping = state.previewMode === "result" && state.strategy !== "source"
    ? {...payload.mapping} : null;
  // Unresolved regions are a diagnostic highlight, not a printable substitution.
  if(mapping) for(const row of payload.outcome?.rows || []) if(row.kind==='unresolved') {
    const id=100000+row.source; mapping[row.source]=id; table[id]='#FF00FF';
  }
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
      + "press Original or Loaded to retry";
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
         : resultPlan().outcome?.counts.unresolved ? " Pink regions are unresolved; export is blocked."
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
  const reels=activeReels();
  reels.forEach((reel, index) => { table[index + 1] = norm(reel.color); });
  payload.kept.forEach((recipe, index) => {
    table[5 + index] = recipe.color;
  });
  return table;
}

// ------------------------------------------------------------------ export ----

function renderExport() {
  $('spectrumprofile').classList.toggle('hidden',state.target!=='snapmaker');
  let profileError='';
  try {
    const payload=resultPlan();
    if(state.project && state.target==='snapmaker') {
      const types=(payload.physical || state.reels).map(r=>r.type || 'PLA');
      const profile=buildU1Profile(state.project.sourceSettings,types,state.u1Nozzle,{blends:payload.recipes.length>0});
      $('spectrumprofilenote').textContent=profileDescription(profile);
    }
  } catch(error) { profileError=error.message; $('spectrumprofilenote').textContent=profileError; }
  const payload = resultPlan();
  renderOutcome(payload);
  $('spectrumfilaments').parentElement.classList.toggle('hidden',state.strategy==='source');
  if(state.project && state.strategy!=='source')renderFilamentPicker($('spectrumfilaments'),{types:state.reels.map(r=>r.type),source:state.project.filamentProfiles,
    selected:state.reels.map(r=>r.profile),target:state.target,nozzle:state.u1Nozzle,sourceSettings:state.project.sourceSettings,
    onChange:(index,preset)=>{if(index!==null)state.reels[index].profile=preset;clearReview();renderExport();}});
  const target = state.target;
  const mixtures = payload.recipes.length;
  const negative = state.project && [...state.project.meta.values()].some(meta => state.objects.map(String).includes(String(meta.id)) && (meta.parts || []).some(part => part.subtype === 'negative_part'));
  $('cutoutnote').classList.toggle('hidden', !negative);
  const reviewBox = $("review");
  const blocking = profileError || (negative && target === 'prusa' ? 'negative cutouts require Snapmaker Orca or Bambu Studio output' : '') || (!state.objects.length ? "tick at least one object"
    : state.strategy!=='source' && state.workflow==='model' && !state.modelApplied && state.reelView!=='recommended' ? "choose and apply a model palette"
    : payload.blocked || (state.reelView==='recommended' ? 'apply the selected palette or blend settings' : null));
  const needsReview = state.strategy !== "source" && !blocking;
  reviewBox.parentElement.classList.toggle("hidden", !needsReview);
  reviewBox.checked = state.reviewed;
  $("reviewtext").textContent=activeApproximation() && state.strategy==='blend'
    ? 'I accept the approximate colour changes shown above, including any noticeable or large differences from the original.'
    : 'I have checked the colour mapping and accept the substitutions and predicted blends.';
  $("export").disabled = state.loading || state.exporting || Boolean(blocking)
    || (needsReview && !state.reviewed);
  $("exportnote").textContent = blocking
    ? `Cannot export yet: ${blocking}.`
    : mixtures
    ? (target === "snapmaker"
      ? `Download a Snapmaker Orca project with four physical reels and ${mixtures} blend recipe(s). Check the settings and slice it before printing.`
      : `Download a ${LABELS[target]} project with your model, colours and ${mixtures} blend recipe(s). Choose your printer and check the print settings in the slicer.`)
    : state.strategy === "source"
      ? `Download a ${LABELS[target]} project keeping each source colour in its own slot. Check the settings and slice it before printing.`
      : `Download a ${LABELS[target]} project using the four loaded reels and the colour mapping above. Check the settings and slice it before printing.`;
  if (!blocking && target === "prusa") {
    $("exportnote").textContent += " Open the file as a project in PrusaSlicer with a "
      + "four-extruder profile: the palette lives in the Full Spectrum description, "
      + "and this tool writes no print config that would override your preset.";
  }
}

function exportRevision() {
  const payload = resultPlan();
  return JSON.stringify({epoch: state.epoch, plate: state.plateId,
    objects: state.objects, target: state.target, reels: state.reels, u1Nozzle:state.u1Nozzle,
    physical: payload.physical, mapping: payload.mapping, recipes: payload.recipes,
    strategy: state.strategy, reviewed: state.reviewed, reelView:state.reelView});
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
      title: state.project.title, u1Nozzle:state.u1Nozzle,
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

let planEpoch = 0, planWorker = null, planAction = "export";
const planUrls = [];
function clearPlan() {
  for (const url of planUrls.splice(0)) URL.revokeObjectURL(url);
  $("planout").classList.add("hidden");
  $("plandownloads").replaceChildren();
}
function cancelPlan() {
  planEpoch++;
  if (planWorker) planWorker.terminate();
  planWorker = null;
  $("planbutton").disabled = false;
  $("swapexport").disabled = false;
  $("plancancel").classList.add("hidden");
  clearPlan();
}
function planLink(text, filename, label, mime = "text/plain") {
  const a = linkFor(new Blob([text], {type:mime}), filename, label);
  if (!filename.endsWith(".gcode")) a.classList.add("secondary");
  planUrls.push(a.href);
  return a;
}
async function planChanges(action = planAction) {
  cancelPlan();
  planAction = action;
  const epoch = planEpoch;
  const file = $("gcodefile").files[0];
  if (!file) { $("gcodemember").textContent = "Choose a sliced file first."; return; }
  const member = $("gcodememberlist").value || "";
  $("gcodemember").textContent = action === "export" ? "Checking the U1 slice, remapping tools and verifying pauses…" : "Reading the sliced toolpaths…";
  $("planbutton").disabled = $("swapexport").disabled = true;
  $("plancancel").classList.remove("hidden");
  const worker = planWorker = new Worker(new URL("./shared/swapWorker.js", import.meta.url), {type:"module"});
  const finish = () => {
    worker.terminate();
    if (epoch !== planEpoch) return false;
    planWorker = null;
    $("planbutton").disabled = $("swapexport").disabled = false;
    $("plancancel").classList.add("hidden");
    return true;
  };
  worker.onerror = () => {
    if (finish()) $("gcodemember").textContent = "The background process stopped. Try a smaller sliced file.";
  };
  worker.onmessage = ({data}) => {
    if (!finish()) return;
    if (data.error) { $("gcodemember").textContent = data.error; return; }
    if (data.members) {
      $("gcodememberlist").replaceChildren(...data.members.map((name)=>new Option(name,name)));
      $("gcodepick").classList.remove("hidden");
      $("gcodemember").textContent = "Choose the plate's G-code member, then prepare the file.";
      return;
    }
    const base = file.name.replace(/\.[^.]+$/, "");
    const box = $("planout");
    box.classList.remove("hidden");
    const pre = document.createElement("pre");
    pre.textContent = data.sheet;
    box.replaceChildren(pre);
    $("gcodemember").textContent = data.gcode
      ? `Export checks passed: ${data.evidence.pause_count} pauses and ${data.evidence.reel_changes} reel changes. Download both files below.`
      : data.evidence.summary;
    if (data.evidence.unused_colours?.length) $("gcodemember").textContent +=
      ` ${data.evidence.unused_colours.length} unused palette colours excluded from the reel plan.`;
    const downloads = $("plandownloads");
    if (data.gcode) downloads.appendChild(planLink(data.gcode, `${base}-u1-swaps.gcode`, "Download U1 G-code with pauses"));
    downloads.appendChild(planLink(data.sheet, `${base}-reel-changes.txt`, data.gcode ? "Download reel-change sheet" : "Download planning report"));
    downloads.appendChild(planLink(JSON.stringify(data.evidence,null,2), `${base}-plan-evidence.json`, "Download analysis (.json)", "application/json"));
    window.__plan = {feasible:data.evidence.feasible, pause_count:data.evidence.pause_count,
      reel_changes:data.evidence.reel_changes, exported:Boolean(data.gcode)};
  };
  worker.postMessage({file,member,action});
}
$("gcodefile").addEventListener("change", () => {
  cancelPlan();
  $("gcodepick").classList.add("hidden");
  $("gcodememberlist").replaceChildren();
  $("gcodemember").textContent = $("gcodefile").files[0]?.name || "";
});
$("planbutton").addEventListener("click", () => planChanges("plan"));
$("swapexport").addEventListener("click", () => planChanges("export"));
$("plancancel").addEventListener("click", () => {
  cancelPlan(); $("gcodemember").textContent = "Cancelled. No file was changed.";
});
$("gcodememberlist").addEventListener("change", () => { cancelPlan(); $("gcodemember").textContent = "Plate selected. Prepare the file to continue."; });
$("prepareswaps").addEventListener("click", async () => {
  if (!state.project || !state.objects.length || state.target !== "snapmaker") return;
  const epoch = state.epoch, plate = state.plateId, objects = JSON.stringify(state.objects);
  const button = $("prepareswaps"), status = $("preparestatus");
  button.disabled = true;
  status.textContent = "Preparing the original colours for slicing…";
  try {
    const chosenObjects = state.objects.slice();
    const rendered = await background().thumbnail(plate, chosenObjects, paletteOf(null, "original"), null,
      {size:512,small:128,estimate:state.assessed?.counts?.triangles || 0});
    if (epoch !== state.epoch || plate !== state.plateId || objects !== JSON.stringify(state.objects) || state.target !== "snapmaker") return;
    const built = await background().request("prepare-swaps", {plateId:plate,objects:chosenObjects,
      thumbnails:{main:rendered.main,small:rendered.small}});
    if (epoch !== state.epoch || plate !== state.plateId || objects !== JSON.stringify(state.objects) || state.target !== "snapmaker") return;
    status.textContent = "Open this as a project, then slice and export G-code. Do not print the virtual-tool slice directly.";
    download(new Blob([built.bytes], {type:"application/octet-stream"}),
      (state.project.title || "model").replace(/[^\w.-]+/g,"-") + "-U1-SLICE-ONLY.3mf", status);
  } catch (error) { if (epoch === state.epoch) status.textContent = error.message; }
  finally { if (epoch === state.epoch) button.disabled = state.target !== "snapmaker"; }
});

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

function syncDestination() {
  const u1 = state.target === "snapmaker";
  $("destinationnote").textContent = u1
    ? "Snapmaker U1 has four physical filament slots. Extra source colours need recolouring, supported blends or manual reel changes."
    : "Choose your printer in the destination slicer. This recolouring page currently compares four loaded reels; that is not a limit on your printer. Use the 3MF converter to keep any number of source colours.";
  $("plannercard").classList.toggle("hidden", !u1);
  $("prepareswaps").disabled = !u1 || !state.project;
}
$("target").innerHTML = RECOLOUR_TARGETS.map((id) =>
  `<option value="${id}">${esc(LABELS[id])}</option>`).join("");
$("target").value = state.target;
syncDestination();
