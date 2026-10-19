import {Preview} from '../../web/shared/preview.js';
import {palette} from '../../web/shared/targets.js';

/** Use the same objects, palette and placement plan as the prepared 3MF.
 * Never load an output file into the editable session or change its quantities. */
export function platePreviewRequest(context,job){
  const reels=context.options.physical||context.options.reels||[];
  const output=palette(reels.map(r=>r.color),reels.map(r=>r.type||'PLA'),context.options.recipes||[]);
  const colors=Object.fromEntries([...output.physical.map((color,i)=>[i+1,color]),...output.virtual.map(r=>[r.id,r.color])]);
  return {plateId:context.plateId,objects:job.objects,mode:'result',colors,
    mapping:context.options.mapping||context.mapping,layout:job.layout,haveGeometry:null};
}

/** Latest selection wins, including a close or source edit during a slow draw. */
export function platePreviewSession({render,show,clear}){
  let revision=0,bundle=null,activeId=null;
  return {
    get active(){return activeId!==null;},
    get selected(){return activeId;},
    async select(id){
      const job=bundle?.jobs.find(j=>j.id===id);if(!job)return;
      const stamp=++revision;activeId=id;show({job,bundle,loading:true});
      try{const result=await render(bundle.context,job);if(stamp===revision)show({job,bundle,result,loading:false});}
      catch(error){if(stamp===revision)show({job,bundle,error,loading:false});}
    },
    present(next){bundle=next;return this.select(next.jobs.find(j=>j.sequence==='by layer')?.id||next.jobs[0]?.id);},
    close(){revision++;activeId=null;clear();},
    reset(){this.close();bundle=null;},
    resume(){if(bundle&&!this.active)return this.select(bundle.jobs.find(j=>j.sequence==='by layer')?.id||bundle.jobs[0]?.id);},
  };
}

export function mountPreparedPreview(view,{edit,onSelect=()=>{}}={}){
  const root=view.make('section',{class:'prepared-preview',hidden:'','aria-label':'Prepared plate preview'},
    '<canvas aria-label="3D preview of the prepared plate"></canvas><img hidden alt="Static preview of the prepared plate">'+
    '<div class="prepared-caption" role="status"></div><div class="prepared-progress" hidden role="status"><span class="working-orb" aria-hidden="true"></span><span></span><button data-preview-retry hidden>Retry preview</button></div>'+
    '<div class="prepared-controls"><label>Plate<select data-prepared-plate></select></label><button data-prepared-top aria-pressed="false">Top</button><button data-prepared-reset>Reset view</button><button data-edit-model>Edit model</button></div>');
  view.stage.append(root);
  const $=q=>root.querySelector(q),canvas=$('canvas'),img=$('img'),picker=$('select'),status=$('.prepared-progress'),caption=$('.prepared-caption');
  let preview=null,url=null,currentJob=null,cache=new Map(),lastContext=null;
  const session=platePreviewSession({
    async render(context,job){
      if(context!==lastContext){cache.clear();lastContext=context;}
      if(!preview)preview=new Preview(canvas);
      if(!cache.has(job.id)){
        const payload=platePreviewRequest(context,job);
        const pending=preview.ok?context.worker.request('preview',payload).then(r=>({soup:r.preview})):
          context.worker.request('thumbnail',{...payload,size:1000}).then(r=>({image:r.main}));
        cache.set(job.id,pending);pending.catch(()=>{if(cache.get(job.id)===pending)cache.delete(job.id);});
        if(cache.size>2)cache.delete(cache.keys().next().value);
      }
      return cache.get(job.id);
    },
    show({job,bundle,result,loading,error}){
      currentJob=job;root.hidden=false;view.stage.dataset.prepared='true';
      picker.replaceChildren(...bundle.jobs.map((j,i)=>{const o=view.make('option',{value:j.id});o.textContent=`${i+1} · ${j.count} parts · ${j.sequence==='by object'?'Sequential':'By layer'}`;return o;}));picker.value=job.id;
      const number=bundle.jobs.indexOf(job)+1;
      caption.textContent=`Plate ${number} of ${bundle.jobs.length} · ${job.count} parts · ${job.sequence==='by object'?'Sequential colour groups':'By layer'}`;
      root.setAttribute('aria-busy',String(loading));status.hidden=!loading&&!error;
      status.querySelector('.working-orb').hidden=!loading;
      status.querySelector('span:last-of-type').textContent=error?`Preview unavailable: ${error.message}. You can retry or download this plate.`:`Drawing plate ${number}…`;
      $('[data-preview-retry]').hidden=!error;
      $('[data-prepared-top]').disabled=$('[data-prepared-reset]').disabled=loading||Boolean(error)||!preview?.ok;
      canvas.hidden=loading||Boolean(error)||!preview?.ok;img.hidden=true;
      if(result?.soup){preview.setPlate(job.layout);preview.setSoup(result.soup.positions,result.soup.colors);preview.setPickRanges([]);preview.resize();root.dataset.parts=String(job.count);}
      if(result?.image){if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([result.image],{type:'image/png'}));img.src=url;img.hidden=false;caption.textContent+=' · Static preview';root.dataset.parts=String(job.count);}
      if(loading||error)delete root.dataset.parts;
      onSelect(job.id);
    },
    clear(){root.hidden=true;delete view.stage.dataset.prepared;onSelect(null);},
  });
  picker.addEventListener('change',()=>session.select(picker.value));
  $('[data-preview-retry]').addEventListener('click',()=>session.select(session.selected));
  $('[data-edit-model]').addEventListener('click',()=>{session.close();edit?.();});
  $('[data-prepared-top]').addEventListener('click',()=>{if(!preview?.ok)return;preview.view=preview.view==='top'?'plate':'top';preview.reset();$('[data-prepared-top]').setAttribute('aria-pressed',String(preview.view==='top'));});
  $('[data-prepared-reset]').addEventListener('click',()=>preview?.reset());
  return {
    get active(){return session.active;},
    present:bundle=>session.present(bundle),select:id=>session.select(id),close:()=>session.close(),resume:()=>session.resume(),
    reset(){session.reset();cache.clear();lastContext=null;currentJob=null;preview?.setSoup(null,null);if(url){URL.revokeObjectURL(url);url=null;}},
    theme(){if(preview&&currentJob){preview.plateKey='';preview.setPlate(currentJob.layout);preview.requestDraw();}},
    key(event){
      if(!session.active||event.target?.closest?.('input,select,textarea,[contenteditable=true]'))return false;
      if(event.key==='Escape'){event.preventDefault();session.close();edit?.();return true;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){session.close();return false;}
      if(event.key==='Delete'||(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();caption.textContent='Choose Edit model to select or remove parts. These are prepared print layouts.';return true;}
      return false;
    },
  };
}
