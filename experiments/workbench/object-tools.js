import {editCopies,fillObject} from './object-edits.js';
import {planLayout} from './shared/layout.js';
const signature=s=>JSON.stringify([s.key,s.copies,s.quantities,s.layout]);
export function mountWorkbenchObjects(host,getState) {
  const doc=host.ownerDocument,bar=doc.createElement('section');bar.className='workbench-object-tools';
  bar.setAttribute('aria-label','Edit selected object');
  bar.innerHTML='<label>Selected object<select data-object-choice aria-label="Object to duplicate or remove"><option value="">Click an object or choose here</option></select></label><span data-total></span><div class="object-edit-row"><label>New copies<input data-add-count type="number" value="1" min="1" max="64" step="1"></label><button data-object-edit="add">Add copies</button><button data-object-edit="fill">Fill with this object</button><button data-object-edit="remove">Remove one</button><button data-object-edit="undo">Undo</button></div><p data-object-message role="status">Select an object to add copies. Other object quantities stay unchanged.</p>';
  host.append(bar);
  const $=q=>bar.querySelector(q),select=$('[data-object-choice]'),message=$('[data-object-message]');
  let id='',key='',list='',lastRange=null,previous=null,after='',working=false;
  function sync() {
    const s=getState();
    if(s.key!==key){key=s.key;id='';previous=null;lastRange=null;message.textContent='Select an object to add copies. Other object quantities stay unchanged.';}
    const catalogue=JSON.stringify(s.objects.map(o=>[o.objectId,o.name]));
    if(catalogue!==list){list=catalogue;select.replaceChildren(new Option('Click an object or choose here',''));for(const o of s.objects)select.add(new Option(o.name||String(o.objectId),String(o.objectId)));}
    const range=s.preview?.pickRanges[s.preview.selectedRange];
    if(range&&range!==lastRange){id=String(range.objectId);lastRange=range;}
    select.value=id;
    const object=s.objects.find(o=>String(o.objectId)===id),count=object?(s.quantities[id]??1)*s.copies:0;
    bar.dataset.selected=String(Boolean(object));
    $('[data-total]').textContent=object?`${count} on plate${object.instances>1?` · each includes ${object.instances} linked source items`:''}`:'';
    for(const b of bar.querySelectorAll('button'))b.disabled=working||s.busy||(!object&&b.dataset.objectEdit!=='undo');
    $('[data-object-edit="remove"]').disabled=working||s.busy||!count;
    $('[data-object-edit="undo"]').disabled=working||s.busy||!previous||signature(s)!==after;
    select.disabled=working||s.busy;$('[data-add-count]').disabled=working||s.busy;
  }
  select.addEventListener('change',()=>{id=select.value;const p=getState().preview;if(p){p.selectRange(p.pickRanges.findIndex(r=>String(r.objectId)===id));lastRange=p.pickRanges[p.selectedRange];}sync();});
  bar.addEventListener('click',async event=>{
    const action=event.target.closest('[data-object-edit]')?.dataset.objectEdit;if(!action||working)return;
    let s;
    try {
      s=getState();if(s.busy)throw Error('Wait for the model to finish loading.');
      if(action==='undo') {if(!previous||signature(s)!==after)throw Error('The plate changed after this edit.');s.apply(previous);previous=null;message.textContent='Restored the previous quantities.';return;}
      const amount=Number($('[data-add-count]').value);
      if(action==='add'&&(!Number.isInteger(amount)||amount<1))throw Error('Enter how many new copies to add, from 1 to 64.');
      const stamp=signature(s),before={copies:s.copies,quantities:{...s.quantities},arrangement:s.arrangement};
      let patch,added=amount,limit=false;
      if(action==='fill') {
        working=true;bar.setAttribute('aria-busy','true');message.textContent='Finding room for the selected object…';sync();
        const result=await fillObject(s,id,planLayout,async()=>{await new Promise(resolve=>setTimeout(resolve,0));if(signature(getState())!==stamp)throw Error('The plate changed. Try filling again.');});
        ({patch,added,limit}=result);
        if(!patch){message.textContent=limit?'This object has reached the 64-copy limit.':'No additional copy fits this packing plan. Try reducing spacing or removing another object.';return;}
      }else patch=editCopies(s,id,action==='remove'?-1:amount);
      previous=before;s.apply(patch);after=signature(getState());
      message.textContent=action==='remove'?'Removed one copy. Other quantities are unchanged.':`Added ${added} new ${added===1?'copy':'copies'}; ${patch.quantities[id]} now on plate. Other quantities are unchanged.${action==='fill'?' Objects were repacked using the current spacing and reserved areas.':''}${limit?' Reached the 64-copy limit.':''}`;
    }catch(error){message.textContent=error.message;}finally{working=false;bar.setAttribute('aria-busy','false');sync();}
  });
  return {sync};
}
