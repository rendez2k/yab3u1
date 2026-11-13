import {mountBundlePanel} from './shared/bundlePanel.js';
import {mountFocusBrush} from './shared/focusBrush.js';
import {focusWeights} from './shared/focusRegions.js';
import {FILAMENT_BUNDLES,MEASURED_TD} from './shared/filamentBundles.js';
import {substituteReel} from './shared/filamentIdentity.js';
import {mountBambuPrinterPicker} from './shared/bambuPrinterPicker.js';
import {resolveBambuLayerHeight} from './shared/bambuProfiles.js';
import {receiveModel} from './shared/modelHandoff.js';
import {mountSequential} from './shared/sequentialPanel.js';
import {mountObjectActions} from './shared/objectActions.js';
// The online page: open a painted 3MF, recolour it onto four reels (with predicted
// blends if you want them), preview it, export a project for Snapmaker, Bambu or
// PrusaSlicer, and plan reel changes from a real slice.
//
// The browser engine has parity tests against the local Python implementation.
// The renderer is shared with the local page.

import { comparison, distance, norm, suggestMapping } from "./shared/colour.js";
import { describeColourMapping, mappingFromPlan, planBlends, setBlendStrength, blendStrength, setBakedColours, bakedColours, plausibleBlend, swapPaletteSlots } from "./shared/mix.js";
import { Preview, mountPlateControls } from "./shared/preview.js";
import { LABELS, RECOLOUR_TARGETS, colourLimit } from "./shared/targets.js";
import {mountBlendEditor} from './shared/blendEditor.js';
import {applyManualRecipes,recipeData,recipeLabel} from './shared/blendRecipes.js';
import { thumbnailSizes } from "./shared/thumbnail.js";
import { RecolourWorker, loadModelWithRecovery } from "./shared/workerClient.js";
import { readZip } from "./zip.js";
import { mountSpoolImport } from "./shared/spoolImport.js";
import { mountPrinter } from "./shared/printerPanel.js";
import { targetLayout, planLayout, fillLayout } from "./shared/layout.js";
import { planningAllowance } from "./shared/printSettings.js";
import { colourName } from "./shared/assignment.js";

import {quantityRows, bindQuantityButtons} from './shared/objectQuantities.js';

const REEL_KEY = "yab3u1-web-reels";
import { renderFilamentPicker } from './shared/filamentPicker.js';
import {createTextureImport} from './shared/textureImport.js';
import { buildU1Profile, profileDescription, resolveLayerHeight } from './shared/u1Profiles.js';
import { colourWeights } from './shared/surfaceWeights.js';
import { mountCalibration } from './shared/calibrationPanel.js';
import { interfacePalette, validateInterfaceExport, interfaceSlot, modelSlots } from './shared/supportInterface.js';
import { interfaceDemoFile } from './shared/supportInterfaceDemo.js';
import { DUAL_WALL_TARGETS, dualWallProblem } from './shared/dualWall.js';
import { packMatch } from './shared/packMatch.js';
import { collectSettings, readSettings, applySettings, describeSettings, SETTINGS_MAX_BYTES } from './shared/settingsFile.js';
import { FINE_BLEND_TARGETS, FINE_BLEND } from './shared/fineBlend.js';
import { INTERWEAVE_TARGETS, INTERWEAVE_MIN_UP, interweaveProblem } from './shared/topInterweave.js';
import { setHueFidelity, hueFidelity } from './shared/mix.js';

const VERSION = "2.7.5";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[c]));

const state = {
  supportInterface:false, savedInterfaceReels:null, interfacePosition:3,
  capacity:4, priority:"colour", paletteSource:"model", importantColours:[], focusMarks:[], compareBundles:null, bundleStock:[], bambuSetup:null, bambuRequired:false, bambuError:"",
  entries: null, project: null, plateId: null, objects: [], reels: [], target: "snapmaker", u1Nozzle: "auto",
  mix: null, mapping: {}, recipes: [], ticked: new Set(),
  previewMode: "original", preview: null, previewGeometry: "", previewFailed: "",
  // What the export does with the file's colours: keep them, substitute them onto
  // the reels (with per-colour overrides), or use the blends that are ticked.
  strategy: "blend", overrides: {}, recipeKey: "", reviewed: false, approximate: false,
  manualBlends:{}, blendHistory:[],
  workflow: "model", modelType: "PLA", keepExact: [], useOwned: false, modelApplied: false, modeReels: {},
  stock: null, locked: [false,false,false,false], recommendation: null, recommendationSearch: null, reelView: "loaded",
  layout: null, layoutError: "", bounds: null, boundsKey: "", appliedSlotOrder: null, loadedTuning: null, recommendationOptions: [], recommendationIndex: 0, showMorePalettes: false,
  // Bumped on every upload so a slow read of the previous file cannot land on top
  // of the new one and re-approve colours the user never reviewed.
  epoch: 0,
};

window.__recolour = state;                    // the QA harness and the console

let printerPanel=null, calibrationPanel=null, printOptimiser=null, bundlePanel=null, bambuPicker=null;
let focusBrush=null,focusGeometry=null;
let blendEditor=null;
function layerChoice() {
  const mode=$('spectrumlayermode').value;
  return ['snapmaker','bambu'].includes(state.target) ? (mode.startsWith('height:') ? {mode:'custom',value:mode.slice(7)} : {mode,value:$('spectrumlayerheight').value}) : null;
}
$('useblendlayer').addEventListener('click',()=>{$('spectrumlayermode').value='height:0.10';clearReview();refresh();});
$('subdividemix').addEventListener('change',()=>{clearReview();invalidateRecommendation();refresh();});
// Blend detail: how many ratios and recipes the planner may use to reach the model's shades.
function describeBlendStrength() {
  const chosen=blendStrength(),room=Math.max(0,colourLimit(state.target)-activeReels().length);
  $('blendstrengthfield').hidden=state.strategy==='solid'||state.strategy==='source';
  $('blendstrengthhint').textContent=`Up to ${Math.min(chosen.recipes,room)} blended colours from ${chosen.ratios.length} ratios. `
    +(chosen.name==='standard'?'Each blend repeats within 4 layers.':`Finer ratios repeat over up to ${chosen.period} layers, so they can show as faint bands: use thin layers, and Subdivide Mix Layer (step 3, Print options) where it is offered.`);
  const three=(state.recipes||[]).filter(r=>r.c).length;
  $('bakedhint').textContent=`Mixes three reels where that comes closer, such as skin tones and browns. Each blend repeats every ${chosen.layers} whole layers at most, one reel per layer, so it turns on the Fine blend profile (0.12 mm layers). At 0.16 mm these printed as plain stripes; at 0.10 mm they blended on steep surfaces. Domes and gentle slopes still show rings of the separate reels.`
    +(three?` In use now: ${three} three-reel blend${three===1?'':'s'}.`:'')+' Estimated colours.';
}
setBlendStrength($('blendstrength').value);
setHueFidelity($('keephue').checked);
// Baked colours: blends of three reels, written as explicit runs of layers.
setBakedColours($('bakedon').checked);
$('bakedon').addEventListener('change',()=>{
  setBakedColours($('bakedon').checked);
  // Three reels alternate by whole layers, so they need thin layers: the Fine blend profile comes with it.
  if($('bakedon').checked&&FINE_BLEND_TARGETS.includes(state.target)&&!$('fineblendon').checked){$('fineblendon').checked=true;applyFineBlendControls();}
  clearReview();invalidateRecommendation();refresh();
});
function bakedIssue(){
  let recipes=[];try{recipes=resultPlan().recipes||[];}catch{return '';}
  return FINE_BLEND_TARGETS.includes(state.target)&&recipes.some(r=>r.c)&&!$('fineblendon').checked
    ?'three-reel blends need thin layers: turn on Fine blend profile under Print options, or turn Baked colours off':'';
}
$('keephue').addEventListener('change',()=>{setHueFidelity($('keephue').checked);clearReview();invalidateRecommendation();refresh();});
$('blendstrength').addEventListener('change',()=>{setBlendStrength($('blendstrength').value);clearReview();invalidateRecommendation();refresh();});
// Top surface interweave: flat tops of blended colours become narrow stripes of the blend's two filaments.
for(const id of ['interweaveon','interweavecell'])$(id).addEventListener('change',()=>{clearReview();refresh();});
function interweaveChoice() {
  if(!INTERWEAVE_TARGETS.includes(state.target)||!$('interweaveon').checked)return null;
  return {cell:Number($('interweavecell').value)};
}
function interweaveIssue() {
  const choice=interweaveChoice();
  return choice?interweaveProblem({target:state.target,cell:choice.cell}).replace(/\.$/,''):'';
}
function renderInterweave(recipes) {
  const blends=recipes.filter(r=>!r.c&&!r.gradient).length,available=INTERWEAVE_TARGETS.includes(state.target)&&Boolean(state.project)&&blends>0;
  $('interweaveoptions').hidden=!available;if(!available)return;
  $('interweavefields').hidden=!$('interweaveon').checked;
  const choice=interweaveChoice();
  $('interweavenote').textContent=!choice?'':interweaveIssue()||`${blends} blended colour${blends===1?'':'s'} will be interwoven on upward faces within about 30° of flat, in stripes ${choice.cell} mm wide. Faces on the bed are left whole. Stripes have not been printed yet, so try it on one small part first. Unvalidated: not yet confirmed by a sliced or printed sample.`;
}
// Dual-wall mixing: painted colour in the outer wall only, one chosen filament behind it.
for(const id of ['dualwallon','dualwallinner','dualwalldepth'])$(id).addEventListener('change',()=>{clearReview();refresh();});
// Fine blend profile: thin layers, five thin walls, and blends written with an offset pattern for the inner walls.
let fineBlendBefore=null;
function fineBlendChoice(){return FINE_BLEND_TARGETS.includes(state.target)&&$('fineblendon').checked;}
function fineBlendIssue(){return fineBlendChoice()&&dualWallChoice()?'use either the fine blend profile or dual-wall mixing, not both':'';}
function applyFineBlendControls(){
  if($('fineblendon').checked){
    fineBlendBefore={layer:$('spectrumlayermode').value,subdivide:$('subdividemix').checked};
    $('spectrumlayermode').value='height:0.12';$('subdividemix').checked=true;
  }else if(fineBlendBefore){$('spectrumlayermode').value=fineBlendBefore.layer;$('subdividemix').checked=fineBlendBefore.subdivide;fineBlendBefore=null;}
}
$('fineblendon').addEventListener('change',()=>{applyFineBlendControls();clearReview();refresh();});
function renderFineBlend(recipes){
  const blends=(recipes||[]).filter(r=>!r.gradient).length,available=FINE_BLEND_TARGETS.includes(state.target)&&Boolean(state.project)&&blends>0;
  $('fineblendoptions').hidden=!available;if(!available)return;
  $('fineblendnote').textContent=$('fineblendon').checked
    ?`On: ${FINE_BLEND.layerHeight.toFixed(2)} mm layers, ${FINE_BLEND.walls} walls ${FINE_BLEND.lineWidth} mm wide, Subdivide Mix Layer on. Two-reel blends are mixed by the slicer within each layer; three-reel blends alternate whole layers. Prints slower. This combination has not been printed yet.`
    :'Makes the stripes in blended colours finer: 0.12 mm layers and five thin walls, with Subdivide Mix Layer kept on for two-reel blends.';
}
function dualWallChoice() {
  if(!DUAL_WALL_TARGETS.includes(state.target)||!$('dualwallon').checked)return null;
  const slot=Number($('dualwallinner').value),depth=Number($('dualwalldepth').value);
  return Number.isInteger(slot)&&slot>0?{slot,depth}:null;
}
function dualWallIssue() {
  const choice=dualWallChoice();if(!choice)return '';
  let physical=[];try{physical=resultPlan().physical||[];}catch{return '';}
  return dualWallProblem({target:state.target,innerSlot:choice.slot,depth:choice.depth,filaments:physical.length}).replace(/\.$/,'');
}
function renderDualWall(physical) {
  const available=DUAL_WALL_TARGETS.includes(state.target)&&Boolean(state.project);
  $('dualwalloptions').hidden=!available;if(!available)return '';
  const select=$('dualwallinner'),previous=select.value,list=JSON.stringify(physical.map(r=>[r.name,r.color]));
  if(select.dataset.list!==list){
    select.dataset.list=list;select.replaceChildren(...physical.map((reel,i)=>new Option(`Slot ${i+1} · ${reel.name||reel.color} · ${reel.color}`,String(i+1))));
    // Keep the choice by position; default to the lightest reel, the usual backing for translucent colours.
    const light=physical.map((r,i)=>[i,parseInt(String(r.color).slice(1,3),16)+parseInt(String(r.color).slice(3,5),16)+parseInt(String(r.color).slice(5,7),16)]).sort((a,b)=>b[1]-a[1])[0];
    select.value=previous&&Number(previous)<=physical.length?previous:String((light?.[0]??0)+1);
  }
  $('dualwallfields').hidden=!$('dualwallon').checked;
  const choice=dualWallChoice();if(!choice){$('dualwallnote').textContent='';return '';}
  const problem=dualWallProblem({target:state.target,innerSlot:choice.slot,depth:choice.depth,filaments:physical.length});
  const inner=physical[choice.slot-1];
  $('dualwallnote').textContent=problem||`Inner walls and infill: slot ${choice.slot}, ${inner?.name||inner?.color}. Colours reach ${choice.depth} mm in from the surface. Unvalidated: not yet confirmed by a sliced or printed sample.`;
  return problem;
}
function subdivideChoice() {
  return ['snapmaker','bambu','orca'].includes(state.target) && $('subdividemix').checked && Boolean(resultPlan().recipes.length);
}
['spectrumlayermode','spectrumlayerheight'].forEach(id=>$(id).addEventListener('input',()=>{clearReview();refresh();}));
let fillPrevious = null;
state.quantities = {};
state.footprints = [];
function layoutSettings() {
  const copies=Number($('spectrumcopies').value), spacing=Number($('spectrumgap').value);
  const width=Number($('spectrumwidth').value), depth=Number($('spectrumdepth').value);
  if(!Number.isInteger(copies)||copies<1||copies>4096||!$('spectrumgap').value.trim()||!Number.isFinite(spacing)||spacing<0)
    throw new Error('Choose 1–4096 whole copies and spacing of zero or more millimetres.');
  if(!Number.isFinite(width)||!Number.isFinite(depth)||width<1||depth<1) throw new Error('Choose a positive layout width and depth.');
  if(Object.values(state.quantities).some(n=>!Number.isInteger(n)||n<0||n>64)) throw new Error('Choose whole object quantities from 0–64.');
  const sources=state.objects.map(id=>({...state.project?.sourceSettings,...state.project.meta.get(String(id))?.settings,...(state.supportInterface?{enable_support:'1'}:{})}));
  return targetLayout(state.target,{copies,spacing,width,depth,tower:$('spectrumtower').checked,
    arrangement:$('spectrumarrangement').value,quantities:{...state.quantities},footprints:state.footprints,
    // Hand-placed positions from the Workbench: "objectId:ordinal" -> footprint centre in bed millimetres.
    ...(state.manual?{manual:state.manual}:{}),
    ...planningAllowance(sources,state.target,state.target==='snapmaker','auto',state.supportsPainted)});
}
function updateCopies() {
  state.layout=null;state.layoutError='';
  let note='One copy keeps the original plate arrangement.';
  const u1=state.target==='snapmaker';
  for(const id of ['spectrumwidth','spectrumdepth']) { $(id).disabled=u1; if(u1) $(id).value=270; }
  const key=`${state.epoch}|${state.plateId}|${state.objects.join(',')}`;
  const measured=state.bounds && state.boundsKey===key && state.measuredKey===key;
  try {
    const options=layoutSettings();
    if(!state.objects.length) throw new Error('Restore at least one object.');
    if(!measured) throw new Error('Checking the selected model’s size…');
    // A model from another plate of a multi-plate project sits at that plate's
    // position in the source file, beside the bed. Bring it onto the plate.
    const centre=options.centre||[0,0],off=options.copies===1&&options.arrangement!=='objects'&&(
      state.bounds.min[0]<centre[0]-options.width/2-1||state.bounds.max[0]>centre[0]+options.width/2+1||
      state.bounds.min[1]<centre[1]-options.depth/2-1||state.bounds.max[1]>centre[1]+options.depth/2+1);
    if(off && !planLayout(state.bounds,options).blocked) {
      state.layout=options;
      note='The model sat beside the plate in the source file, so it has been centred. Parts and orientation are preserved.';
    } else if(options.copies>1 || options.arrangement==='objects') {
      state.layout=options;
      const plan=planLayout(state.bounds,options);
      if(plan.blocked||plan.capped) throw new Error(plan.problem || `Only ${plan.copies} of ${options.copies} complete sets fit. Reduce quantities or spacing, then Fill plate again.`);
      note=`${plan.copies} complete set${plan.copies===1?'':'s'} · ${options.arrangement==='objects'?'separate objects packed':'original set kept together'}. Parts and orientation are preserved.`;
    }
  } catch(error) { state.layoutError=error.message; }
  $('spectrumfill').disabled=!measured||state.loading||state.exporting||!state.objects.length;
  $('copysummary').textContent='Plate layout · '+$('spectrumcopies').value+' set'+($('spectrumcopies').value==='1'?'':'s');
  $('copynote').textContent=state.layoutError || note;
}
function clearFill() { fillPrevious=null; $('spectrumfillalternative').hidden=true; $('spectrumfillundo').hidden=true; $('spectrumfillresult').textContent=''; }
function layoutChanged() { clearFill(); updateCopies(); clearReview(); renderExport(); refreshPreview(); }
['spectrumcopies','spectrumgap','spectrumwidth','spectrumdepth','spectrumtower'].forEach(id=>$(id).addEventListener('input',layoutChanged));
$('spectrumarrangement').addEventListener('change',()=>{
  $('spectrumcopies').value=1;
  if($('spectrumarrangement').value!=='objects') {
    for(const id of state.objects) state.quantities[id]=1;
    renderQuantityFields();
  }
  layoutChanged();
});
function quantityObjects() {
  if(!state.project)return [];
  return eligibleForPlate().map(id=>({objectId:id,
    name:state.project.meta.get(id)?.name || `Object ${id}`,
    colours:state.assessed?.objects.find(o=>o.id===id)?.colours || [],
    undecodable:state.assessed?.objects.find(o=>o.id===id)?.undecodable || 0,
    ...state.footprints.find(f=>f.objectId===id)}));
}
function renderQuantityFields() {
  $('spectrumquantities').innerHTML=quantityRows(quantityObjects(),state.quantities);
}
bindQuantityButtons($('spectrumquantities'), {
  key:()=>`${state.epoch}:${state.plateId}`,
  objects:quantityObjects,read:()=>state.quantities,
  write:quantities=>{
    state.quantities=quantities;
    $('objects').querySelectorAll('[data-object]').forEach(box=>{box.checked=(quantities[box.dataset.object]??1)!==0;});
    state.objects=selectedObjects();
    $('spectrumarrangement').value='objects';
    renderQuantityFields();layoutChanged();refresh();
  },
});
$('spectrumquantities').addEventListener('input',event=>{
  const id=event.target.dataset.object;if(!id)return;
  state.quantities[id]=event.target.value.trim()===''?NaN:Number(event.target.value);
  const box=[...$('objects').querySelectorAll('[data-object]')].find(b=>b.dataset.object===id);
  box.checked=state.quantities[id]!==0;
  const before=state.objects.join(',');state.objects=selectedObjects();
  $('spectrumarrangement').value='objects';
  layoutChanged();
  if(before!==state.objects.join(','))refresh();
});
function fillSpectrum(arrangement) {
  try {
    const options=layoutSettings();
    const result=fillLayout(state.bounds,{...options,...(arrangement?{arrangement}:{})});
    if(!result.copies) { $('spectrumfillresult').textContent=result.plan?.problem || 'No complete set fits. Reduce quantities or spacing, or arrange in the slicer.';return; }
    fillPrevious={copies:$('spectrumcopies').value,arrangement:$('spectrumarrangement').value};
    $('spectrumcopies').value=result.copies;$('spectrumarrangement').value=result.arrangement;
    updateCopies();clearReview();renderExport();refreshPreview();
    $('spectrumfillundo').hidden=false;
    $('spectrumfillalternative').hidden=!result.alternative;
    $('spectrumfillalternative').textContent=`Pack separate objects · ${result.alternative} sets`;
    const perSet=state.footprints.reduce((n,f)=>n+(f.instances||1)*(result.arrangement==='objects'?(state.quantities[f.objectId]??1):1),0);
    $('spectrumfillresult').textContent=`Filled: ${result.copies} complete set${result.copies===1?'':'s'} · ${perSet*result.copies} objects. ${result.arrangement==='objects'?'Separate objects packed.':'Original arrangement kept together.'} Check support reach and tower size after slicing.`;
  } catch(error) { $('spectrumfillresult').textContent=error.message; }
}
$('spectrumfill').addEventListener('click',()=>fillSpectrum());
$('spectrumfillalternative').addEventListener('click',()=>fillSpectrum('objects'));
$('spectrumfillundo').addEventListener('click',()=>{
  if(!fillPrevious)return;
  $('spectrumcopies').value=fillPrevious.copies;$('spectrumarrangement').value=fillPrevious.arrangement;
  layoutChanged();$('spectrumfillresult').textContent='Restored the arrangement from before Fill plate.';
});
$("applyforexport").addEventListener('click',()=>$("userecommended").click());
printerPanel=mountPrinter($("printersetup"),()=>state.project && state.target==='snapmaker' && state.reelView==='loaded' && (state.workflow==='loaded'||state.modelApplied) && state.strategy!=='source' ? state.reels : null);

function defaultReels() {
  try {
    const saved = JSON.parse(localStorage.getItem(REEL_KEY) || "null");
    if (Array.isArray(saved) && saved.length >= 1 && saved.length <= 24) return saved;
  } catch (error) { /* fall through to the default */ }
  return [{ color: "#FFFFFF", type: "PLA" }, { color: "#000000", type: "PLA" },
          { color: "#3D9140", type: "PLA" }, { color: "#FF9500", type: "PLA" }];
}

state.modeReels.loaded = defaultReels();
state.modeReels.model = ['#FFFFFF','#000000','#0080C0','#FF0000'].map(color=>({color,type:'PLA'}));
state.reels = state.modeReels.model.map(r=>({...r}));

function saveReels() {
  if(state.workflow!=="loaded" || state.supportInterface) return;
  try { localStorage.setItem(REEL_KEY, JSON.stringify(state.reels)); } catch (e) { /* fine */ }
}

const spoolImport = mountSpoolImport({ host: $("spoolimport"), getReels: () => state.reels, apply: (reels) => {
  if(state.workflow!=="loaded") switchWorkflow("loaded");
  state.reels = reels;
  state.appliedSlotOrder=null;
  saveReels(); clearReview(); renderReels(); refresh();
}, onStock: rows => { state.stock=rows; if(rows===null) state.useOwned=false; renderWorkflow(); invalidateRecommendation(); refresh(); } });

let recommendationWorker=null, recommendationKey='';
// Reel opacity (TD), kept per filament so it follows a reel through packs, suggestions and My reels.
const TD_KEY='yab3d-reel-td';
let reelTd={};try{reelTd=JSON.parse(localStorage.getItem(TD_KEY)||'{}')||{};}catch{reelTd={};}
const tdKey=reel=>String(reel?.productId||norm(reel?.color)||'');
// The user's own value wins; a pack reel with a recorded reading falls back to that.
const tdOf=reel=>Number(reelTd[tdKey(reel)])>0?Number(reelTd[tdKey(reel)]):MEASURED_TD[reel?.productId]||0;
const withTd=reels=>reels.map(reel=>tdOf(reel)>0?{...reel,td:tdOf(reel)}:reel);
let reelTdShown='';
function renderReelTd(){
  const reels=activeReels().filter(r=>r.role!=='support-interface'),shown=JSON.stringify(reels.map(r=>[tdKey(r),r.name,r.color]));
  if(shown===reelTdShown)return;reelTdShown=shown;
  $('reeltd').innerHTML=reels.map((reel,index)=>`<label class="reel-td-row"><i class="swatch" style="background:${esc(reel.color)}" aria-hidden="true"></i><span>${esc(reel.name||colourName(reel.color))}</span><input type="number" data-td="${esc(tdKey(reel))}" min="0.1" max="100" step="0.1" inputmode="decimal" placeholder="${MEASURED_TD[reel.productId]?esc(MEASURED_TD[reel.productId]+' · recorded'):'not set'}" value="${Number(reelTd[tdKey(reel)])>0?esc(String(reelTd[tdKey(reel)])):''}" aria-label="Transmission distance in millimetres for ${esc(reel.name||colourName(reel.color))}"></label>`).join('');
  $('reeltd').querySelectorAll('[data-td]').forEach(input=>input.addEventListener('change',()=>{
    const value=Number(input.value);
    if(input.value.trim()==='')delete reelTd[input.dataset.td];
    else if(!(value>=0.1&&value<=100)){input.setCustomValidity('Enter a transmission distance from 0.1 to 100 mm, or leave it empty.');input.reportValidity();return;}
    else reelTd[input.dataset.td]=Math.round(value*10)/10;
    input.setCustomValidity('');try{localStorage.setItem(TD_KEY,JSON.stringify(reelTd));}catch{}
    clearReview();refresh();
  }));
}
function activeReels() {
  return state.reelView==='recommended' && state.recommendation ? state.recommendation.reels : state.reels;
}
function setInterface(enabled) {
  if(enabled) {
    state.capacity=4;
    state.savedInterfaceReels={...state.modeReels,[state.workflow]:state.reels.map(r=>({...r}))};
    while(state.reels.length<4)state.reels.push({...state.reels[0]});
    state.reels=interfacePalette(state.reels,true);
    state.interfacePosition=interfaceSlot(state.reels)-1;
    state.modelType='PLA'; $('modelmaterial').value='PLA';
    if(state.strategy==='source') state.strategy='blend';
  } else {
    const saved=state.savedInterfaceReels;
    if(saved) {
      state.modeReels=saved;
      state.reels=saved[state.workflow].map(r=>({...r}));
    }
  }
  state.supportInterface=enabled;
  state.modelApplied=false;
  $('reservepetg').checked=enabled;
  state.appliedSlotOrder=null;state.loadedTuning=null;state.overrides={};state.ticked=new Set();state.recipeKey='';
  document.querySelectorAll('[data-strategy]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.strategy===state.strategy)));
  invalidateRecommendation();renderReels();renderWorkflow();refresh();
}
$('reservepetg').addEventListener('change',()=>setInterface($('reservepetg').checked));
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
  state.recommendationSearch=null;
  // Until a model palette is selected, only the actual source is a valid view.
  if(state.workflow==='model'&&!state.modelApplied) state.previewMode='original';
  renderRecommendation('Updating colour suggestions…');
  clearReview();
}
function activeApproximation() {
  return state.reelView==='recommended' ? Boolean(state.recommendation?.approximate) : state.approximate;
}
function paletteTitle(option,index) {
  if(option.bundleName)return option.bundleName;
  return option.approximate ? (option.usesLoaded ? 'Approximation with loaded reels' : 'Approximate blend palette')
    : index ? `Close-match alternative ${index}` : 'Closest reproduction';
}
// One comparison layout for palette choices and the selected export summary.
function colourChange(row) {
  const chip=(hex,label)=>`<span class="change-colour"><span class="change-label">${label}</span><i class="change-swatch" style="background:${esc(hex)}" aria-hidden="true"></i><strong>${esc(colourName(hex))}</strong><small>${esc(hex)}</small></span>`;
  const unresolved=row.kind==='unresolved';
  const change=unresolved ? '' : distance(row.original,row.result);
  return `<span class="colour-change"><span class="change-pair">${chip(row.original,'Original')}<span class="change-arrow" aria-hidden="true">→</span>${unresolved ? '<span class="change-colour"><span class="change-label">Result</span><strong>No suitable enabled blend</strong></span>' : chip(row.result,row.kind==='blended' ? (row.recipe?.measuredColor ? 'Recorded print sample' : 'Predicted blend') : 'New colour')}</span>
    ${row.recipe && !unresolved ? `<span class="change-recipe">${esc(recipeLabel(row.recipe))}${row.recipe.gradient?' · model shows midpoint':''}</span>` : ''}
    ${change>12 ? `<span class="change-difference">${change>25?'Large colour change':'Noticeable colour change'}</span>` : ''}</span>`;
}
function renderPaletteSlots() {
  const host=$("paletteslots"), palette=state.recommendation;
  host.hidden=(state.workflow!=='model' && !state.supportInterface && !state.compareBundles) || !palette;
  $("slotoptions").hidden=host.hidden;
  if(host.hidden) { host.replaceChildren(); return; }
  host.innerHTML=`<p class="hint">Match the slots on your printer. Choosing an occupied slot swaps the two colours; blend recipes follow automatically.</p>
    <div class="slot-arrangement">${palette.reels.map((reel,index)=>`<label class="slot-row"><i class="swatch" style="background:${esc(reel.color)}" aria-hidden="true"></i><span><strong>${esc(reel.name || colourName(reel.color))}</strong><small>${esc(reel.color)}</small></span><select data-palette-slot="${index}" aria-label="Slot for ${esc(reel.name || colourName(reel.color))} (${esc(reel.color)}), currently slot ${index+1}">${palette.reels.map((r,slot)=>({r,slot})).map(({slot})=>`<option value="${slot}"${index===slot?' selected':''}>Slot ${slot+1}</option>`).join('')}</select></label>`).join('')}</div>`;
  host.querySelectorAll('[data-palette-slot]').forEach(select=>select.addEventListener('change',()=>{
    const destination=Number(select.value);
    const option=swapPaletteSlots(state.recommendation,Number(select.dataset.paletteSlot),destination);
    state.recommendationOptions[state.recommendationIndex]=option;
    state.recommendation=option;
    if(state.supportInterface) {
      state.interfacePosition=interfaceSlot(option.reels)-1;
      // All alternatives keep the chosen interface position when changing palette.
      state.recommendationOptions=state.recommendationOptions.map(p=>
        swapPaletteSlots(p,interfaceSlot(p.reels)-1,state.interfacePosition));
    }
    // The selected suggestion is a fresh arrangement to review and apply.
    setReelView('recommended');
    state.overrides={}; state.ticked=new Set(); state.recipeKey='';
    showReelView('recommended');
    host.querySelector(`[data-palette-slot="${destination}"]`)?.focus({preventScroll:true});
  }));
}
function paletteCoverage(option,expanded=true) {
  const {counts,rows,blendCount}=option.outcome;
  const missing=[...new Set(rows.filter(row=>row.kind==='unresolved').map(row=>row.original))];
  const changed=expanded?rows.filter(row=>row.kind!=='preserved').sort((a,b)=>Number(state.importantColours.includes(norm(b.original)))-Number(state.importantColours.includes(norm(a.original)))||distance(b.original,b.result)-distance(a.original,a.result)):[];
  const chip=hex=>`<span class="palette-change-colour"><i style="background:${esc(hex)}" aria-hidden="true"></i><span>${esc(colourName(hex))}</span></span>`;
  const detail=missing.length
    ? `<strong>Cannot reproduce all colours</strong><span>No suitable blend for: ${missing.map(color=>`${esc(colourName(color))} (${esc(color)})`).join(', ')}.</span>`
    : counts.substituted ? `<strong>${counts.substituted} source colour(s) replaced</strong><span>Solid colours selected; no extra shades are created.</span>`
    : option.approximate ? '<strong>Approximation · colours will change</strong>' : `<strong>All source colours closely covered in the estimate</strong>`;
  return `<span class="palettecoverage">${detail}<span>${counts.preserved} unchanged · ${blendCount} blend recipe${blendCount===1?'':'s'}</span>${option.omittedReels?.length?`<span>Left out: ${option.omittedReels.map(r=>esc(r.name)).join(', ')}</span>`:''}${changed.length ? `<span class="palette-change-head"><span>Original</span><span aria-hidden="true"></span><span>Suggested result</span></span>${changed.slice(0,3).map(row=>`<span class="palette-change" title="${esc(row.original)}${row.kind==='unresolved'?'':` → ${esc(row.result)}`}">${chip(row.original)}<span aria-hidden="true">→</span>${row.kind==='unresolved'?'<span>No blend found</span>':chip(row.result)}</span>`).join('')}<span class="hint">${changed.length>3?`${changed.length-3} more colour changes. `:''}Select to inspect all colour changes.</span>` : ''}</span>`;
}
function renderRecommendation(message) {
  renderWorkflow();
  renderPaletteSlots();
  $("recommendstatus").dataset.busy=String(Boolean(recommendationWorker));
  $('cancelrecommendation').hidden=!recommendationWorker;
  const result=state.recommendation;
  const focusedPalette=document.activeElement?.dataset?.palette;
  const choices=state.recommendationOptions.map((option,index)=>({option,index}))
    .filter(({option,index})=>state.showMorePalettes || index<3 || option.usesLoaded || (option.approximate && state.recommendationOptions.findIndex(p=>p.approximate)===index) || (state.reelView==='recommended' && index===state.recommendationIndex));
  $("palettechoices").innerHTML=choices.map(({option,index})=>
    `<button type="button" class="palettechoice${option.approximate?' approximate':''}" data-palette="${index}" aria-pressed="${state.reelView==='recommended' && state.recommendationIndex===index && state.previewMode==='result'}">
      <span class="palettetitle"><strong>${esc(paletteTitle(option,index))}</strong><small>${esc(option.type)}${state.reelView==='recommended' && state.recommendationIndex===index?' · Selected':''}</small></span>
      <span class="palettechips">${option.reels.map((r,i)=>`<span class="palettechip"><i style="background:${esc(r.color)}"></i>${i+1} · ${esc(r.name || colourName(r.color))}</span>`).join('')}</span>
      ${paletteCoverage(option,state.recommendationIndex===index)}
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
  else if(state.compareBundles && result) $("recommendstatus").textContent=`${state.recommendationOptions.length} palette results ready. Each result uses the products shown on its card. These unmeasured estimates do not compare the brands' real optical performance. Apply a result to change your reels.`;
  else if(state.recommendationSearch?.found===false && result) $("recommendstatus").textContent=(state.workflow==='model' ? 'Load one of these sets of original colours and blend the remainder. ' : `These recipes use only your ${state.supportInterface?'three PLA':state.reels.length+' loaded'} filaments. `) + 'No close reproduction found: compare the original and predicted shades before accepting changes.';
  else if(state.recommendationSearch?.found===false) $("recommendstatus").textContent=state.recommendationSearch.reason
    + ' This is a search result, not proof that no palette could work.';
  else if(result) $("recommendstatus").textContent=state.workflow==='model'
    ? `${result.rough ? 'Original model colours to load.' : 'Closest options from your Spool Studio collection.'} Keep as many originals as possible and blend the rest. Ranking uses original surface area and colour error, with a penalty for the worst colour change. Keep exact protects essential accents.`
    : `Using only your ${state.supportInterface?'three PLA':state.reels.length+' loaded'} filaments. Matching colours stay exact; remaining regions use the blend recipes below.`;
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
  $("userecommended").textContent=state.compareBundles ? 'Use this filament set and blends' : state.workflow==='loaded' ? 'Use these blend settings' : result?.approximate ? 'Use this palette and approximate blends' : 'Use this palette';
  $("applypalettehint").textContent='Choose a palette to preview it. Apply when you want to use it in your export. Blend shades are estimates, not guaranteed print colours.';
  document.querySelectorAll('[data-preview]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preview===state.previewMode)));
  $("reelviewnote").textContent=state.strategy==='source' ? "Showing the file's original colours; loaded and recommended reels are not used."
    : state.previewMode==='original' ? 'Original colours from your file.'
    : state.reelView==='recommended' ? `Previewing ${paletteTitle(result,state.recommendationIndex).toLowerCase()}. ${resultPlan().blocked ? 'Resolve the colours below before exporting.' : 'Apply this palette before exporting.'}`
    : state.workflow==='model' ? (state.modelApplied ? 'Previewing the palette selected for export.' : 'Choose a suggested palette to preview.') : 'Previewing loaded filaments.';
}
function requestRecommendation() {
  if(!state.assessed) return;
  if(state.paletteSource==='bundle'&&!state.compareBundles){renderRecommendation('Choose a pack, then preview its reels or compare smaller options.');return;}
  const weights=colourWeights(state.assessed.sourceColors,state.assessed.surfaceAreas);
  const sourceColours=Object.values(state.assessed.sourceColors).map(norm);
  state.keepExact=state.keepExact.filter(c=>sourceColours.includes(c));
  state.importantColours=state.importantColours.filter(c=>sourceColours.includes(c));
  const compareModel=state.workflow==='model'||Boolean(state.compareBundles);
  const input={mode:compareModel?'model':'loaded',sources:state.assessed.sourceColors,
    loaded:!compareModel ? state.reels : state.supportInterface
      ? Array.from({length:4},(_,i)=>i===state.interfacePosition ? state.reels[interfaceSlot(state.reels)-1] : {}) : [],
    supportInterface:state.supportInterface,capacity:state.capacity,visibleLimit:colourLimit(state.target),priority:state.priority,bundles:state.compareBundles,
    stock:state.workflow==='model' && state.useOwned ? [...(state.stock||[]),...state.bundleStock] : null,
    type:state.modelType,keepExact:state.workflow==='model'&&!state.compareBundles ? state.keepExact : [],
    weights,importantColours:state.importantColours,focusWeights:focusWeights(state.focusMarks,focusGeometry?.ranges),blends:state.strategy!=='solid',blendStrength:blendStrength().name,keepHue:hueFidelity(),bakedColours:bakedColours(),calibration:calibrationPanel?.active() || null};
  // Model colours and slot arrangement do not alter the palette search. Applying
  // or moving a suggestion must not discard the palette the user just chose.
  const keyReels=compareModel && state.supportInterface
    ? input.loaded.filter(r=>r.role==='support-interface') : input.loaded;
  const key=JSON.stringify({...input,loaded:keyReels});
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
  worker.onmessage=({data})=>{if(data.progress){if(recommendationWorker===worker)renderRecommendation(`Compared ${data.progress.evaluated} palettes…`);return;}finish(data.result,data.error);};
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
  $('supportinterface').hidden=state.target!=='snapmaker';
  $('interfacesettings').hidden=!state.supportInterface;
  $('modelmaterial').disabled=state.supportInterface;
  document.querySelector('[data-strategy="source"]').disabled=state.supportInterface;
  const reserved=interfaceSlot(activeReels()), base=modelSlots(activeReels())[0];
  $('interfacehint').textContent=state.supportInterface ? `Slot ${reserved}: PETG support interface only. The other three slots are PLA model colours. Move PETG under Arrange printer slots; colour suggestions never use it. Supports appear after slicing.` : 'Reserve one slot for PETG; use the other three for model colours and blends.';
  $('interfacesettings').querySelector('p').textContent=`PLA support structure from slot ${base}, PETG contact layers from slot ${reserved}. Three dense interface layers, 0 mm top/bottom Z gap. Supports are enabled; source support style and painted areas are retained. The prime-tower shell uses PLA slot ${base}. These are starting settings: check the sliced interfaces and try a small print first.`;
  $('exacthint').textContent=`Keep essential colours exact (up to ${state.supportInterface?3:state.capacity}). Extra colours need blends.${state.supportInterface?' PETG is never a model colour.':''} Surface percentages measure the original mesh.`;
  const model=state.workflow==='model';
  document.querySelectorAll('[data-workflow]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.workflow===state.workflow)));
  $("modelchoices").hidden=!model||state.paletteSource==='bundle';
  $("modelchoicessummary").textContent=`Colour preferences · ${state.modelType}${state.keepExact.length ? ` · ${state.keepExact.length} kept exact` : ""}${state.useOwned ? " · owned filaments" : ""}`;
  $("loadedcontrols").hidden=state.paletteSource!=='loaded';
  $("reelheading").textContent='Your filament colours';
  $("workflowhint").textContent=state.paletteSource==='bundle'?'Preview a named pack or a smaller subset, then apply the result you prefer.':model
    ? "Which filaments should I load? Start with the model’s original colours, keep as many exact as possible and make the others with blends."
    : `What can I make with these filaments? Keep the ${state.supportInterface?'three PLA':state.reels.length+' loaded'} reels fixed and find their closest achievable blends.`;
  $("recommendheading").textContent=state.compareBundles ? 'Compare filament sets' : model ? 'Colours to load + colours to blend' : 'Blends from your loaded filaments';
  document.querySelector('[data-reel-view="loaded"]').textContent=model || state.paletteSource==='bundle' ? 'Applied' : 'Loaded';
  document.querySelector('[data-reel-view="recommended"]').textContent=model || state.paletteSource==='bundle' ? 'Suggested' : 'Blend result';
  $("useowned").disabled=state.stock===null && !state.bundleStock.length;
  $("useowned").checked=state.useOwned;
  $("ownedhint").textContent=state.stock===null && !state.bundleStock.length ? 'Mark a filament set as owned or connect Spool Studio below.' : `${(state.stock?.length||0)+state.bundleStock.length} available products in your collection.`;
  const colours=[...new Set(Object.values(state.assessed?.sourceColors || {}).map(norm))];
  const areas=colourWeights(state.assessed?.sourceColors || {},state.assessed?.surfaceAreas);
  const totalArea=Object.values(areas).reduce((a,b)=>a+b,0);
  state.importantColours=state.importantColours.filter(c=>colours.includes(c));
  $('prioritysummary').textContent=`Important details & colours${state.focusMarks.length?' · details marked':state.importantColours.length?' · '+state.importantColours.length+' prioritised':''}`;
  const prioritySignature=JSON.stringify([colours,state.importantColours]);
  if($('importantcolours').dataset.signature!==prioritySignature){
    $('importantcolours').dataset.signature=prioritySignature;
    $('importantcolours').innerHTML=colours.map(c=>`<label class="check"><input type="checkbox" data-important="${c}" ${state.importantColours.includes(c)?'checked':''}><i class="swatch" style="background:${c}" aria-hidden="true"></i>${esc(colourName(c))} · ${esc(c)}</label>`).join('');
    $('importantcolours').querySelectorAll('[data-important]').forEach(box=>box.onchange=()=>{const colour=box.dataset.important;state.importantColours=[...$('importantcolours').querySelectorAll('[data-important]:checked')].map(n=>n.dataset.important);invalidateRecommendation();refresh();$('importantcolours').querySelector(`[data-important="${colour}"]`)?.focus({preventScroll:true});});
  }
  const signature=JSON.stringify([colours,state.keepExact,areas,state.supportInterface]);
  if($("exactcolours").dataset.signature!==signature) {
    $("exactcolours").dataset.signature=signature;
    $("exactcolours").innerHTML=colours.map(c=>`<label class="check"><input type="checkbox" data-exact="${c}" ${state.keepExact.includes(c)?'checked':''}><i class="swatch" style="background:${c}"></i>Keep ${esc(colourName(c))} exact (${c})${totalArea ? ` · ${(100*(areas[c]||0)/totalArea).toFixed(1)}% surface` : ''}</label>`).join('');
    $("exactcolours").querySelectorAll('[data-exact]').forEach(box=>box.addEventListener('change',()=>{
      state.keepExact=[...$("exactcolours").querySelectorAll('[data-exact]:checked')].map(b=>b.dataset.exact);
      invalidateRecommendation(); refresh();
    }));
  }
}
function switchWorkflow(mode) {
  state.paletteSource=mode;
  if(mode===state.workflow) return;
  state.modeReels[state.workflow]=state.reels.map(r=>({...r}));
  state.workflow=mode;
  state.compareBundles=null;
  state.appliedSlotOrder=null;
  state.reels=state.modeReels[mode].map(r=>({...r}));
  state.modelApplied=false;
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
let retainedModel = null;
$('loadretry').addEventListener('click',async()=>{
  if (!retainedModel || state.loading) return;
  const epoch = state.epoch + 1;
  const note = document.querySelector('[data-model-handoff]');
  if (note) note.textContent = 'Retrying the original model already received in this tab…';
  await load(retainedModel.file, retainedModel.context);
  if (note && epoch === state.epoch) note.textContent = state.project
    ? 'Original model opened. Review its colours and settings before exporting.'
    : 'The original model is retained in this tab. See the reader status below.';
});

function background() {
  if (!worker) worker = new RecolourWorker();
  return worker;
}

/** A new file gets a brand-new worker, so no old load can land on the new one. */
function restartWorker(fresh = false) {
  if (worker) worker.dispose();
  const url = new URL('./shared/recolour-worker.js', import.meta.url);
  if (fresh) url.searchParams.set('retry', String(Date.now()));
  worker = new RecolourWorker(url);
  return worker;
}

/** Rebuild the light structures the page renders from, out of worker metadata. */
function applyMeta(meta, assessed) {
  state.project = {
    kind: meta.kind, sourceSettings:meta.sourceSettings, filamentProfiles:meta.filamentProfiles || [],colourPlan:meta.colourPlan,
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

const textureImporter=createTextureImport({buttonHost:document.getElementById('printeroptions'),onAccept:file=>load(file)});
async function load(file, context={}) {
  if(/\.(glb|zip)$/i.test(file.name)){textureImporter.open(file);return;}
  retainedModel = {file, context};
  $('loadretry').classList.add('hidden');
  if (context.target) {
    state.target = context.target;
    $('target').value = context.target;
    syncDestination();
  }
  if(context.capacity){state.capacity=Math.min(context.capacity,state.target==='bambu'?24:state.target==='snapmaker'?4:16);state.capacityChosen=true;}
  if(context.bambuSetup)state.bambuSetup=context.bambuSetup;
  if(context.supportInterface && state.target==='snapmaker') {
    if(!state.supportInterface)setInterface(true);
    const wanted=context.interfaceSlot-1, current=interfaceSlot(state.reels)-1;
    [state.reels[current],state.reels[wanted]]=[state.reels[wanted],state.reels[current]];
    state.reels[wanted]={...state.reels[wanted],color:context.interfaceColor};
    state.interfacePosition=wanted;
  }
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
    state.entries = null;                      // the worker owns the archive now
    const stageText = { zip: "Unpacking the file", parse: "Reading the model",
                        assess: "Measuring the colours",
                        preview: "Preparing the preview" };
    const result = await loadModelWithRecovery({file, restart:restartWorker,
      isCurrent:()=>epoch===state.epoch,
      onRetry:()=>setBusy('The model is here. Restarting its reader and trying once more…'),
      onProgress:(progress) => {
      if (epoch !== state.epoch) return;
      setBusy(`${stageText[progress.stage] || "Working"}… `
              + `${(progress.ms / 1000).toFixed(1)}s`);
      window.__loadProgress = { stage: progress.stage, ms: progress.ms };
    }});
    if (epoch !== state.epoch) return;         // a newer file was chosen meanwhile
    applyMeta(result.meta, result.assessed);
    state.plateId = state.project.plates.find(p=>String(p.id)===context.plateId)?.id
      ?? state.project.plates[0]?.id ?? null;
    state.objects = [];
    show();
    $("modelname").textContent = file.yab3dDisplayName || file.name;
    $("loadedmodel").classList.remove("hidden");
    $("printeroptions").open=false;
    $("drop").classList.add("hidden");
    window.__loadTiming = { ms: result.ms, triangles: result.assessed.counts.triangles };
    if (context.purpose === 'reel-changes') {
      $('advanced').open = true; $('plannercard').open = true;
      $('plannercard').scrollIntoView({block:'start'});
      $('prepareswaps').focus({preventScroll:true});
    }
  } catch (error) {
    if (epoch !== state.epoch) return;
    state.project = null;
    state.entries = null;
    $("drop").classList.remove("hidden");
    const readerStopped = error.code === 'WORKER_STOPPED';
    $('loadretry').classList.toggle('hidden', !readerStopped);
    $("loaderror").textContent = readerStopped
      ? `Your model (${file.name}) was received and is still in this tab. Its background reader could not run after a retry. Retry opening it below; you do not need to transfer it again.`
      : `That file could not be read: ${error.message}. Choose another file.`;
    if(/colour group|colours.*at most|per-corner colours/.test(error.message))textureImporter.open(file);
  } finally {
    if (epoch === state.epoch) setLoading(false);
    if (epoch === state.epoch) setBusy("");
  }
}

/** While a file is being read, the page offers a way out instead of a freeze. */
function setLoading(active) {
  state.loading = active;
  $("actionbar").hidden=active || !state.project;
  $("loadstatus").dataset.busy=String(active);
  const cancel = $("loadcancel");
  if (cancel) cancel.classList.toggle("hidden", !active);
  const exportButton = $("export");
  if (exportButton) exportButton.disabled = active || !state.project;
  if (!active && state.project && state.mix) renderExport();
}

function resetForUpload() {
  focusBrush?.reset();focusGeometry=null;
  state.modelApplied=false;state.importantColours=[];state.focusMarks=[];
  state.quantities={};state.manual=null;state.footprints=[];state.bounds=null;state.boundsKey='';state.measuredKey='';
  $('spectrumcopies').value=1;$('spectrumarrangement').value='auto';clearFill();
  $('subdividemix').checked=true;
  state.approximate=false;
  invalidateRecommendation();
  $("loadedmodel").classList.add("hidden");
  $("printeroptions").open=true;
  $("prepareswaps").disabled = true;
  $("preparestatus").textContent = "";
  cancelPlan();
  // Bumped here too: this runs before any of the early returns below, so an
  // in-flight assessment or preview from the previous file can never apply.
  assessToken += 1;
  previewToken += 1;
  state.project = null;
  $("actionbar").hidden=true;
  $("loaderror").textContent = "";
  ["project", "reelscard", "mixcard", "previewcard", "exportcard"]
    .forEach((id) => $(id).classList.add("hidden"));
  state.assessed = null;
  state.mix = null;
  state.recipes = [];
  state.ticked = new Set();
  state.recipeKey = "";
  state.manualBlends={};state.blendHistory=[];
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
  for (const id of ['exportlog','actionstatus','previewnote','preparestatus']) $(id).dataset.busy='false';
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
  state.quantities={};state.manual=null;state.footprints=[];state.measuredKey='';$("spectrumcopies").value=1;clearFill();
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
      state.quantities[box.dataset.object]=box.checked?1:0;
      state.objects = selectedObjects();
      clearFill();renderQuantityFields();
      // A different selection is a different mapping: the tick above it no longer
      // approves what would be written.
      clearReview();
      refresh();
    });
  });
  state.objects = selectedObjects();
  renderQuantityFields();
  $("selhint").textContent = `${eligible.length} object(s) on this plate; the `
    + "assessment, preview and export follow the objects chosen under Plate layout.";
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
  bundlePanel?.render();
  $("physicalslotcount").textContent=`${state.reels.length} loaded · ${state.capacity} inputs available`;
  state.reels=interfacePalette(state.reels,state.supportInterface);
  $('addphysicalreel').disabled=state.reels.length>=state.capacity || state.supportInterface;
  const products=[...new Map(FILAMENT_BUNDLES.flatMap(b=>b.reels).map(r=>[r.productId,r])).values()];
  $("reels").innerHTML = state.reels.map((reel, index) =>
    `<div class="field"><label for="reel${index}">Slot ${index + 1}</label>`
    + `<input type="color" id="reel${index}" value="${esc(reel.color)}">`
    + `<input type="text" data-reel-hex="${index}" aria-label="Slot ${index+1} hex colour" value="${esc(reel.color)}" pattern="#?[0-9A-Fa-f]{6}" maxlength="7" spellcheck="false">`
    + `<span class="hint reelname" id="reelname${index}">${esc(reel.name || colourName(reel.color))}</span>`
    + `<details class="reel-details"><summary>Filament details</summary><select data-product="${index}" aria-label="Slot ${index+1} filament product"${reel.role==='support-interface'?' disabled':''}><option value="">Custom reel</option>${products.map((p,i)=>`<option value="${i}"${reel.productId===p.productId?' selected':''}>${esc(p.name)} · ${esc(p.edition)}</option>`).join('')}</select>`
    + `<select aria-label="Slot ${index+1} material" data-type="${index}"${state.supportInterface && reel.role==='support-interface'?' disabled':''}>${["PLA", "PETG", "ABS", "TPU", "ASA", "PA"]
      .map((type) => `<option${type === reel.type ? " selected" : ""}>${type}</option>`)
      .join("")}</select><button type="button" data-remove-reel="${index}"${state.supportInterface||state.reels.length===1?' disabled':''}>Remove input ${index+1}</button></details></div>`).join("");
  $('reels').querySelectorAll('[data-product]').forEach(select=>select.onchange=()=>{const index=Number(select.dataset.product);state.reels[index]=select.value===''?substituteReel(state.reels[index],{}):{...products[Number(select.value)]};applyFilamentSet(state.reels);});
  $('reels').querySelectorAll('[data-remove-reel]').forEach(button=>button.onclick=()=>applyFilamentSet(state.reels.filter((_,i)=>i!==Number(button.dataset.removeReel))));
  state.reels.forEach((reel, index) => {
    const hex=$('reels').querySelector(`[data-reel-hex="${index}"]`);
    const changeColour=value=>{
      const colour=norm(value);if(!colour)return;
      state.reels[index] = substituteReel(state.reels[index],{color:colour});
      state.compareBundles=null;
      delete state.reels[index].name;
      $(`reel${index}`).value=colour;hex.value=colour;hex.setCustomValidity('');
      $('reels').querySelector(`[data-product="${index}"]`).value='';
      $(`reelname${index}`).textContent=colourName(state.reels[index].color);
      saveReels();
      clearReview();
      refresh();
    };
    $(`reel${index}`).addEventListener('input',event=>changeColour(event.target.value));
    hex.addEventListener('change',()=>{if(!/^#?[0-9a-f]{6}$/i.test(hex.value)){hex.setCustomValidity('Enter a six-digit colour, for example #3F8E43.');hex.reportValidity();return;}changeColour(hex.value);});
  });
  $("reels").querySelectorAll("select[data-type]").forEach((select) => {
    select.addEventListener("change", () => {
      state.reels[Number(select.dataset.type)] = substituteReel(state.reels[Number(select.dataset.type)],{type:select.value});
      state.compareBundles=null;
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
  $("reelnote").textContent = state.workflow==="loaded" ? "Click a swatch, enter a hex colour, or choose a named filament. We use your reels to calculate the closest blends." : "These are the physical reels selected for export. Load them in this order before printing.";
  if(state.supportInterface) $('reelnote').textContent=`Slot ${interfaceSlot(state.reels)} is reserved for PETG interfaces; the other slots are PLA model colours. The PETG swatch records your reel colour and does not affect the model.`;
  spoolImport.refresh();
}

// -------------------------------------------------------------- assessment ----

let assessToken = 0;

async function refresh() {
  if (!state.project) return;
  if (!state.objects.length) {
    updateCopies();
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
  if(state.boundsKey!==state.assessedKey) {
    const key=state.assessedKey;state.boundsKey=key;state.bounds=null;
    background().bounds(state.plateId,state.objects).then(result=>{
      if(state.assessedKey!==key)return;
      state.measuredKey=key;state.footprints=result.footprints;state.bounds=result.bounds;state.supportsPainted=result.supportsPainted;renderQuantityFields();updateCopies();renderExport();refreshPreview();
    }).catch(()=>{if(state.assessedKey===key){state.layoutError='Could not measure the selected model.';renderExport();}});
  }
  updateCopies();
  requestRecommendation();
  const surfaceColours = new Set(assessed.used || []).size;
  const extraColours = Math.max(0, state.project.paletteCount - surfaceColours);
  $("palettenote").textContent = extraColours
    ? `${surfaceColours} colours found on the selected model; ${extraColours} other palette entries are not used on its surface. The sliced-file check can confirm which can be left out of the reel load, including support and purge use.`
    : "";
  state.mix = planBlends(assessed.sourceColors, withTd(activeReels()),activeApproximation(),
    state.reelView==='recommended' ? state.recommendation?.slotOrder : state.appliedSlotOrder,calibrationPanel?.active() || null,Math.max(0,Math.min(blendStrength().recipes,colourLimit(state.target)-activeReels().length)));
  state.recipes = state.mix.recipes.filter(recipe=>plausibleBlend(
    activeReels()[recipe.a-1].color,activeReels()[recipe.b-1].color,recipe.color,recipe.c ? activeReels()[recipe.c-1].color : null));
  describeBlendStrength();renderReelTd();
  /* Ticking belongs to one recipe set. A new set starts fully ticked; an empty set
     means the user turned every blend off, and that must stay off. */
  const key = JSON.stringify(state.recipes.map((r) => [r.id, r.a, r.b, r.percent, r.color, r.measuredColor]));
  if (key !== state.recipeKey) {
    state.recipeKey = key;
    state.ticked = new Set(state.recipes.map((recipe) => recipe.id));
    clearReview();
  }
  for (const id of [...state.ticked]) {
    if (!state.recipes.some((recipe) => recipe.id === id)) state.ticked.delete(id);
  }
  renderMix(assessed);
  calibrationPanel?.render();
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
  if(state.supportInterface) {
    try { validateInterfaceExport({target:state.target,reels}); }
    catch(error) {return {mapping:{},recipes:[],kept:[],physical:reels,blocked:error.message};}
  }
  if (!assessed || !state.mix) {
    return { mapping: {}, recipes: [], kept: [], physical: reels,
             blocked: assessed ? "Analysing the selected colours…" : "tick at least one object" };
  }
  if(modelPalettePending()) return {mapping:{},recipes:[],kept:[],physical:reels,
    blocked:"choose and apply a suggested palette"};
  if (state.strategy === "source") {
    const used = assessed.used;
    if (used.length > state.capacity) {
      return { mapping: {}, recipes: [], kept: [], physical: reels,
               blocked: `this selection uses ${used.length} colours, so the file's own `
                 + `colours cannot all fit in ${state.capacity} inputs` };
    }
    const mapping = {};
    used.forEach((source,index) => { mapping[source] = index+1; });
    return {
      mapping, recipes: [], kept: [], source: true,
      physical: used.map((source) => ({
        color: (state.project.colors[source - 1] || "#FFFFFF"),
        type: (state.project.types[source - 1] || "PLA"),
      })),
    };
  }
  if (state.strategy === "solid") {
    const available=modelSlots(reels);
    const mapping = suggestMapping(assessed.sourceColors,available.map(slot=>slots[slot-1]));
    for(const source of Object.keys(mapping)) mapping[source]=available[mapping[source]-1];
    for (const [source, slot] of Object.entries(state.overrides)) {
      if (Number(slot) > 0) mapping[source] = Number(slot);
    }
    return { mapping, recipes: [], kept: [], physical: reels };
  }
  const kept = state.recipes.filter((recipe) => state.ticked.has(recipe.id));
  const ids = new Map(kept.map((recipe, index) => [recipe.id, reels.length + 1 + index]));
  const byRow = new Map((state.mix.rows || []).map((row) => [row.source, row]));
  const suggested = mappingFromPlan(state.mix);
  const mapping = {};
  for (const [source, want] of Object.entries(suggested)) {
    const id = Number(want);
    if (id <= reels.length) { mapping[source] = id; continue; }
    if (ids.has(id)) { mapping[source] = ids.get(id); continue; }
    const row = byRow.get(Number(source));
    mapping[source] = (row && row.solid.slot) || 1;
  }
  for (const [source, slot] of Object.entries(state.overrides)) {
    if (Number(slot) > 0) mapping[source] = Number(slot);
  }
  let payload = { recipes: kept.map(recipeData),
           mapping, kept, physical: reels };
  try{payload=applyManualRecipes(payload,manualRecipes(),reels,state.target,colourLimit(state.target));}
  catch(e){return {...payload,blocked:e.message};}
  payload.outcome=describeColourMapping(assessed.sourceColors,payload,true);
  if(payload.outcome.counts.unresolved) payload.blocked=`${payload.outcome.counts.unresolved} source colour(s) have no suitable enabled blend. Change reels or explicitly choose Solid colours in Advanced`;
  if(payload.recipes.some(r=>r.gradient)&&!$('subdividemix').checked)payload.blocked='Enable Mixed Colour Sublayer in Output for the gradient';
  return payload;
}

function blendContextKey(){return JSON.stringify([state.plateId,activeReels().map(r=>[r.color,r.type,r.name,r.bundleId,r.productId,r.role])]);}
function manualRecipes(){return state.manualBlends[blendContextKey()]||{};}
function blendCanUndo(){return state.blendHistory.at(-1)?.key===blendContextKey();}
function updateBlendView(){clearReview();renderMix(state.assessed);refreshPreview();renderExport();}
function editBlend(source,recipe){
  if(state.loading||state.exporting)throw Error('Wait for the current operation to finish.');
  if(state.strategy!=='blend'||modelPalettePending()||state.reelView==='recommended')throw Error('Apply your filament palette before editing blends.');
  const key=blendContextKey(),before=structuredClone(manualRecipes()),after={...before};
  if(recipe)after[source]=recipeData(recipe);else delete after[source];
  const payload=resultPlan();
  applyManualRecipes(payload,after,activeReels(),state.target,colourLimit(state.target));
  state.blendHistory.push({key,before,subdivide:$('subdividemix').checked});if(state.blendHistory.length>30)state.blendHistory.shift();
  state.manualBlends[key]=after;if(recipe?.gradient)$('subdividemix').checked=true;
  state.previewMode='result';document.querySelectorAll('[data-preview]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preview==='result')));
  updateBlendView();
}
function undoBlend(){if(!blendCanUndo()||state.loading||state.exporting)return false;const last=state.blendHistory.pop();state.manualBlends[last.key]=last.before;$('subdividemix').checked=last.subdivide;updateBlendView();return true;}
export const workbenchBlends={get canUndo(){return blendCanUndo();},undo:undoBlend};

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
  host.innerHTML=`<h3>Original → ${state.reelView==='recommended'?'suggested':'applied'} colours</h3><strong>${colours} source colours · ${outcome.blendCount ? `${outcome.blendCount} blend recipe${outcome.blendCount===1?'':'s'}` : 'No blends'}</strong>
    <p class="hint">${esc(tally)}</p>
    <ul>${changed.map(row=>`<li>${colourChange(row)}</li>`).join('')}</ul>
    ${activeApproximation() && state.strategy==='blend' ? '<p><strong>Approximate blends selected. Review the changed shades before exporting.</strong></p>' : ''}
    ${counts.unresolved ? '<p class="outcomewarning">Export blocked. Unresolved regions are highlighted pink in Loaded and Suggested views; pink is not an output filament.</p>' : counts.substituted ? '<p class="hint">Solid-colour replacement is selected. The listed source colours will change.</p>' : counts.blended ? '<p class="hint">Recorded print samples are labelled; other blends are estimates. Printed results and slicer previews may differ.</p>' : ''}`;
}

function renderMix(assessed) {
  const payload = resultPlan();
  renderOutcome(payload);
  blendEditor?.render();
  const slots = activeReels().map((reel) => norm(reel.color));
  const rows = comparison(assessed.sourceColors, payload.mapping, [...slots,...payload.kept.map(r=>r.color)]);
  const blendMode = state.strategy === "blend";
  $("strategyhint").textContent = state.strategy === "source"
    ? `Keep the model's original filament colours. This choice does not use your loaded reel colours; your current setup allows ${state.capacity} physical colours.`
    : blendMode
      ? "Approximate the model's colours using the selected set and suggested blends. Matching reel colours stay unchanged; extra colours need an enabled blend. Unresolved colours block export. Recorded samples are labelled; other shades are estimates."
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
        : (payload.mapping[row.source] > slots.length
          ? (payload.kept[payload.mapping[row.source] - slots.length - 1] || {}).color || row.result
          : slots[(payload.mapping[row.source] || 1) - 1]);
      const options = ["<option value=\"0\">"
        + (blendMode ? "matching reel / blend" : "nearest") + "</option>"]
        .concat(modelSlots(activeReels()).map((slot) =>
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
      + `${state.ticked.has(recipe.id) ? " checked" : ""}> `
      + (recipe.c ? `${esc(recipeLabel(recipe))} · baked layers` : `reel ${recipe.a} + ${recipe.percent}% of reel ${recipe.b}`)
      + ` · predicted ${esc(recipe.color)}`
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
          + `export writes them after your ${slots.length} physical reels. Unrecorded blends are `
          + "estimates."
        : ` Substituting every source colour onto one of your ${slots.length} reels; use the `
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
  state.u1Nozzle=$('spectrumnozzle').value; clearReview(); refresh();
});
$("target").addEventListener("change", () => {
  state.target = $("target").value;
  clearFill();
  if(state.target!=='snapmaker' && state.supportInterface) setInterface(false);
  updateCopies();
  refreshPreview();
  cancelPlan();
  syncDestination();
  clearReview();
  refresh();
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

function previewWarning(message = '') {
  $('previewwarning').textContent = message;
  $('previewwarning').hidden = !message;
}

async function refreshPreview() {
  const token = (previewToken += 1);
  $('previewnote').dataset.busy='false';
  const canvas = $("preview");
  if (!state.preview) {
    state.preview = new Preview(canvas);
    mountObjectActions(state.preview,$('platecontrols'),()=>({key:`${state.epoch}:${state.plateId}`,
      objects:quantityObjects(),quantities:state.quantities,copies:Number($('spectrumcopies').value),
      arrangement:$('spectrumarrangement').value,busy:state.loading||state.exporting}),patch=>{
        state.quantities={...patch.quantities};$('spectrumcopies').value=patch.copies;$('spectrumarrangement').value=patch.arrangement;
        $('objects').querySelectorAll('[data-object]').forEach(box=>{box.checked=(state.quantities[box.dataset.object]??1)>0;});
        state.objects=selectedObjects();renderQuantityFields();layoutChanged();refresh();
      });
    $("previewreset").addEventListener("click", () => state.preview.reset());
    mountPlateControls(state.preview, $('platecontrols'), () => {
      const panel=$('copyoptions'); if (panel.tagName==='DETAILS') panel.open=true;
      panel.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    }, {fill:()=>fillSpectrum(),fillSource:$('spectrumfill'),fillStatus:$('spectrumfillresult'),fillMessage:()=>$('spectrumfillresult').textContent,objects:()=>{
      $('copyoptions').open=true;$('spectrumobjectoptions').open=true;
      $('spectrumobjectoptions').scrollIntoView({block:'center'});
      $('spectrumobjectoptions').querySelector('summary').focus({preventScroll:true});
    }});
    window.addEventListener("resize", () => state.preview.resize());
  }
  if (!state.preview.ok) {
    $("previewnote").textContent = state.preview.error;
    previewWarning(state.preview.error);
    return;
  }
  if (!state.objects.length || !state.assessed) {
    previewWarning(state.previewFailed ? `Preview unavailable: ${state.previewFailed}` : '');
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
  $('previewnote').dataset.busy='true';
  $('previewnote').textContent='Updating the preview…';
  try {
    soup = await background().preview(state.plateId, state.objects,
                                      state.previewMode, table, mapping,
                                      state.geometryId,
                                      (state.assessed && state.assessed.counts
                                       && state.assessed.counts.triangles) || 0,state.layout);
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
    previewWarning(`Preview unavailable: ${error.message}`);
    window.__preview = { mode: state.previewMode, triangles: 0, error: error.message };
    return;
  } finally {
    if (token === previewToken) $('previewnote').dataset.busy='false';
  }
  const geometry = `${state.plateId}|${state.objects.join(",")}|${JSON.stringify(state.layout)}`;
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
  try { state.preview.setPlate(layoutSettings()); } catch { state.preview.setPlate(null); }
  state.preview.setSoup(positions, soup.colors, { fit });
  state.preview.setPickRanges(soup.pickRanges);
  const previousFocus=JSON.stringify(focusWeights(state.focusMarks,focusGeometry?.ranges));
  focusGeometry={positions,ranges:soup.pickRanges,faces:soup.sourceFaces||focusGeometry?.faces,states:soup.sourceStates||focusGeometry?.states};
  if(focusGeometry.faces&&focusGeometry.states)focusBrush?.sync(state.preview,focusGeometry);
  if(state.focusMarks.length&&previousFocus!==JSON.stringify(focusWeights(state.focusMarks,focusGeometry.ranges))){invalidateRecommendation();requestRecommendation();}
  state.preview.resize();
  previewWarning(soup.layoutWarning || (state.layoutError
    ? 'Layout needs attention. Showing source positions; extra copies are not arranged. Adjust Layout before exporting.' : ''));
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
    table[reels.length + 1 + index] = recipe.color;
  });
  return table;
}

function jumpTo(id, focusId) {
  const target=$(id);
  if(target.tagName==='DETAILS')target.open=true;
  const focus=focusId ? $(focusId) : target;
  if(!focus.matches('button,input,select,textarea,a[href],summary')) focus.tabIndex=-1;
  focus.scrollIntoView({block:focusId?'center':'start'});
  focus.focus({preventScroll:true});
}
document.querySelectorAll('[data-jump]').forEach(button=>button.addEventListener('click',()=>jumpTo(button.dataset.jump)));
new ResizeObserver(()=>document.documentElement.style.setProperty('--action-height',`${$('actionbar').getBoundingClientRect().height}px`)).observe($('actionbar'));
$('mainaction').addEventListener('click',()=>{
  if(state.loading || state.exporting || !state.project)return;
  const action=$('mainaction').dataset.action;
  if(action==='apply') $('userecommended').click();
  else if(action==='download') $('export').click();
  else if(action==='review') jumpTo('exportcard','review');
  else {
    if(state.layoutError) $('copyoptions').open=true;
    jumpTo('exportcard',state.layoutError?'spectrumcopies':'exportnote');
  }
});
function renderActionBar(blocking,needsReview) {
  $('actionbar').hidden=!state.project || state.loading;
  const apply=blocking==='apply the selected palette or blend settings' && state.recommendation;
  const action=apply?'apply':blocking?'settings':needsReview&&!state.reviewed?'review':'download';
  $('mainaction').dataset.action=action;
  $('mainaction').textContent=state.exporting?'Preparing download…':({apply:'Apply palette',settings:'Check export settings',review:'Review & download',download:'Download project'})[action];
  $('mainaction').disabled=Boolean(state.loading || state.exporting);
  $('actionstatus').textContent=state.exporting?'Writing your project…':apply?'Previewing a suggestion':blocking?'Export needs attention':needsReview&&!state.reviewed?'Review the colour changes before downloading':`${$('spectrumcopies').value} ${Number($('spectrumcopies').value)===1?'copy':'copies'} · Ready to download`;
  $('actionstatus').dataset.busy=String(Boolean(state.exporting));
  $('exportlog').dataset.busy=String(Boolean(state.exporting));
}

// ------------------------------------------------------------------ export ----

function renderExport() {
  printOptimiser?.check();
  $('printeroptionssummary').textContent=`Printer settings · ${LABELS[state.target] || state.target}`;
  printerPanel?.refresh();
  bambuPicker?.refresh();
  bundlePanel?.render();
  $("printersetup").hidden=state.target!=="snapmaker";
  $("applyforexport").hidden=state.reelView!=="recommended" || !state.recommendation;
  $('spectrumprofile').classList.toggle('hidden',state.target!=='snapmaker');
  $('layeroptions').hidden=state.target!=='snapmaker' && !state.bambuSetup;
  $('blendlayerhint').hidden=true;
  $('subdivideoptions').hidden=true;
  if(state.target==='orca'){$('layeroptions').hidden=false;$('subdivideoptions').hidden=!resultPlan().recipes.length;}
  $('spectrumlayermode').disabled=state.target==='orca';$('spectrumlayerheight').disabled=state.target==='orca';
  if(state.target==='orca')$('spectrumlayernote').textContent='Choose your printer, nozzle and regular layer height in OrcaSlicer 2.5. This portable project carries the recipes and subdivision setting.';
  $('subdividelayerhint').hidden=!subdivideChoice();
  {
    // The slicer divides each blended layer further, so a thin parent layer leaves sublayers it may not print well.
    const choice=layerChoice(),height=choice?.mode==='custom'?Number(choice.value):choice?.mode==='preserve'?Number(state.project?.sourceSettings?.layer_height):NaN;
    const thin=subdivideChoice()&&Number.isFinite(height)&&height<=0.1+1e-9;
    $('subdividewarning').hidden=!thin;
    $('subdividewarning').textContent=thin?`Subdivide Mix Layer with ${height} mm layers: the slicer will warn that the divided layers may be thinner than the printer supports. Use a taller layer height (0.12 mm or more) with Subdivide on, or turn Subdivide off to print at ${height} mm.`:'';
  }
  try{renderDualWall(resultPlan().physical||[]);}catch{$('dualwalloptions').hidden=true;}
  try{renderFineBlend(resultPlan().recipes||[]);}catch{$('fineblendoptions').hidden=true;}
  try{renderInterweave(resultPlan().recipes||[]);}catch{$('interweaveoptions').hidden=true;}
  $('spectrumcustomlayer').hidden=$('spectrumlayermode').value!=='custom';
  $('layersummary').textContent='Layer height · '+($('spectrumlayermode').value.startsWith('height:') ? $('spectrumlayermode').selectedOptions[0].textContent : ({preserve:'preserve designer settings',preset:'printer preset',custom:`${$('spectrumlayerheight').value || '—'} mm custom`})[$('spectrumlayermode').value]);
  let profileError='';
  try {
    const payload=resultPlan();
    if(state.project && state.target==='bambu' && state.bambuSetup) {
      const height=resolveBambuLayerHeight(state.project.sourceSettings,state.bambuSetup,layerChoice());
      $('spectrumlayernote').textContent=`${height} mm regular layers. Bambu uses the selected printer and nozzle limits. Sublayers do not change this regular height.`;
      $('subdivideoptions').hidden=payload.recipes.length===0;
      $('spectrumlayermode').querySelectorAll('option[value^="height:"]').forEach(option=>{try{resolveBambuLayerHeight({},state.bambuSetup,{mode:'custom',value:option.value.slice(7)});option.disabled=false;}catch{option.disabled=true;}});
    }
    if(state.project && state.target==='snapmaker') {
      const types=(payload.physical || state.reels).map(r=>r.type || 'PLA');
      const profile=buildU1Profile(state.project.sourceSettings,types,state.u1Nozzle,{blends:payload.recipes.length>0,layerHeight:layerChoice()});
      $('spectrumprofilenote').textContent=profileDescription(profile);
      const sources=state.objects.map(id=>state.project.meta.get(String(id))||{});
      $('spectrumlayernote').innerHTML=(sources.length?sources:[{}]).map(meta=>{
        const layer=resolveLayerHeight({...state.project.sourceSettings,...meta.settings},profile.match,layerChoice());
        return `<p>${meta.name?`${esc(meta.name)}: `:''}${esc(layer.text)}</p>`;
      }).join('');
      $('subdivideoptions').hidden=payload.recipes.length===0;
      $('blendlayerhint').hidden=payload.recipes.length===0 || profile.match.nozzle!=='0.4' || subdivideChoice();
      $('useblendlayer').hidden=layerChoice()?.mode==='custom' && Number(layerChoice().value)===0.1;
      $('spectrumlayermode').querySelectorAll('option[value^="height:"]').forEach(option=>{
        const height=Number(option.value.slice(7));option.disabled=height<profile.match.minLayer || height>profile.match.maxLayer;
      });
      $('spectrumlayerheight').min=profile.match.minLayer;$('spectrumlayerheight').max=profile.match.maxLayer;
    }
  } catch(error) { profileError=error.message; $('spectrumprofilenote').textContent=profileError; $('spectrumlayernote').textContent=profileError; $('layeroptions').open=true; }
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
  const blocking = (activeReels().length>state.capacity && state.strategy!=="source" ? `Choose at most ${state.capacity} reels or increase capacity` : "") || (state.target==="bambu" && state.bambuRequired && !state.bambuSetup ? state.bambuError || "Choose a Bambu printer and wait for its profiles" : "") || state.layoutError || profileError || (negative && target === 'prusa' ? 'negative cutouts require Snapmaker Orca or Bambu Studio output' : '') || (!state.objects.length ? "tick at least one object"
    : state.strategy!=='source' && state.workflow==='model' && !state.modelApplied && state.reelView!=='recommended' ? "choose and apply a model palette"
    : payload.blocked || (state.reelView==='recommended' ? 'apply the selected palette or blend settings' : null)) || dualWallIssue() || fineBlendIssue() || bakedIssue() || interweaveIssue() || null;
  const needsReview = state.strategy !== "source" && !blocking;
  renderActionBar(blocking,needsReview);
  reviewBox.parentElement.classList.toggle("hidden", !needsReview);
  reviewBox.checked = state.reviewed;
  $("reviewtext").textContent=activeApproximation() && state.strategy==='blend'
    ? 'I accept the approximate colour changes shown above, including any noticeable or large differences from the original.'
    : 'I have checked the colour mapping and accept the substitutions and predicted blends.';
  $("export").disabled = state.loading || state.exporting || Boolean(blocking)
    || (needsReview && !state.reviewed);
  $("exportnote").textContent = blocking
    ? (blocking==='apply the selected palette or blend settings' ? 'This palette is a preview. Apply it below, then review the colour changes to download.' : `Cannot export yet: ${blocking}.`)
    : mixtures
    ? (target === "snapmaker"
      ? `Download a Snapmaker Orca project with ${payload.physical.length} physical reels and ${mixtures} blend recipe(s). Check the settings and slice it before printing.`
      : `Download a ${LABELS[target]} project with your model, colours and ${mixtures} blend recipe(s). Choose your printer and check the print settings in the slicer.`)
    : state.strategy === "source"
      ? `Download a ${LABELS[target]} project keeping each source colour in its own slot. Check the settings and slice it before printing.`
      : `Download a ${LABELS[target]} project using ${payload.physical.length} physical reels and the colour mapping above. Check the settings and slice it before printing.`;
  if(state.supportInterface && !blocking) $('exportnote').textContent=`Experimental PETG interface: three PLA model reels, ${mixtures} blend recipe(s), and PETG interfaces in slot ${interfaceSlot(payload.physical)}. Supports enabled; three dense contact layers at 0 mm Z gap; PLA prime-tower shell. Check the sliced result and test a small print first.`;
  if(!blocking && subdivideChoice()) $('exportnote').textContent+=' Subdivide Mix Layer is enabled for this export.';
  if(!blocking && interweaveChoice()) $('exportnote').textContent+=' Top surface interweave is on.';
  if(!blocking && fineBlendChoice()) $('exportnote').textContent+=' Fine blend profile is on.';
  if(!blocking && dualWallChoice()) $('exportnote').textContent+=` Dual-wall mixing is on: inner walls use slot ${dualWallChoice().slot}.`;
  if (!blocking && target === "prusa") {
    $("exportnote").textContent += " Open the file as a project in PrusaSlicer with a "
      + `${payload.physical.length}-extruder profile: the palette lives in the Full Spectrum description, `
      + "and this tool writes no print config that would override your preset.";
  }
}

function exportRevision() {
  const payload = resultPlan();
  return JSON.stringify({epoch: state.epoch, plate: state.plateId,
    objects: state.objects, layout:state.layout, layoutError:state.layoutError, target: state.target, reels: state.reels, u1Nozzle:state.u1Nozzle,
    physical: payload.physical, mapping: payload.mapping, recipes: payload.recipes,
    bambuSetup:state.bambuSetup,capacity:state.capacity,strategy: state.strategy, reviewed: state.reviewed, reelView:state.reelView,layerHeight:layerChoice(),supportInterface:state.supportInterface,subdivideMixLayer:subdivideChoice(),dualWall:dualWallChoice(),interweave:interweaveChoice()});
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
  renderExport();
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
                   && state.assessed.counts.triangles) || 0,layout:state.layout });
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
      title: state.project.title, u1Nozzle:state.u1Nozzle, layout:state.layout,
      bambuSetup:state.bambuSetup,preserveSourceSettings:true,calibration:calibrationPanel?.active() || null,
      layerHeight:layerChoice(),supportInterface:state.supportInterface,subdivideMixLayer:subdivideChoice(),dualWall:dualWallChoice(),interweave:interweaveChoice(),fineBlend:fineBlendChoice(),
      thumbnails: { main: rendered.main, small: rendered.small || null },
    });
    if (exportRevision() !== revision) return;
    const bytes = new Uint8Array(built.bytes);
    const blob = new Blob([bytes], { type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" });
    const name = (state.project.title || "model").replace(/[^\w.-]+/g, "-")
      + `-${state.target}${state.supportInterface?'-petg-interface':''}-recoloured.3mf`;
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
  $('gcodemember').dataset.busy='false';
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
  $('gcodemember').dataset.busy='true';
  $("planbutton").disabled = $("swapexport").disabled = true;
  $("plancancel").classList.remove("hidden");
  const worker = planWorker = new Worker(new URL("./shared/swapWorker.js", import.meta.url), {type:"module"});
  const finish = () => {
    worker.terminate();
    if (epoch !== planEpoch) return false;
    planWorker = null;
    $('gcodemember').dataset.busy='false';
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
  status.dataset.busy='true';
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
  finally { if (epoch === state.epoch) { status.dataset.busy='false'; button.disabled = state.target !== "snapmaker"; } }
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
    : `Choose your printer setup and physical inputs. ${state.target==='bambu'?'Up to 24 physical colours; physical plus blended entries must fit the 24-colour export.':'Up to 16 physical plus blended entries.'}`;
  state.capacity=Math.min(state.capacity,u1?4:colourLimit(state.target));
  bundlePanel?.render();
  $("plannercard").classList.toggle("hidden", !u1);
  $("prepareswaps").disabled = !u1 || !state.project;
}
function calibrationSetup(surface='wall') {
  if(!state.project) throw Error('Load a model and select a palette to prepare U1 blend tests.');
  if(!['snapmaker','bambu'].includes(state.target))throw Error('Choose Snapmaker or a native Bambu printer for calibration projects.');
  if(state.target==='bambu' && !state.bambuSetup)throw Error('Choose a Bambu printer and nozzle first.');
  const reels=activeReels();
  const sourceSettings=state.project.sourceSettings || {};
  const profile=state.target==='bambu'?{match:{nozzle:state.bambuSetup.machine.printer_variant}}:buildU1Profile(sourceSettings,reels.map(r=>r.type),state.u1Nozzle,{blends:true,layerHeight:layerChoice()});
  const resolve=settings=>state.target==='bambu'?resolveBambuLayerHeight(settings,state.bambuSetup,layerChoice()):resolveLayerHeight(settings,profile.match,layerChoice()).height;
  const height=resolve(sourceSettings);
  for(const id of state.objects) {
    const settings=state.project.meta.get(String(id))?.settings || {};
    if(resolve({...sourceSettings,...settings})!==height)
      throw Error('This selection has different object layer heights. Choose a common custom layer height before calibrating.');
  }
  const nozzle=profile.match.nozzle;
  // The setting as chosen, not whether blends exist yet: this is asked while the blends are
  // being planned, and readings that only matched once a plan existed were never used to make it.
  const subdivide=['snapmaker','bambu','orca'].includes(state.target)&&$('subdividemix').checked;
  const context=JSON.stringify({target:state.target,printer:state.bambuSetup?.machine.name,surface,subdivideMixLayer:subdivide,nozzle,height,
    sourceSettings:Object.fromEntries(Object.entries(sourceSettings).sort(([a],[b])=>a.localeCompare(b))),
    filamentProfiles:reels.map(r=>JSON.stringify(r.profile || null)).sort()});
  return {reels,sourceSettings,nozzle,height,context,surface,target:state.target,bambuSetup:state.bambuSetup,subdivideMixLayer:subdivide};
}
calibrationPanel=mountCalibration($('blendcalibration'),{getSetup:calibrationSetup,onChange:()=>{
  clearReview();invalidateRecommendation();refresh();
}});
$("target").innerHTML = RECOLOUR_TARGETS.map((id) =>
  `<option value="${id}">${esc(LABELS[id])}</option>`).join("");
$("target").value = state.target;
$('addphysicalreel').onclick=()=>{if(state.reels.length<state.capacity)applyFilamentSet([...state.reels,{color:'#FFFFFF',type:'PLA',name:'Custom white'}]);};
$('cancelrecommendation').onclick=()=>{recommendationWorker?.terminate();recommendationWorker=null;renderRecommendation('Comparison cancelled. Change a colour choice or click Compare filament sets to try again.');};
function applyFilamentSet(reels) {
  state.compareBundles=null;state.paletteSource='loaded';state.workflow='loaded';state.reels=reels.map(r=>({...r}));
  state.modeReels.loaded=state.reels.map(r=>({...r}));state.appliedSlotOrder=null;state.overrides={};state.recipeKey='';
  saveReels();invalidateRecommendation();renderReels();renderWorkflow();refresh();
}
bundlePanel=mountBundlePanel($('bundlepanel'),{
  printComparison:bundleId=>calibrationPanel.openWallComparison(bundleId),
  getState:()=>state,
  // Estimated colour match per pack for the loaded model; null until a model has been read.
  packScores:bundles=>{
    const colours=state.assessed?.sourceColors;if(!state.project||!colours||!Object.keys(colours).length)return null;
    const areas=colourWeights(colours,state.assessed.surfaceAreas),inputs=state.capacity-(state.supportInterface?1:0);
    const sources=[...new Set(Object.values(colours).map(norm))].map(color=>({color,weight:Object.entries(areas).reduce((sum,[c,a])=>norm(c)===color?sum+a:sum,0)}));
    const scored=new Map();
    for(const bundle of bundles){const match=packMatch(sources,withTd(bundle.reels),inputs);if(match)scored.set(bundle.id,match);}
    return scored.size?scored:null;
  },
  chooseSource:source=>{state.compareBundles=null;if(source==='bundle'){state.paletteSource='bundle';invalidateRecommendation();renderWorkflow();refresh();}else{switchWorkflow(source);invalidateRecommendation();renderWorkflow();refresh();}},
  compare:bundles=>{state.paletteSource='bundle';state.compareBundles=bundles;invalidateRecommendation();refresh();},
  changeCapacity:count=>{state.capacity=state.supportInterface?4:count;state.capacityChosen=true;state.compareBundles=null;invalidateRecommendation();renderReels();renderWorkflow();refresh();},
  changePriority:value=>{state.priority=value;invalidateRecommendation();refresh();},
  ownedChanged:rows=>{state.bundleStock=rows;if(state.project){invalidateRecommendation();renderWorkflow();refresh();}},
});
const bambuSession={
  get target(){return state.target;},get bambuSetup(){return state.bambuSetup;},get epoch(){return state.epoch;},
  get state(){return {types:activeReels().map(r=>r.type),negativeVolumes:false};},
  activeColourIds:()=>activeReels().map((_,i)=>i+1),get filamentProfiles(){return activeReels().map(r=>r.profile);},
  setBambuSetup:(setup,required,error='')=>{state.bambuSetup=setup;state.bambuRequired=required;state.bambuError=error;
    if(setup){if(!state.capacityChosen)state.capacity=setup.machine.printer_model==='Bambu Lab H3C'?9:4;$('spectrumwidth').value=setup.bed.width;$('spectrumdepth').value=setup.bed.depth;}
  },
};
bambuPicker=mountBambuPrinterPicker($('spectrumbambu'),bambuSession,()=>{clearReview();if(state.project)renderExport();});
syncDestination();
if(new URLSearchParams(location.search).get('interface')==='petg') {
  setInterface(true);$('interfacedemoload').hidden=false;
}
$('tryinterface').addEventListener('click',async()=>{
  const button=$('tryinterface');button.disabled=true;
  button.textContent='Preparing the sample…';
  try {
    if(!state.supportInterface)setInterface(true);
    await load(new File([await interfaceDemoFile()],'Four-colour support arch.3mf'),{target:'snapmaker'});
  } catch(error) {$('loaderror').textContent=`Could not prepare the sample: ${error.message}`;}
  finally {button.disabled=false;button.textContent='Try the four-colour support arch';}
});

receiveModel({mount: $("drop").parentElement, canReceive:()=>!state.project&&!state.loading, load:async (file, context={})=>{
  await load(file, context);
  return Boolean(state.project);
}});

focusBrush=mountFocusBrush($('focusbrush'),{read:()=>state.focusMarks,write:marks=>{state.focusMarks=marks;renderWorkflow();},compare:()=>{invalidateRecommendation();refresh();},sources:()=>state.assessed?.sourceColors||{}});
blendEditor=mountBlendEditor($('blendeditor'),{read:()=>{
  const payload=resultPlan();return {key:blendContextKey(),sources:state.assessed?.sourceColors||{},reels:activeReels(),target:state.target,
    manual:manualRecipes(),current:Object.fromEntries((payload.outcome?.rows||[]).filter(r=>r.recipe).map(r=>[r.source,r.recipe])),canUndo:blendCanUndo(),busy:state.loading||state.exporting,
    blocked:state.loading||state.exporting?'Wait for the current operation to finish.':state.strategy!=='blend'?'Choose Predicted blends in Advanced to edit recipes.':modelPalettePending()||state.reelView==='recommended'?'Apply your filament palette first, then edit its blends.':''};
},apply:editBlend,undo:undoBlend});
export const workbenchFocus={stop:()=>focusBrush?.stop(),key:event=>focusBrush?.key(event)};
export {state, load, refresh, renderObjects, renderQuantityFields, layoutChanged, textureImporter};
const workbenchSettingKeys=['capacity','capacityChosen','priority','paletteSource','importantColours','focusMarks','compareBundles','bambuSetup','bambuRequired','bambuError','target','u1Nozzle','supportInterface','interfacePosition','reels','strategy','overrides','manualBlends','workflow','modelType','keepExact','useOwned','modelApplied','modeReels','locked','appliedSlotOrder','loadedTuning','reelView'];
export function workbenchCaptureSettings(){return {state:structuredClone(Object.fromEntries(workbenchSettingKeys.filter(k=>state[k]!==undefined).map(k=>[k,state[k]]))),controls:Object.fromEntries(['spectrumlayermode','spectrumlayerheight','subdividemix','dualwallon','dualwalldepth','blendstrength','keephue','bakedon','fineblendon','interweaveon','interweavecell'].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))};}
export function workbenchRestoreSettings(saved){if(!saved||!state.project)return;Object.assign(state,saved.state);state.reviewed=false;for(const [id,value]of Object.entries(saved.controls))if($(id).type==='checkbox')$(id).checked=value;else $(id).value=value;if(saved.controls.blendstrength)setBlendStrength($('blendstrength').value);setHueFidelity($('keephue').checked);setBakedColours($('bakedon').checked);renderReels();renderWorkflow();return refresh();}
export async function workbenchSourceColours(){if(!state.project)return null;return (await background().preview(state.plateId,state.objects,'original',paletteOf(null,'original'),null,state.geometryId,state.assessed?.counts.triangles||0,state.layout)).colors;}
export function workbenchObjects() {
  return {key:`${state.epoch}:${state.plateId}`,objects:quantityObjects(),quantities:state.quantities,
    copies:Number($('spectrumcopies').value),arrangement:$('spectrumarrangement').value,
    bounds:state.bounds,layout:state.project?layoutSettings():null,preview:state.preview,
    busy:state.loading||state.exporting||Boolean(state.project&&!state.bounds),apply:patch=>{
      state.quantities={...patch.quantities};$('spectrumcopies').value=patch.copies;$('spectrumarrangement').value=patch.arrangement;
      for(const [key,id]of Object.entries({spacing:'spectrumgap',width:'spectrumwidth',depth:'spectrumdepth'}))if(patch[key]!==undefined)$(id).value=patch[key];
      if(patch.tower!==undefined)$('spectrumtower').checked=patch.tower;
      if(patch.manual!==undefined)state.manual=patch.manual&&Object.keys(patch.manual).length?{...patch.manual}:null;
      $('objects').querySelectorAll('[data-object]').forEach(box=>{box.checked=(state.quantities[box.dataset.object]??1)>0;});
      state.objects=selectedObjects();renderQuantityFields();layoutChanged();refresh();
    }};
}
// How much of the blended surface is a flat or nearly flat top, where layer-by-layer blends show as bands.
let flatTops={key:'',value:null};
export function workbenchFlatTops(){
  if(!state.project||!focusGeometry?.states||!focusGeometry.positions?.length)return null;
  let plan;try{plan=resultPlan();}catch{return null;}
  const physical=(plan.physical||[]).length,recipes=plan.recipes||[];
  const blended=Object.entries(plan.mapping||{}).filter(([,slot])=>{const r=recipes[Number(slot)-physical-1];return r&&!r.c&&!r.gradient;}).map(([source])=>Number(source)).sort((a,b)=>a-b);
  const key=`${state.geometryId}|${focusGeometry.positions.length}|${blended.join()}`;
  if(key===flatTops.key)return flatTops.value;
  const p=focusGeometry.positions,states=focusGeometry.states,wanted=new Set(blended),count=Math.min(states.length,Math.floor(p.length/9));
  let flat=0,total=0;
  for(let t=0;t<count;t+=1){
    if(!wanted.has(states[t]))continue;
    const i=t*9,ux=p[i+3]-p[i],uy=p[i+4]-p[i+1],uz=p[i+5]-p[i+2],vx=p[i+6]-p[i],vy=p[i+7]-p[i+1],vz=p[i+8]-p[i+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);if(!length)continue;
    total+=length/2;if(nz/length>=INTERWEAVE_MIN_UP)flat+=length/2;
  }
  flatTops={key,value:{blends:blended.length,share:total?flat/total:0}};
  return flatTops.value;
}
// Quick setups: one press sets every option a known combination needs, so a test is not a checklist.
export const workbenchPresets=[
  {id:'standard',name:'Standard',summary:'Two-reel blends, the model\'s own layer height, Subdivide Mix Layer on. The settings of the first good print.',baked:false,fine:false,interweave:false},
  {id:'baked',name:'Test: three-reel blends',summary:'Baked colours with the Fine blend profile: 0.12 mm layers, five thin walls, Subdivide on for two-reel blends. Print one object. Tops are left plain.',baked:true,fine:true,interweave:false},
  {id:'stripes',name:'Test: striped tops',summary:'Two-reel blends as Standard, with Top surface interweave in 0.5 mm stripes. Print one object.',baked:false,fine:false,interweave:true},
  {id:'dual',name:'Test: dual wall',summary:'Two-reel blends as Standard, with Dual-wall mixing: colour only in the outer 0.45 mm, the lightest loaded reel behind it. Print one object. Not yet confirmed by a print.',baked:false,fine:false,interweave:false,dual:true},
];
const presetAvailable=()=>Boolean(state.project)&&FINE_BLEND_TARGETS.includes(state.target)&&state.strategy!=='solid'&&state.strategy!=='source';
export function workbenchPresetState(){
  if(!presetAvailable())return {available:false,current:''};
  const now={baked:$('bakedon').checked,fine:$('fineblendon').checked,interweave:$('interweaveon').checked,dual:$('dualwallon').checked};
  const extra=(now.dual&&Number($('dualwalldepth').value)!==0.45)||$('blendstrength').value!=='strong'||!$('keephue').checked||(now.interweave&&Number($('interweavecell').value)!==0.5)||!$('subdividemix').checked;
  const match=extra?null:workbenchPresets.find(p=>p.baked===now.baked&&p.fine===now.fine&&p.interweave===now.interweave&&Boolean(p.dual)===now.dual);
  return {available:true,current:match?.id||''};
}
export function workbenchApplyPreset(id){
  const preset=workbenchPresets.find(p=>p.id===id);if(!preset||!presetAvailable()||state.loading||state.exporting)return false;
  $('blendstrength').value='strong';setBlendStrength('strong');
  $('keephue').checked=true;setHueFidelity(true);
  $('dualwallon').checked=Boolean(preset.dual);
  // A fresh list makes the inner reel fall back to the lightest one loaded.
  if(preset.dual){$('dualwalldepth').value='0.45';$('dualwallinner').value='';$('dualwallinner').dataset.list='';}
  $('interweaveon').checked=preset.interweave;$('interweavecell').value='0.5';
  if($('fineblendon').checked!==preset.fine){$('fineblendon').checked=preset.fine;applyFineBlendControls();}
  // Without the fine profile the proven pairing is the model's own layer height with Subdivide on.
  if(!preset.fine)$('spectrumlayermode').value='preserve';
  $('subdividemix').checked=true;
  $('bakedon').checked=preset.baked;setBakedColours(preset.baked);
  clearReview();invalidateRecommendation();refresh();
  return true;
}
// Back up my settings: a file copy of what this browser keeps, and a way to load one back.
{
  const say=text=>{$('settingsstatus').textContent=text;};let pending=null;
  const close=()=>{pending=null;$('settingsconfirm').hidden=true;$('settingsload').value='';};
  $('settingssave').addEventListener('click',()=>{
    try{
      saveReels();const {file,skipped}=collectSettings(localStorage);
      if(!Object.keys(file.data).length){say('Nothing is saved in this browser yet.');return;}
      const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(file,null,1)],{type:'application/json'}));
      link.download=`yab3d-settings-${file.saved.slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
      say(`Saved ${describeSettings(file.data)}.`+(skipped.length?` Left out because it could not be read: ${skipped.join(', ')}.`:''));
    }catch(error){say(error.message||'The settings file could not be saved.');}
  });
  $('settingsload').addEventListener('change',async event=>{
    const file=event.target.files[0];close();if(!file)return;
    try{
      if(file.size>SETTINGS_MAX_BYTES)throw Error('Settings file must be smaller than 2 MB.');
      pending=readSettings(await file.text());
      $('settingsfound').textContent=`This file holds ${describeSettings(pending)}. Loading it replaces those in this browser and reloads the page, so an open model will need opening again.`;
      $('settingsconfirm').hidden=false;say('');
    }catch(error){close();say(error.message||'This settings file could not be read.');}
  });
  $('settingscancel').addEventListener('click',()=>{close();say('Nothing was changed.');});
  $('settingsapply').addEventListener('click',()=>{
    if(!pending)return;
    try{applySettings(localStorage,pending);}catch{close();say('Browser storage is unavailable, so nothing was loaded.');return;}
    let page=window;try{if(window.top.location.origin===location.origin)page=window.top;}catch{}
    page.location.reload();
  });
}
export const workbenchSource = () => retainedModel?.file || null;
export function workbenchPreview() {
  if(!state.project || !state.preview || state.preview.ok || state.loading || !state.assessed)return null;
  const payload=resultPlan(),colours=paletteOf(payload,state.previewMode);
  const mapping=state.previewMode==='result'&&state.strategy!=='source'?payload.mapping:null;
  return {key:JSON.stringify([state.epoch,state.plateId,state.objects,colours,mapping,state.layout]),
    render:()=>background().thumbnail(state.plateId,state.objects,colours,mapping,{size:768,layout:state.layout})};
}

printOptimiser=mountSequential($('printoptimiser'),()=>{
  if(!state.project||state.loading||state.exporting||!state.assessed||!state.bounds)throw Error('Load a model and wait for its analysis to finish.');
  const payload=resultPlan();
  if(payload.blocked)throw Error(payload.blocked);
  if($('export').disabled)throw Error('Apply and review the palette and export settings before comparing.');
  const options={target:state.target,reels:state.reels,physical:payload.physical,mapping:payload.mapping,
    recipes:payload.recipes,title:state.project.title,u1Nozzle:state.u1Nozzle,layerHeight:layerChoice(),
    supportInterface:state.supportInterface,subdivideMixLayer:subdivideChoice(),preserveSourceSettings:true,bambuSetup:state.bambuSetup,calibration:calibrationPanel?.active() || null};
  const hasSupports=[state.project.sourceSettings,...state.objects.map(id=>state.project.meta.get(String(id))?.settings)].some(s=>['1','true'].includes(String(s?.enable_support)));
  return {signature:exportRevision(),worker:background(),plateId:state.plateId,objects:state.footprints,
    quantities:state.quantities,layout:layoutSettings(),mapping:payload.mapping,recipes:payload.recipes.map((r,i)=>({...r,id:payload.physical.length+i+1})),options,
    additionalMaterials:state.supportInterface||payload.recipes.length>0||hasSupports||state.supportsPainted};
});
