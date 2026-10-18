import {sequentialPlates,outputTools} from '../../web/shared/printOptimiser.js';
import {emptyBox,addBox,planLayout} from '../../web/shared/layout.js';
import {writeZip} from '../../web/zip.js';
import {BambuProfiles} from '../../web/shared/bambuProfiles.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function preparePlateJobs(context,mode='sequential'){
  if(mode==='sequential')return sequentialPlates(context);
  if(mode!=='colours')throw Error('Choose separate colour plates or sequential groups.');
  const copies=Number(context.layout.copies||1),groups=new Map();
  if(!Number.isInteger(copies)||copies<1)throw Error('Choose a valid copy count.');
  for(const o of context.objects){
    const count=(context.quantities[o.objectId]??1)*copies;if(count===0)continue;
    if(!Number.isInteger(count)||count<0||count>64)throw Error('Use 1–64 copies of each object when preparing colour plates.');
    const tools=outputTools(o,context.mapping,context.recipes),key=tools?.length===1&&!context.options.supportInterface?tools[0]:'multi';
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...o,count});
  }
  if(!groups.size)throw Error('Keep at least one object on the plate.');
  return [...groups].sort(([a],[b])=>a==='multi'?1:b==='multi'?-1:a-b).map(([key,rows],i)=>{
    const quantities=Object.fromEntries(rows.map(o=>[o.objectId,o.count])),layout={...context.layout,arrangement:'objects',copies:1,quantities,footprints:rows,colourGroups:undefined},box=emptyBox();
    rows.forEach(o=>addBox(box,o.bounds));const plan=planLayout(box,layout);
    if(plan.blocked||plan.capped)throw Error(`The ${key==='multi'?'multicolour':`filament ${key}`} parts do not fit one plate. Reduce their quantity and prepare again.`);
    return {id:`plate-${i+1}`,objects:rows.map(o=>o.objectId),names:rows.map(o=>o.name),filament:key==='multi'?null:key,
      label:key==='multi'?'Multicolour parts':`Filament ${key} parts`,colour:(context.options.physical||context.options.reels||[])[key-1]?.color,
      count:rows.reduce((n,o)=>n+o.count*(o.instances||1),0),sequence:'by layer',quantities,layout,extraSupport:Boolean(context.options.supportInterface)};
  });
}

/** Workbench-only flow. Same geometry and export validation as the established engines. */
export function mountSequential(host,getContext) {
  host.innerHTML=`<section class="sequential-panel"><label class="studio-field">Print layout<select data-print-mode><option value="together">Together on one plate</option><option value="colours">Separate plates by colour</option><option value="sequential">Sequential colour groups</option></select></label>
    <div data-options hidden><p class="hint" data-mode-help></p>
    <label data-printer-row hidden>Bambu printer and nozzle<select data-printer><option value="">Choose your printer</option></select></label>
    <button type="button" data-prepare>Prepare plates</button><p data-status role="status" aria-live="polite"></p>
    <p class="hint" data-mode-check></p>
    <div data-plates></div><button type="button" data-pack hidden>Download all plates</button></div></section>`;
  const $=selector=>host.querySelector(selector),profiles=new BambuProfiles();
  const mode=()=>$('[data-print-mode]').value;
  let context=null,jobs=[],generation=0,busy=false;
  const status=(text,state='progress')=>{const node=$('[data-status]');node.textContent=text;node.dataset.state=state;};
  const lock=value=>{busy=value;$('[data-status]').dataset.busy=String(value);host.querySelector('section').setAttribute('aria-busy',String(value));$('[data-prepare]').textContent=value?'Preparing plates…':'Prepare plates';host.querySelectorAll('button,select').forEach(b=>b.disabled=value);};
  const reset=()=>{generation++;context=null;jobs=[];$('[data-plates]').replaceChildren();$('[data-pack]').hidden=true;status('');};
  const check=()=>{if(context){try{if(getContext().signature!==context.signature)reset();}catch{reset();}}};
  const current=()=>{if(!context||getContext().signature!==context.signature)throw Error('The plate changed. Prepare the plates again.');};
  function download(name,bytes){const url=URL.createObjectURL(new Blob([bytes])),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  const filename=job=>`${job.id}-${job.filament?`filament-${job.filament}`:job.sequence==='by object'?'colour-groups-sequential':'multicolour-by-layer'}.3mf`;
  async function bytes(job){
    current();const stamp=generation;
    const result=await context.worker.request('comparison-export',{plateId:context.plateId,job,options:context.options},{onProgress:progress=>{if(stamp===generation)status(`${progress.message} · ${job.label}`);}});
    current();if(stamp!==generation)throw Error('The plate changed while exporting. Prepare again.');
    return new Uint8Array(result.bytes);
  }
  $('[data-print-mode]').addEventListener('change',()=>{
    reset();$('[data-options]').hidden=mode()==='together';
    $('[data-mode-help]').textContent=mode()==='colours'?'Each single-colour group gets its own plate. Multicoloured parts stay together on a separate plate. Colours and quantities are kept.':'Same-colour parts share one slicer group. Each group finishes before the next. Multicoloured parts go on a separate by-layer plate.';
    $('[data-mode-check]').textContent=mode()==='colours'?'Downloads one 3MF per plate, using the selected printer. Open each in your slicer; change its printer there if needed. Support and interface filaments are retained.':'The 25 mm planning gap is not a clearance guarantee. Arrange and Slice in your slicer to check head and gantry clearance. Use separate colour plates if the groups cannot fit safely.';
  });
  $('[data-printer]').addEventListener('change',reset);
  host.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    try{
      if(button.hasAttribute('data-prepare')){
        reset();lock(true);status('Grouping your objects…');
        const stamp=generation,ctx=getContext();context={...ctx,options:structuredClone(ctx.options),layout:{...ctx.layout}};
        $('[data-printer-row]').hidden=context.options.target!=='bambu'||Boolean(context.options.bambuSetup);
        if(!['bambu','snapmaker'].includes(context.options.target))throw Error('Choose Bambu Studio or Snapmaker Orca output to prepare these plates.');
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
        jobs=preparePlateJobs(context,mode());
        // Validate the actual archives now, so a prepared plate is downloadable
        // and incompatibilities are explained before the user commits to it.
        let preparedBytes=0;
        for(const job of jobs){status(`Preparing ${job.label.toLowerCase()}…`);job.bytes=await bytes(job);preparedBytes+=job.bytes.length;if(preparedBytes>256*1024*1024)throw Error('These plates are too large to prepare together. Reduce the quantities and try again.');}
        $('[data-plates]').innerHTML='<ol class="sequential-plates">'+jobs.map(job=>`<li>${/^#[0-9a-f]{6}$/i.test(job.colour||'')?`<i class="plate-colour" style="background:${job.colour}" aria-hidden="true"></i>`:''}<strong>${esc(job.label)}</strong> · ${job.count} object${job.count===1?'':'s'} · ${job.sequence==='by object'?'Sequential':'By layer'}<p class="hint">${job.names.map(esc).join(', ')}${job.extraSupport?' · Extra support material retained; this plate stays by layer.':''}</p><button type="button" data-download="${job.id}">Download this plate</button></li>`).join('')+'</ol>';
        $('[data-pack]').hidden=false;
        status(`${jobs.length} plate${jobs.length===1?'':'s'} ready to download below. Object counts and colours are preserved.`,'success');return;
      }
      if(button.dataset.download){current();const job=jobs.find(j=>j.id===button.dataset.download);download(filename(job),job.bytes);status('Plate downloaded. Arrange and check it in the slicer.');return;}
      if(button.hasAttribute('data-pack')){
        current();lock(true);const stamp=generation,files=[];let total=0;
        for(const job of jobs){const data=job.bytes;total+=data.length;if(total>256*1024*1024)throw Error('This download is too large. Download individual plates instead.');files.push({name:filename(job),data});}
        files.push({name:'Read me.txt',data:new TextEncoder().encode(mode()==='colours'?'Each single-colour group has its own 3MF. Multicoloured and PETG-interface parts stay on a separate by-layer plate. Filament assignments, quantities and compatible settings are retained. Open each project in the selected slicer, or change its printer there if using another printer. Check supports and slice before printing.\n':'Same-colour parts share one logical slicer object per filament, preserving individual meshes. Groups share a sequential plate; multicoloured and PETG-interface parts print by layer separately. The 25 mm group gap is a planning allowance only. Arrange and Slice in the destination slicer to validate head and gantry clearance. Use separate colour plates if clearance fails. No print time is certified.\n')});
        const packed=await writeZip(files);current();if(stamp!==generation)return;download(mode()==='colours'?'colour-plates.zip':'sequential-plates.zip',packed);status('Plates downloaded. Each 3MF is a separate print job.');
      }
    }catch(error){jobs=[];$('[data-plates]').replaceChildren();$('[data-pack]').hidden=true;status(`Could not prepare plates. ${error.message==='Apply and review the palette and export settings before comparing.'?'Open Output and confirm the colour mapping, then return here to prepare plates.':error.message}`,'error');}finally{lock(false);}
  });
  for(const type of ['input','change'])document.addEventListener(type,event=>{if(!host.contains(event.target))check();});
  return {invalidate:reset,check};
}
