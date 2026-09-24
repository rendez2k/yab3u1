import {RecolourWorker} from './workerClient.js';
import {Preview} from './preview.js';
import {channels,bin,orientedPositions} from './textureModel.js';
// Reusable local preparation dialog. Closing kills its worker, so stale results
// cannot load into either page. Existing projects change only after Continue.
export function createTextureImport({onAccept,buttonHost}){
  const dialog=document.createElement('dialog');dialog.className='texture-dialog';
  dialog.innerHTML=`<form method="dialog" class="texture-top"><h2>Turn model colours into filament colours</h2><button aria-label="Close texture import">Close</button></form>
    <p>GLB, OBJ with MTL and textures in a ZIP, or vertex-colour 3MF. Files stay in your browser.</p>
    <label>Textured model <input class="texture-file" type="file" accept=".glb,.zip,.3mf"></label>
    <p class="texture-status" role="status" aria-live="polite"></p>
    <section class="texture-ready" hidden>
      <p class="texture-facts"></p>
      <div class="texture-options"><label>Palette size <select class="texture-count">${Array.from({length:15},(_,i)=>i+2).map(n=>`<option value="${n}" ${n===5?'selected':''}>${n} colours</option>`).join('')}</select></label>
      <label>Model height (mm) <input class="texture-height" type="number" value="150" min="0.1" max="1000" step="0.1"></label>
      <label>Source up axis <select class="texture-axis"><option value="y">Y up (typical GLB/OBJ)</option><option value="z">Z up (typical 3MF)</option></select></label></div>
      <div class="texture-views"><button type="button" data-view="original" aria-pressed="false">Sampled source</button><button type="button" data-view="reduced" aria-pressed="true">Filament palette</button><button type="button" class="texture-reset">Reset view</button></div>
      <canvas class="texture-canvas" aria-label="Texture colour reduction preview"></canvas>
      <p class="texture-dimensions"></p><p>Edit the swatches to change each colour group. Changing palette size recalculates the groups.</p>
      <div class="texture-palette"></div><p class="texture-warning"></p>
      <p class="texture-note">The preview is simplified. Textures are sampled at up to 4096 pixels per side. The prepared 3MF assembles the parts into one painted mesh, keeping every source triangle with one colour per face. Fine texture detail and gradients are approximated. Colour reduction does not repair holes or make a model watertight.</p>
      <label><input class="texture-check" type="checkbox"> I have checked the orientation, size and reduced colours.</label>
      <div class="texture-actions"><button type="button" class="texture-download">Download prepared 3MF</button><button type="button" class="texture-continue primary">Use these colours</button></div>
    </section>`;
  document.body.append(dialog);
  const $=s=>dialog.querySelector(s),status=t=>$('.texture-status').textContent=t;
  let worker=null,epoch=0,busy=false,result=null,palette=[],view='reduced',preview=null,positions=null;
  const launcher=document.createElement('button');launcher.type='button';launcher.textContent='Import a textured model (GLB / OBJ / colour 3MF)';launcher.className='texture-launch';buttonHost.append(launcher);
  const control=()=>{
    for(const s of ['.texture-count','.texture-height','.texture-axis','.texture-check'])$(s).disabled=busy;
    dialog.querySelectorAll('.texture-palette input').forEach(input=>input.disabled=busy);
    for(const s of ['.texture-download','.texture-continue'])$(s).disabled=busy||!result||!$('.texture-check').checked||!validSize();
  };
  const validSize=()=>Number.isFinite(Number($('.texture-height').value))&&Number($('.texture-height').value)>0&&Number($('.texture-height').value)<=1000;
  const invalidate=()=>{$('.texture-check').checked=false;control();};
  function render(fit=false){
    if(!result||!validSize())return;const up=$('.texture-axis').value,height=Number($('.texture-height').value);
    positions=orientedPositions(result.preview.positions,up,height,result.meta.bounds);
    const colors=new Float32Array(positions.length);
    for(let f=0;f<result.preview.colours.length;f++){
      const c=result.preview.colours[f],rgb=view==='original'?channels(c):channels(parseInt(palette[result.lookup[bin(c)]].slice(1),16));
      for(let k=0;k<9;k++)colors[f*9+k]=rgb[k%3]/255;
    }
    if(!preview)preview=new Preview($('.texture-canvas'));
    if(preview.ok)preview.setSoup(positions,colors,{fit});else status(preview.error);
    const b=result.meta.bounds.size,scale=height/b[up==='y'?1:2],dimensions=(up==='y'?[b[0],b[2],b[1]]:b).map(v=>(v*scale).toFixed(1));
    $('.texture-dimensions').textContent=`Prepared size: ${dimensions.join(' × ')} mm · ${palette.length} colour groups. Orbit by dragging; scroll to zoom.`;
  }
  function swatches(){
    $('.texture-palette').replaceChildren();palette.forEach((color,i)=>{
      const label=document.createElement('label'),input=document.createElement('input'),caption=document.createElement('span');input.type='color';input.value=color;input.setAttribute('aria-label',`Imported colour ${i+1}`);
      caption.textContent=`${i+1} · ${(result.coverage[i]*100).toFixed(1)}% of surface`;
      input.oninput=()=>{palette[i]=input.value.toUpperCase();invalidate();render();};label.append(input,caption);$('.texture-palette').append(label);
    });
  }
  async function open(file){
    if(!dialog.open)dialog.showModal();if(!file){if(!result){$('.texture-ready').hidden=true;status('Choose a textured model to prepare.');control();}$('.texture-file').click();return;}
    const token=++epoch;worker?.dispose();worker=new RecolourWorker(new URL('./textureWorker.js',import.meta.url));result=null;busy=true;control();$('.texture-ready').hidden=true;status(`Reading ${file.name}…`);
    try{
      if(file.size>96*1048576)throw Error('Input exceeds 96 MB. Export a smaller GLB or texture bundle.');
      const bytes=await file.arrayBuffer();if(token!==epoch)return;
      const reply=await worker.request('load',{bytes,name:file.name,count:Number($('.texture-count').value)},{transfer:[bytes],onProgress:p=>status(p.stage+'…')});
      if(token!==epoch)return;result=reply;palette=reply.palette.slice();$('.texture-axis').value=reply.meta.up;
      if(/\.3mf$/i.test(file.name))$('.texture-height').value=String(+reply.meta.bounds.size[2].toFixed(2));else $('.texture-height').value='150';
      $('.texture-ready').hidden=false;$('.texture-facts').textContent=`${reply.meta.format} · ${reply.meta.faces.toLocaleString()} triangles · ${reply.meta.parts} mesh part(s).`;
      $('.texture-warning').textContent=reply.meta.warnings.join(' ');invalidate();swatches();render(true);status('Compare the colours, then choose how to continue.');
    }catch(e){if(token===epoch)status('Could not prepare this file: '+e.message);}finally{if(token===epoch){busy=false;control();}}
  }
  launcher.onclick=()=>open();$('.texture-file').onchange=()=>{const f=$('.texture-file').files[0];$('.texture-file').value='';if(f)open(f);};
  $('.texture-count').onchange=async()=>{if(!result||busy)return;const token=epoch;busy=true;invalidate();status('Recalculating colour groups…');try{const r=await worker.request('reduce',{count:Number($('.texture-count').value)});if(token!==epoch)return;Object.assign(result,r);palette=r.palette.slice();swatches();render();status('Palette updated. Review the new groups.');}catch(e){if(token===epoch)status(e.message);}finally{if(token===epoch){busy=false;control();}}};
  for(const s of ['.texture-height','.texture-axis'])$(s).onchange=()=>{invalidate();try{render(true);}catch(e){status(e.message);}};
  $('.texture-check').onchange=control;
  dialog.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;dialog.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();});
  $('.texture-reset').onclick=()=>preview?.reset();
  async function finish(download){
    if(busy||!result||!$('.texture-check').checked||!validSize())return;busy=true;control();const token=epoch;status('Preparing the complete mesh…');
    try{
      const r=await worker.request('export',{options:{palette,height:Number($('.texture-height').value),up:$('.texture-axis').value}},{onProgress:p=>status(p.stage+'…')});if(token!==epoch)return;
      const name=result.meta.name+'-palette.3mf',file=new File([r.bytes],name,{type:'application/3mf'});
      if(download){const a=document.createElement('a'),url=URL.createObjectURL(file);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Prepared 3MF downloaded. It contains colour groups, not printer or support settings.');}
      else {dialog.close();await onAccept(file);}
    }catch(e){if(token===epoch)status('Could not prepare the output: '+e.message);}finally{if(token===epoch){busy=false;control();}}
  }
  $('.texture-download').onclick=()=>finish(true);$('.texture-continue').onclick=()=>finish(false);
  dialog.addEventListener('close',()=>{epoch++;worker?.dispose();worker=null;result=null;busy=false;preview?.setSoup(new Float32Array(0),new Float32Array(0));});
  window.addEventListener('pagehide',()=>worker?.dispose());return {open};
}
