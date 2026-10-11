import {buildStrategies,rankStrategies,readTiming,validateReport} from './printOptimiser.js';
import {RUNNER_SOURCE} from './optimiserRunner.js';
import {writeZip,readZip} from '../zip.js';
import {targetLayout} from './layout.js';
import {BambuProfiles} from './bambuProfiles.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const minutes=seconds=>{const total=Math.round(seconds/60);return `${Math.floor(total/60)}h ${total%60}m`;};
const encoder=new TextEncoder();
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');

export function mountOptimiser(host,getContext) {
  host.innerHTML=`<details class="print-optimiser"><summary>Optimise print time</summary>
    <p>Compare ways to print the same parts and colours. The object quantities above define one complete set; exclude alternative bodies and set matching part counts first.</p>
    <div class="optimiser-fields"><label>Optimise for<select data-field="objective"><option value="order">Finish the order fastest</option><option value="rate">Most complete sets per hour</option></select></label><label>Sets in this order<input data-field="sets" type="number" min="1" max="1000" value="1"></label><label>Plate change / cooldown (minutes)<input data-field="turnaround" type="number" min="0" max="1440" value="10"></label><label>Second printer<select data-field="second"><option value="none">One printer</option><option value="same">Another printer with identical setup</option><option value="snapmaker">Snapmaker U1 · same nozzle / materials</option></select></label></div>
    <details><summary>Comparison printer and sequential options</summary><p class="hint">The current page’s printer, nozzle, palette, support and layer settings are used. For a Bambu colour-model export, choose a native printer here.</p><button type="button" data-action="printers">Load Bambu printers</button><label>Bambu comparison profile<select data-field="bambu"><option value="">Use the page’s printer setup</option></select></label><label class="check"><input data-field="sequential" type="checkbox">Also test sequential single-filament objects</label><p class="hint">Sequential candidates must be arranged and pass clearance checks in the slicer. Blends and extra support materials are excluded. Normal Fill spacing is not a sequential clearance check.</p></details>
    <button type="button" data-action="compare">Compare strategies</button><p data-status role="status" aria-live="polite"></p>
    <div data-results></div><div data-jobs></div><div data-pack hidden><button type="button" data-action="pack">Download comparison pack</button><label>Import local timing report<input type="file" data-report accept=".json"></label><p class="hint">Extract slice-comparison.py from the ZIP. With Python 3 installed, run: <code>python slice-comparison.py comparison.zip</code>. This slices locally; nothing is uploaded or sent to a printer. Use --bambu or --snapmaker to specify a different installed slicer path. If that build cannot slice from the command line, open the job projects in your slicer and enter or import their times below.</p><button type="button" data-action="save">Save comparison results</button></div>
  </details>`;
  const $=selector=>host.querySelector(selector),field=name=>$(`[data-field="${name}"]`);
  let context=null,comparison=null,pack=null,timings={},busy=false,generation=0,bambuSetup=null;
  const profiles=new BambuProfiles();
  function status(message){$('[data-status]').textContent=message;}
  function lock(value){busy=value;host.querySelectorAll('button').forEach(b=>b.disabled=value);}
  function reset(message='Settings changed. Compare again to create matching jobs.') {
    generation++;comparison=null;pack=null;context=null;timings={};
    $('[data-results]').replaceChildren();$('[data-jobs]').replaceChildren();$('[data-pack]').hidden=true;status(message);
  }
  function current(){
    if(!context||getContext().signature!==context.signature)throw Error('The model or export settings changed. Compare strategies again.');
  }
  function renderResults() {
    if(!comparison)return;
    const rows=rankStrategies(comparison,timings),ready=rows.filter(r=>r.seconds!==null);
    const winner=ready[0];
    $('[data-results]').innerHTML=`<p>${winner?`Best timed candidate: <strong>${esc(winner.label)}</strong>. ${ready.length<rows.filter(r=>!r.blocked).length?'Other strategies still need timings.':''}`:'Add slicer timings before a strategy can be recommended.'}</p><div class="optimiser-table"><table><thead><tr><th>Strategy</th><th>Complete sets</th><th>Completion</th><th>Sets/hour</th><th>Plates</th><th>Tool changes</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${esc(r.label)}<small>${esc(r.status)}</small></th><td>${r.outputSets||'—'}</td><td>${r.seconds===null?'—':minutes(r.seconds)}</td><td>${r.seconds===null?'—':r.setsPerHour.toFixed(2)}</td><td>${r.plates??'—'}</td><td>${r.toolChanges??'Unknown'}</td></tr>`).join('')}</tbody></table></div><p class="hint">Slicer estimates, not measured print times. Completion excludes the final unloading; production rate includes the last-to-next plate change. Two-printer plans assume both start together with separate turnaround. The slower printer determines completion. Packing is a bounded search, not a guarantee of the global optimum.</p>`;
  }
  function renderJobs() {
    $('[data-jobs]').innerHTML=`<details open><summary>Slice jobs and timings · ${comparison.jobs.length} distinct plates</summary><p class="hint">Each project is a single plate. Enter total time for that entire plate, including preparation—not time per object. Unknown tool-change counts stay unknown.</p>${comparison.jobs.map(job=>`<section class="optimiser-job" data-job="${job.id}"><h3>${job.id} · printer ${job.machine+1} · ${job.batch} set(s) · ${job.sequence==='by object'?'sequential':'by layer'}</h3><p>${job.names.map(esc).join(', ')}</p><div class="quantity-actions"><button type="button" data-download="${job.id}">Download plate</button><label>Total minutes<input type="number" min="0.01" step="0.1" data-minutes="${job.id}"></label><label>Tool changes<input type="number" min="0" step="1" data-changes="${job.id}" placeholder="Unknown"></label></div><label>Read time from sliced G-code / 3MF<input type="file" data-gcode="${job.id}" accept=".gcode,.3mf"></label>${job.sequence==='by object'?`<label class="check"><input type="checkbox" data-clearance="${job.id}">This exact plate passed the slicer’s sequential clearance checks</label>`:''}<p class="hint" data-job-status="${job.id}"></p></section>`).join('')}</details>`;
    $('[data-pack]').hidden=comparison.jobs.length===0;
  }
  function config(ctx,machine) {
    const secondary=machine===1&&field('second').value==='snapmaker';
    const options=structuredClone(ctx.options);
    if(bambuSetup&&options.target==='bambu')options.bambuSetup=bambuSetup;
    if(secondary){options.target='snapmaker';options.bambuSetup=null;if(ctx.options.target==='bambu')options.u1Nozzle='0.4';}
    const setup=options.bambuSetup;
    let problem='';
    if(options.target==='bambu'&&!setup)problem='Choose a native Bambu comparison printer, including its nozzle.';
    if(!['bambu','snapmaker'].includes(options.target))problem='Select Bambu Studio or Snapmaker Orca output.';
    if(secondary&&ctx.options.target==='bambu' && Number((bambuSetup||ctx.options.bambuSetup)?.machine?.nozzle_diameter?.[0]||.4)!==.4)problem='For a cross-printer comparison, use a 0.4 mm source nozzle or compare the U1 separately with its chosen nozzle.';
    const layout=secondary?targetLayout('snapmaker',{...ctx.layout}):{...ctx.layout};
    if(options.target==='bambu'&&setup)Object.assign(layout,setup.bed,{centre:[setup.bed.width/2,setup.bed.depth/2]});
    return {target:options.target,layout,options,problem,maxPhysical:options.target==='snapmaker'?4:null};
  }
  async function jobBytes(job) {
    current();const stamp=generation,options=job.machine===1?context.secondary.options:context.primary.options;
    const result=await context.worker.request('comparison-export',{plateId:context.plateId,job,options});
    current();if(stamp!==generation)throw Error('Comparison changed while exporting.');
    return new Uint8Array(result.bytes);
  }
  function download(name,bytes,type='application/octet-stream'){
    const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  host.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    try {
      if(button.dataset.action==='printers') {
        lock(true);status('Loading official Bambu profiles…');
        const list=await profiles.catalogue();field('bambu').innerHTML='<option value="">Use the page’s printer setup</option>'+list.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
        status('Choose the printer and nozzle, then compare.');return;
      }
      if(button.dataset.action==='compare') {
        reset('Preparing comparable plate plans…');lock(true);
        const stamp=generation,ctx=getContext();
        const chosen=field('bambu').value;
        bambuSetup=chosen?await profiles.setup(chosen,(ctx.options.physical||ctx.options.reels).map(r=>r.type)):null;
        if(stamp!==generation)throw Error('Settings changed while loading profiles. Compare again.');
        context={...ctx,primary:config(ctx,0),secondary:field('second').value==='none'?null:config(ctx,1)};
        comparison=buildStrategies(context,{objective:field('objective').value,sets:Number(field('sets').value),turnaround:Number(field('turnaround').value),parallel:field('second').value!=='none',sequential:field('sequential').checked});
        renderResults();renderJobs();status('Plans ready. Slice the candidate plates to compare real slicer estimates.');return;
      }
      if(button.dataset.download){lock(true);status(`Preparing ${button.dataset.download}…`);const job=comparison.jobs.find(j=>j.id===button.dataset.download);download(`${job.id}.3mf`,await jobBytes(job));status('Plate ready. Slice with the exported printer and settings; sequential plates also need Arrange and clearance validation.');return;}
      if(button.dataset.action==='pack') {
        current();lock(true);const stamp=generation;
        const manifest={...comparison,packId:crypto.randomUUID(),jobs:[]};const files=[];let size=0;
        for(const job of comparison.jobs){status(`Preparing comparison pack: ${job.id} of ${comparison.jobs.length}…`);const bytes=await jobBytes(job);size+=bytes.length;if(size>256*1024*1024)throw Error('Comparison pack exceeds 256 MB. Download and time individual plates instead.');files.push({name:`${job.id}.3mf`,data:bytes});manifest.jobs.push({...job,file:`${job.id}.3mf`,sha256:await sha(bytes)});}
        files.push({name:'comparison.json',data:encoder.encode(JSON.stringify(manifest,null,2))},{name:'slice-comparison.py',data:encoder.encode(RUNNER_SOURCE)},
          {name:'README.txt',data:encoder.encode('Run: python slice-comparison.py comparison.zip\nImport the reported timings.json back into the same YAB3D comparison.\nOnly slice these projects; this helper never sends prints.\nSequential plates use slicer Arrange and must pass its checks.\nKeep quality settings fixed for a fair comparison.\n')});
        const bytes=await writeZip(files);current();if(stamp!==generation)throw Error('Comparison changed.');pack=manifest;download('comparison.zip',bytes,'application/zip');status('Comparison pack ready. Run the included local helper, then import timings.json.');return;
      }
      if(button.dataset.action==='save'){current();download('print-comparison.json',JSON.stringify({comparison,ranking:rankStrategies(comparison,timings),timings},null,2),'application/json');}
    }catch(error){status(error.message);}finally{lock(false);}
  });
  host.addEventListener('input',event=>{
    const input=event.target,id=input.dataset.minutes||input.dataset.changes||input.dataset.clearance;
    if(input.dataset.field && (comparison||busy)){reset();return;}
    if(!id)return;
    try {
      current();const time=$(`[data-minutes="${id}"]`).value,change=$(`[data-changes="${id}"]`).value;
      timings[id]={seconds:time.trim()?Number(time)*60:null,toolChanges:change.trim()?Number(change):null,source:'manual',clearanceChecked:$(`[data-clearance="${id}"]`)?.checked===true};
      renderResults();
    }catch(error){status(error.message);}
  });
  host.addEventListener('change',async event=>{
    const input=event.target;
    if(input.dataset.field){reset();field('sets').disabled=field('objective').value==='rate';return;}
    if(!input.matches('[data-report],[data-gcode]'))return;
    try {
      current();const stamp=generation,file=input.files?.[0];if(!file)return;
      if(file.size>96*1024*1024)throw Error('Use a timing file smaller than 96 MB.');
      if(input.matches('[data-report]')) {
        if(!pack)throw Error('Download this comparison’s pack before importing its report.');
        if(file.size>2*1024*1024)throw Error('Timing report is too large.');
        const report=JSON.parse(await file.text());current();if(stamp!==generation)return;
        timings={...timings,...validateReport(report,pack)};
      } else {
        let text;
        if(/\.3mf$/i.test(file.name)){const entries=await readZip(new Uint8Array(await file.arrayBuffer()));const members=[...entries].filter(([name])=>/\.gcode$/i.test(name));if(members.length!==1)throw Error('Choose a sliced 3MF with exactly one G-code plate.');text=new TextDecoder().decode(members[0][1]);}
        else text=await file.text();
        current();if(stamp!==generation)return;
        timings[input.dataset.gcode]={...readTiming(text),clearanceChecked:$(`[data-clearance="${input.dataset.gcode}"]`)?.checked===true};
      }
      for(const [id,timing] of Object.entries(timings)) {
        $(`[data-minutes="${id}"]`).value=timing.seconds?Number((timing.seconds/60).toFixed(2)):'';
        $(`[data-changes="${id}"]`).value=timing.toolChanges??'';
        const clearance=$(`[data-clearance="${id}"]`);if(clearance)clearance.checked=timing.clearanceChecked===true;
        $(`[data-job-status="${id}"]`).textContent=timing.error||'Slicer estimate loaded for this plate. Keep printer and quality settings unchanged.';
      }
      renderResults();status('Timing results updated.');
    }catch(error){status(error.message);}finally{input.value='';}
  });
  // Native user changes immediately invalidate visible timings. Async model
  // replacement is also guarded by the immutable export signature at use time.
  for(const type of ['input','change'])document.addEventListener(type,event=>{if((comparison||busy)&&!host.contains(event.target))reset();});
  return {invalidate:()=>{if(comparison||busy)reset();},check:()=>{
    if(!comparison)return;
    try{current();}catch{reset();}
  }};
}
