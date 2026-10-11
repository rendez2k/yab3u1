import {sequentialPlates} from './printOptimiser.js';
import {writeZip} from '../zip.js';
import {BambuProfiles} from './bambuProfiles.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** A preparation option, not a time-scoring workflow. Shared by both pages. */
export function mountSequential(host,getContext) {
  host.innerHTML=`<section class="sequential-panel"><label class="check"><input type="checkbox" data-sequential> Merge colour groups for sequential printing</label>
    <div data-options hidden><p>Same-colour parts become one slicer object per filament, keeping their separate meshes. Each group finishes before the next group starts, on the same plate. Multicoloured parts go on a separate by-layer plate.</p>
    <label data-printer-row hidden>Bambu printer and nozzle<select data-printer><option value="">Choose your printer</option></select></label>
    <button type="button" data-prepare>Prepare plates</button>
    <p class="hint">Uses your current quantities. Groups have a 25 mm planning gap; this is not a head-clearance guarantee. Open in your slicer, Arrange, then Slice to check head and gantry clearance. Split into smaller batches if needed.</p>
    <div data-plates></div><button type="button" data-pack hidden>Download all plates</button></div>
    <p data-status role="status" aria-live="polite"></p></section>`;
  const $=selector=>host.querySelector(selector),profiles=new BambuProfiles();
  let context=null,jobs=[],generation=0,busy=false;
  const status=text=>$('[data-status]').textContent=text;
  const lock=value=>{busy=value;$('[data-status]').dataset.busy=String(value);host.querySelectorAll('button').forEach(b=>b.disabled=value);};
  const reset=()=>{generation++;context=null;jobs=[];$('[data-plates]').replaceChildren();$('[data-pack]').hidden=true;status('');};
  const check=()=>{if(context){try{if(getContext().signature!==context.signature)reset();}catch{reset();}}};
  const current=()=>{if(!context||getContext().signature!==context.signature)throw Error('The plate changed. Prepare the plates again.');};
  function download(name,bytes){const url=URL.createObjectURL(new Blob([bytes])),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  const filename=job=>`${job.id}-${job.sequence==='by object'?'merged-colour-groups-sequential':'by-layer-parts'}.3mf`;
  async function bytes(job){
    current();const stamp=generation;
    const result=await context.worker.request('comparison-export',{plateId:context.plateId,job,options:context.options});
    current();if(stamp!==generation)throw Error('The plate changed while exporting. Prepare again.');
    return new Uint8Array(result.bytes);
  }
  $('[data-sequential]').addEventListener('change',event=>{reset();$('[data-options]').hidden=!event.target.checked;});
  $('[data-printer]').addEventListener('change',reset);
  host.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    try{
      if(button.hasAttribute('data-prepare')){
        reset();lock(true);status('Grouping your objects…');
        const stamp=generation,ctx=getContext();context={...ctx,options:structuredClone(ctx.options),layout:{...ctx.layout}};
        if(!['bambu','snapmaker'].includes(context.options.target))throw Error('Choose Bambu Studio or Snapmaker Orca output for sequential printing.');
        if(context.options.target==='bambu'&&!context.options.bambuSetup){
          if(!$('[data-printer]').value){
            const list=await profiles.catalogue();if(stamp!==generation)return;
            $('[data-printer]').innerHTML='<option value="">Choose your printer</option>'+list.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
            $('[data-printer-row]').hidden=false;status('Choose the Bambu printer and nozzle, then prepare the plates.');return;
          }
          context.options.bambuSetup=await profiles.setup($('[data-printer]').value,(ctx.options.physical||ctx.options.reels).map(r=>r.type));
        }
        if(stamp!==generation)return;current();
        const setup=context.options.bambuSetup;
        if(setup)Object.assign(context.layout,setup.bed,{centre:[setup.bed.width/2,setup.bed.depth/2]});
        jobs=sequentialPlates(context);
        // Validate the actual archives now, so a prepared plate is downloadable
        // and incompatibilities are explained before the user commits to it.
        let preparedBytes=0;
        for(const job of jobs){status(`Preparing ${job.label.toLowerCase()}…`);job.bytes=await bytes(job);preparedBytes+=job.bytes.length;if(preparedBytes>256*1024*1024)throw Error('These plates are too large to prepare together. Reduce the quantities and try again.');}
        $('[data-plates]').innerHTML='<ol class="sequential-plates">'+jobs.map(job=>`<li><strong>${esc(job.label)}</strong> · ${job.count} objects · ${job.sequence==='by object'?'Sequential':'By layer'}<p class="hint">${job.names.map(esc).join(', ')}${job.extraSupport?' · Extra support material retained; this plate stays by layer.':''}</p><button type="button" data-download="${job.id}">Download this plate</button></li>`).join('')+'</ol>';
        $('[data-pack]').hidden=false;
        status(`${jobs.length} plate${jobs.length===1?'':'s'} prepared. Object counts and colours are preserved.`);return;
      }
      if(button.dataset.download){current();const job=jobs.find(j=>j.id===button.dataset.download);download(filename(job),job.bytes);status('Plate downloaded. Arrange and check it in the slicer.');return;}
      if(button.hasAttribute('data-pack')){
        current();lock(true);const stamp=generation,files=[];let total=0;
        for(const job of jobs){const data=job.bytes;total+=data.length;if(total>256*1024*1024)throw Error('This download is too large. Download individual plates instead.');files.push({name:filename(job),data});}
        files.push({name:'Read me.txt',data:new TextEncoder().encode('Same-colour parts are merged into one logical slicer object per filament, preserving the individual meshes. Colour groups share a sequential plate. Multicoloured and PETG-interface parts print by layer on a separate plate.\nThe 25 mm group gap is only a planning allowance. Open the sequential plate in your destination slicer, Arrange, then Slice to validate head and gantry clearance. Split into smaller batches if it cannot fit safely.\nNo machine clearance or printing time is certified by YAB3D.\n')});
        const packed=await writeZip(files);current();if(stamp!==generation)return;download('sequential-plates.zip',packed);status('Plates downloaded. Start with the single-colour plates; print the multicoloured plate separately.');
      }
    }catch(error){status(error.message);}finally{lock(false);}
  });
  for(const type of ['input','change'])document.addEventListener(type,event=>{if(!host.contains(event.target))check();});
  return {invalidate:reset,check};
}
