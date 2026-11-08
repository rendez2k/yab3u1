// Inspector and temporary highlighting for geometric part selection.
const cache=new WeakMap();
export function mountShapeTool({root,make,state,source,context,ids,preview,changed,message,palette,busy=()=>false}){
  root.innerHTML='<p class="hint">Find regions from the shape, even when they share a colour. Review the highlight before changing the model.</p><div class="shape-detection"><label class="studio-field">Detection detail<select data-shape-detail><option value="coarse">Fewer parts</option><option value="balanced">Balanced</option><option value="fine">More parts</option></select></label><button data-shape-detect>Detect parts</button></div><div data-shape-result hidden><div class="shape-selection-heading"><strong data-shape-count></strong><button data-shape-clear>Clear</button></div><p class="hint">Click a region on the model. Shift/Ctrl adds or removes it; the buttons below work with touch too.</p><div class="shape-region-list" aria-label="Detected shape regions" data-shape-list></div><button data-shape-undo>Undo selection</button><label class="studio-field">With the selected regions<select data-shape-action><option value="shape-separate">Separate from the body</option><option value="shape-colour">Recolour selection</option></select></label><div data-shape-paint hidden><label class="studio-field">Filament colour<input type="color" data-shape-colour aria-label="Shape filament colour"></label><div class="studio-swatches" data-shape-swatches></div></div><p class="hint" data-shape-help>Selected regions are combined for the edit. A curved or flat surface patch may be suitable for colouring only.</p></div>';
  const q=s=>root.querySelector(s);let result=null,chosen=new Set(),history=[],pending=false,request=0,worker=null,positions=null,range=null,previousPick=null,attachedPreview=null,dead=false;
  const detail=()=>q('[data-shape-detail]').value;
  const action=()=>q('[data-shape-action]').value;
  q('[data-shape-list]').before(q('[data-shape-action]').closest('label'));
  q('[data-shape-colour]').value=palette()[0]||'#246B50';
  for(const c of palette()){const b=make('button',{'data-shape-swatch':c,'aria-label':`Use ${c}`});b.style.setProperty('--swatch',c);q('[data-shape-swatches]').append(b);}
  function select(next){history.push([...chosen]);if(history.length>30)history.shift();chosen=next;sync();preview();changed();}
  function pick({triangle,event}){
    if(dead||busy()||pending||!result||!range)return true;
    const index=triangle-range.start/3,label=result.previewRegions[index];
    if(label===undefined||label<0)return true;
    const next=event.shiftKey||event.ctrlKey||event.metaKey?new Set(chosen):new Set();
    if(next.has(label))next.delete(label);else next.add(label);select(next);return true;
  }
  async function detect(){
    if(dead||busy())return;
    const s=state(),file=source(),objectIds=ids();if(!file||objectIds.length!==1){message.textContent='Select one object before detecting shape regions.';return;}
    const p=s.preview;range=p?.pickRanges?.find(r=>String(r.objectId)===objectIds[0]);
    if(!range||!p.lastPositions){message.textContent='Wait for the model preview, then detect again.';return;}
    const hints=result?[...chosen].map(label=>result.previewRegions.indexOf(label)).filter(i=>i>=0):[];
    const stamp=++request;worker?.terminate();pending=true;result=null;chosen.clear();history=[];positions=p.lastPositions;sync();changed();preview();
    message.textContent='Finding shape regions… You can cancel while this runs.';
    const key=`${context().plateId}|${objectIds[0]}|${detail()}`;
    try{
      let saved=cache.get(file);if(!saved){saved=new Map();cache.set(file,saved);}
      const hit=saved.get(key);
      if(hit?.positions===positions)result=hit.result;
      else{
        const bytes=await file.arrayBuffer();if(stamp!==request)return;
        const data=await new Promise((resolve,reject)=>{
          worker=new Worker(new URL('./model-edit-worker.js',import.meta.url),{type:'module'});
          worker.onmessage=({data})=>{if(stamp!==request)return;if(data.progress){message.textContent=data.progress;return;}data.error?reject(Error(data.error)):resolve(data);};
          worker.onerror=()=>reject(Error('Shape detection stopped. Try Fewer parts or a smaller object.'));
          worker.postMessage({bytes,options:{operation:'inspect-shapes',plateId:context().plateId,objectIds,detail:detail(),previewPositions:positions.slice(range.start*3,(range.start+range.count)*3)}},[bytes]);
        });
        if(stamp!==request)return;result=data;saved.set(key,{positions,result});if(saved.size>3)saved.delete(saved.keys().next().value);
      }
      if(stamp!==request)return;
      for(const i of hints){const label=result.previewRegions[i];if(label>=0)chosen.add(label);}
      if(!attachedPreview){previousPick=p.onRegionPick;attachedPreview=p;}p.onRegionPick=pick;
      message.textContent=result.regions.length===1?'One region found. Try More parts or a plane cut.':'Choose regions, then separate or recolour. Your model is unchanged until Apply.';
      const list=q('[data-shape-list]');list.replaceChildren();
      result.regions.forEach((r,i)=>{const b=make('button',{'data-shape-region':String(i),'aria-pressed':'false'});b.append(make('span',{},`Region ${i+1}`),make('span',{class:'shape-size'},r.size.map(n=>n.toFixed(1)).join(' × ')+' mm'));list.append(b);});
    }catch(e){if(stamp===request)message.textContent=e.message;}
    finally{if(stamp===request){worker?.terminate();worker=null;pending=false;sync();preview();changed();}}
  }
  function sync(){
    if(dead)return;
    if(result&&state().preview?.lastPositions!==positions){result=null;chosen.clear();history=[];if(attachedPreview?.onRegionPick===pick)attachedPreview.onRegionPick=previousPick;attachedPreview=null;message.textContent='The preview changed. Detect parts again to update the selection.';}
    const locked=pending||state().busy||busy();
    q('[data-shape-result]').hidden=!result;
    q('[data-shape-count]').textContent=`${chosen.size} of ${result?.regions.length||0} selected`;
    for(const b of root.querySelectorAll('[data-shape-region]')){b.setAttribute('aria-pressed',String(chosen.has(Number(b.dataset.shapeRegion))));b.disabled=locked;}
    q('[data-shape-undo]').disabled=locked||!history.length;q('[data-shape-clear]').disabled=locked||!chosen.size;
    q('[data-shape-detect]').disabled=locked;q('[data-shape-detect]').textContent=pending?'Detecting…':result?'Detect again':'Detect parts';
    q('[data-shape-detail]').disabled=locked;q('[data-shape-action]').disabled=locked;
    q('[data-shape-paint]').hidden=action()!=='shape-colour';
    q('[data-shape-help]').textContent=action()==='shape-colour'?'Preview only until Apply. The selected regions will use this filament; Undo restores their original paint.':'Selected regions are combined for the edit. The join is checked before separation; curved seams and flat patches may need a plane cut. Highlighting follows the simplified preview.';
  }
  function paint(colours,source){
    if(!result||!range||!colours||dead)return;
    const hex=q('[data-shape-colour]').value,rgb=action()==='shape-colour'?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255):[.12,.62,.41];
    for(let f=0;f<result.previewRegions.length;f++)for(let v=0;v<9;v++){
      const at=range.start*3+f*9+v;
      colours[at]=chosen.has(result.previewRegions[f])?rgb[v%3]:source[at]*.3+.5;
    }
  }
  function destroy(){if(dead)return;dead=true;request++;worker?.terminate();worker=null;pending=false;if(attachedPreview?.onRegionPick===pick)attachedPreview.onRegionPick=previousPick;root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('input',onInput);}
  function undo(){if(history.length&&!pending&&!busy()&&!dead){chosen=new Set(history.pop());sync();preview();changed();}}
  function onClick(e){const b=e.target.closest('button');if(!b||pending||dead||busy())return;
    if(b.matches('[data-shape-detect]'))detect();
    if(b.dataset.shapeRegion!==undefined){const i=Number(b.dataset.shapeRegion),next=new Set(chosen);next.has(i)?next.delete(i):next.add(i);select(next);}
    if(b.matches('[data-shape-clear]'))select(new Set());
    if(b.matches('[data-shape-undo]'))undo();
    if(b.dataset.shapeSwatch){q('[data-shape-colour]').value=b.dataset.shapeSwatch;preview();}
  }
  function onChange(e){if(dead)return;if(e.target.matches('[data-shape-detail]'))detect();else{sync();preview();changed();}}
  function onInput(e){if(!dead&&e.target.matches('[data-shape-colour]'))preview();}
  root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('input',onInput);
  return {destroy,sync,paint,undo,get canUndo(){return !dead&&!pending&&history.length>0;},get pending(){return pending;},get ready(){return !dead&&!pending&&Boolean(result)&&chosen.size>0;},get painting(){return action()==='shape-colour';},get label(){return action()==='shape-colour'?'Apply colour':'Separate selection';},options(){return {operation:action(),detail:detail(),shapeIds:[...chosen].map(i=>result.regions[i].id),colour:q('[data-shape-colour]').value};}};
}
