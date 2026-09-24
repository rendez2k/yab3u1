import { buildU1Profile, matchU1Profile, detectNozzle, profileDescription, resolveLayerHeight } from './shared/u1Profiles.js';
import { BatchSession, MAX_BATCH_FILES } from "./shared/batchSession.js";
import { RecolourWorker } from "./shared/workerClient.js";
import {targetLayout, planLayout} from './shared/layout.js';
import {planningAllowance, transferSettings} from './shared/printSettings.js';

export function initBatch({onTextureBundle}={}) {
  const $ = id => document.getElementById(id);
  let files = [], rows = [], outputUrl = null, analysing = false, analysisWorker = null;
  const analysed=new WeakMap();
  let invalidLayers=false;
  const layerChoice=()=>({mode:$('batchlayermode').value,value:$('batchlayerheight').value});
  function layerSummary(meta) {
    if(meta.error || $('batchtarget').value!=='snapmaker')return '';
    const match=matchU1Profile(meta.sourceSettings,$('batchnozzle').value,{carry:$('batchsettings').checked,layerHeight:layerChoice()});
    const sources=[{name:'Global',settings:{}},...(meta.objectSettings || []).filter(o=>o.settings?.layer_height!==undefined)];
    return sources.map(o=>`${o.name || o.id}: ${resolveLayerHeight({...meta.sourceSettings,...o.settings},match,layerChoice()).text}`).join(' ');
  }
  const say = text => { $("batchstatus").textContent = text; };
  const release = () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = null;
    $("batchout").replaceChildren();
  };
  const engine = new BatchSession(() => new RecolourWorker(),
    () => new RecolourWorker(new URL("./shared/batchZipWorker.js", import.meta.url)), {
      status: say,
      row: (index, state) => {
        rows[index].status.textContent = state.status[0].toUpperCase() + state.status.slice(1);
        rows[index].detail.textContent = state.detail;
        rows[index].item.dataset.status = state.status;
      },
      progress: value => { $("batchprogress").value = value; },
      packing: () => { $("batchcancel").disabled = true; },
    });

  function setMode(bulk) {
    if (engine.busy || analysing) return;
    $("singlepanel").classList.toggle("hidden", bulk);
    $("batchpanel").classList.toggle("hidden", !bulk);
    $("mode-single").setAttribute("aria-pressed", String(!bulk));
    $("mode-bulk").setAttribute("aria-pressed", String(bulk));
  }
  function controls(running) {
    for (const id of ["batchfile", "batchtarget", "batchnozzle", "batchsettings", "batchlayermode", "batchlayerheight", "batchclear", "mode-single", "mode-bulk"]) $(id).disabled = running;
    $("batchdrop").setAttribute("aria-disabled", String(running));
    $("batchdrop").tabIndex = running ? -1 : 0;
    $("batchgo").disabled = running || !files.length || invalidLayers;
    $("batchcancel").classList.toggle("hidden", !running || analysing);
    $("batchcancel").disabled = false;
    rows.forEach(r => { r.remove.disabled = running; });
  }
  function render() {
    invalidLayers=false;
    $('batchlayers').classList.toggle('hidden',$('batchtarget').value!=='snapmaker');
    $('batchcustomlayer').classList.toggle('hidden',$('batchlayermode').value!=='custom');
    $("batchgo").classList.add("primary");
    $("batchgo").textContent = "Convert files";
    $("batchqueue").replaceChildren();
    rows = files.map((file, index) => {
      const item = document.createElement("li");
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = file.name;
      const detail = document.createElement("span");
      detail.className = "hint batchdetail";
      detail.textContent = analysed.has(file) ? describe(analysed.get(file)) : `${(file.size / 1048576).toFixed(1)} MB · Not yet analysed`;
      info.append(name, detail);
      const layers=document.createElement('p');layers.className='hint';
      try {layers.textContent=analysed.has(file)?layerSummary(analysed.get(file)):'';}
      catch(error){layers.textContent=`Needs attention: ${error.message}`;layers.setAttribute('role','alert');invalidLayers=true;}
      info.append(layers);
      const status = document.createElement("span");
      status.className = "batchstate";
      status.textContent = "Queued";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        files.splice(index, 1); release(); render();
        say(files.length ? `${files.length} files ready.` : "Add files to start a batch.");
        (rows[Math.min(index, rows.length - 1)]?.remove || $("batchdrop")).focus();
      });
      item.append(info, status, remove);
      $("batchqueue").append(item);
      return { item, status, detail, remove };
    });
    $("batchcount").textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} in batch` : "No files added yet";
    $("batchclear").classList.toggle("hidden", !files.length);
    $("batchprogress").classList.add("hidden");
    controls(false);
  }
  function describe(meta) {
    if(meta.error) return `Cannot read: ${meta.error}`;
    const target=$('batchtarget').value;
    const source=meta.kind==='bambu' ? 'Bambu/Orca-family 3MF' : meta.kind==='prusa' ? 'Prusa-family 3MF' : '3MF';
    let text=`${source} project · ${meta.plates.length} plate(s) · ${meta.colors.length} filament entries`;
    if(meta.sourcePrinter) text+=` · ${meta.sourcePrinter}`;
    if(meta.filamentUsage) text+=` (${meta.filamentUsage.unused.length} unused)`;
    const nozzle=detectNozzle(meta.sourceSettings);
    text+=` · source nozzle: ${nozzle ? nozzle+' mm' : 'unknown or mixed'}. `;
    if(target==='snapmaker') {
      try {text+=profileDescription(buildU1Profile(meta.sourceSettings,meta.types,$('batchnozzle').value,{carry:$('batchsettings').checked,layerHeight:layerChoice()}));}
      catch(error){text+=`Needs attention: ${error.message}`;}
    } else text+=`Convert to ${target}; choose your printer and nozzle in the destination slicer. `;
    if(meta.negativeVolumes) text+=' Contains negative cutouts; Prusa export is unsupported. ';
    if(meta.customLayerActions) text+=' Recreate source pauses/custom G-code in the destination slicer. ';
    for(const plate of meta.plates) {
      const measured=plate.measurement;
      const plateName=plate.name || `Plate ${meta.plates.indexOf(plate)+1}`;
      if(!measured?.bounds) {text+=` ${plateName}: no printable geometry. `;continue;}
      const size=measured.bounds.max.map((v,i)=>v-measured.bounds.min[i]);
      text+=` ${plateName}: ${size.map(v=>v.toFixed(1)).join(' × ')} mm. `;
      const ids=new Set(plate.objectIds.map(String));
      const objects=(meta.objectSettings || []).filter(o=>ids.has(String(o.id)));
      const sources=(objects.length?objects:[{}]).map(o=>({...meta.sourceSettings,...o.settings}));
      const allowance=planningAllowance(sources,target,$('batchsettings').checked,'auto',measured.supportsPainted);
      if(target==='snapmaker') {
        const plan=planLayout(measured.bounds,{...targetLayout(target,{copies:1,spacing:5,tower:true}),...allowance});
        text+=plan.blocked?'Needs rearranging: does not fit the U1 with print/tower clearance. ':'Fits the U1 planning area after centring. ';
      }
      text+=allowance.footprintNotes.join(' ')+' ';
      const transferred=transferSettings(meta.sourceSettings,target);
      if($('batchsettings').checked)text+=`${Object.keys(transferred.values || {}).length} compatible global settings found. `;
    }
    return text+(meta.warnings || []).join(' ');
  }
  async function addFiles(incoming) {
    if(engine.busy || analysing) return;
    setMode(true); analysing=true; controls(true);
    const additions=[], notes=[];let textureFile=null;
    try {
      for(const file of Array.from(incoming)) {
        if(/\.zip$/i.test(file.name)) {
          say(`Reading bundle ${file.name}…`);
          analysisWorker=new RecolourWorker(new URL('./shared/bundleWorker.js',import.meta.url));
          try {
            if(file.size>96*1048576) throw new Error('ZIP exceeds the 96 MB input limit.');
            const bytes=await file.arrayBuffer();
            const bundle=await analysisWorker.request('unpack',{bytes},{transfer:[bytes]});
            if(!bundle.files.length && bundle.ignored.some(f=>/\.obj$/i.test(f.name)) && incoming.length===1 && !files.length && onTextureBundle){textureFile=file;continue;}
            additions.push(...bundle.files.map(f=>new File([f.bytes],f.name,{type:'application/3mf'})));
            notes.push(`${file.name}: ${bundle.files.length} 3MF projects. ${bundle.ignored.length} other files not converted: ${bundle.ignored.map(f=>f.name.split('/').pop()).join(', ') || 'none'}. STL files contain geometry only, without painted project settings.`);
          } catch(error) {notes.push(`${file.name}: ${error.message}`);}
          finally {analysisWorker?.dispose('Bundle read');analysisWorker=null;}
        } else if(/\.3mf$/i.test(file.name)) additions.push(file);
        else notes.push(`${file.name}: unsupported input; choose a 3MF project or ZIP bundle.`);
      }
      const accepted=additions.slice(0,MAX_BATCH_FILES-files.length);
      if(accepted.length<additions.length) notes.push('The batch limit is 50 projects; additional projects were not added.');
      files.push(...accepted); release();render();controls(true);
      $('batchbundleinfo').textContent=notes.join(' ');
      for(const file of accepted) {
        say(`Analysing ${file.name}…`);
        analysisWorker=new RecolourWorker();
        try {
          if(file.size>96*1048576) throw new Error('Project exceeds 96 MB.');
          const bytes=await file.arrayBuffer();
          const reply=await analysisWorker.load(bytes,{light:true});
          for(const plate of reply.meta.plates) plate.measurement=await analysisWorker.bounds(plate.id,null);
          analysed.set(file,reply.meta);
        } catch(error) {analysed.set(file,{error:error.message});}
        finally {analysisWorker?.dispose('Analysis complete');analysisWorker=null;}
        render();controls(true);
      }
      say(`${files.length} projects analysed. Review the details, choose a destination, then convert.`);
    } finally {analysing=false;controls(false);}
    if(textureFile){setMode(false);onTextureBundle(textureFile);}
  }
  $("mode-single").addEventListener("click", () => setMode(false));
  $("mode-bulk").addEventListener("click", () => setMode(true));
  $("batchfile").addEventListener("click", event => event.stopPropagation());
  $("batchfile").addEventListener("change", () => {
    addFiles($("batchfile").files);
    $("batchfile").value = "";
  });
  $("batchdrop").addEventListener("click", () => { if (!engine.busy) $("batchfile").click(); });
  $("batchdrop").addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (!engine.busy) $("batchfile").click(); }
  });
  for (const type of ["dragenter", "dragover"]) $("batchdrop").addEventListener(type, event => {
    event.preventDefault(); if (!engine.busy) $("batchdrop").classList.add("over");
  });
  $("batchdrop").addEventListener("dragleave", () => $("batchdrop").classList.remove("over"));
  $("batchdrop").addEventListener("drop", event => {
    event.preventDefault(); event.stopPropagation();
    $("batchdrop").classList.remove("over"); addFiles(event.dataTransfer.files);
  });
  $("batchclear").addEventListener("click", () => {
    $('batchbundleinfo').textContent='';
    files = []; release(); render(); say("Add files to start a batch.");
    $("batchdrop").focus();
  });
  for (const id of ["batchtarget", "batchsettings", "batchnozzle", "batchlayermode", "batchlayerheight"]) $(id).addEventListener("change", () => {
    release(); render(); say("Options updated. Convert to create a new ZIP.");
  });
  $('batchlayerheight').addEventListener('input',()=>{release();render();});
  $("batchcancel").addEventListener("click", () => {
    engine.cancel(); $("batchcancel").disabled = true;
    say("Stopping. Completed outputs will be kept in the ZIP.");
  });
  $("batchgo").addEventListener("click", async () => {
    if (engine.busy || analysing || !files.length || invalidLayers) return;
    release(); render(); controls(true);
    $("batchprogress").classList.remove("hidden");
    $("batchprogress").max = files.length;
    $("batchprogress").value = 0;
    try {
      const result = await engine.run(files, { target: $("batchtarget").value, keepSettings: $("batchsettings").checked, u1Nozzle: $("batchnozzle").value, layerHeight:layerChoice() });
      if (!result) return;
      const { report } = result;
      outputUrl = URL.createObjectURL(new Blob([result.bytes], { type: "application/zip" }));
      const link = document.createElement("a");
      link.className = "save";
      link.href = outputUrl;
      link.download = result.name;
      link.textContent = report.outputs ? `Download ZIP · ${report.outputs} converted file${report.outputs === 1 ? "" : "s"}` : "Download report ZIP";
      const failures = report.entries.filter(e => e.status === "failed").length;
      $("batchout").append(link);
      say(`${report.cancelled ? "Stopped" : "Finished"}: ${report.outputs} converted output${report.outputs === 1 ? "" : "s"}, ${failures} failure${failures === 1 ? "" : "s"}. The ZIP includes a readable report and full settings details.`);
      $("batchgo").classList.remove("primary");
      $("batchgo").textContent = "Convert again";
      $("batchprogress").value = files.length;
      link.click();
      link.focus();
    } catch (error) { say(`The ZIP could not be created: ${error.message}. Try fewer files.`); }
    finally { controls(false); }
  });
  window.addEventListener("pagehide", () => { engine.close(); analysisWorker?.dispose("Page closed"); release(); });
  render();
  return { addFiles };
}
