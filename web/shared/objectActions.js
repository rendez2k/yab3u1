import {editObjectCopy} from './objectQuantities.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Same direct manipulation and keyboard fallback on both pages. */
export function mountObjectActions(preview,host,getState,apply) {
  const bar=document.createElement('div');bar.className='preview-object-actions';
  bar.innerHTML='<label>Select an object<select aria-label="Selected object"><option value="">Click an object in the preview</option></select></label><div class="quantity-actions"><button type="button" data-edit="duplicate" disabled>Duplicate</button><button type="button" data-edit="remove" disabled>Remove this copy</button><button type="button" data-edit="undo" disabled>Undo</button></div><p class="hint" role="status">Click to select. Drag to orbit.</p>';
  host.append(bar);
  const select=bar.querySelector('select'),note=bar.querySelector('[role="status"]');
  let previous=null,after='';
  const signature=s=>JSON.stringify([s.key,s.copies,s.quantities]);
  const sync=()=>{
    const s=getState(),range=preview.pickRanges[preview.selectedRange],object=s.objects.find(o=>String(o.objectId)===String(range?.objectId));
    select.value=range?String(preview.selectedRange):'';
    bar.querySelector('[data-edit="duplicate"]').disabled=!object||s.busy;
    bar.querySelector('[data-edit="remove"]').disabled=!object||s.busy;
    bar.querySelector('[data-edit="undo"]').disabled=!previous||signature(s)!==after||s.busy;
    note.textContent=object?`${object.name}${object.instances>1?` · ${object.instances} linked items move together`:''}. Duplicate adds one; Remove removes this copy.`:'Click to select. Drag to orbit.';
  };
  preview.onRangesChange=()=>{
    const s=getState(),seen=new Map();
    select.innerHTML='<option value="">Click an object in the preview</option>'+preview.pickRanges.map((r,i)=>{
      const object=s.objects.find(o=>String(o.objectId)===String(r.objectId));
      const n=(seen.get(r.objectId)||0)+1;seen.set(r.objectId,n);
      return `<option value="${i}">${esc(object?.name||r.objectId)} · copy ${n}</option>`;
    }).join('');sync();
  };
  preview.onSelectionChange=sync;
  select.addEventListener('change',()=>preview.selectRange(select.value===''?-1:Number(select.value)));
  bar.addEventListener('click',event=>{
    const action=event.target.closest('[data-edit]')?.dataset.edit;if(!action)return;
    try{
      const s=getState();if(s.busy)throw Error('Wait for the preview to finish updating.');
      if(action==='undo'){
        if(!previous||signature(s)!==after)throw Error('The plate changed after this edit.');
        apply(previous);previous=null;
      }else{
        const range=preview.pickRanges[preview.selectedRange];if(!range)throw Error('Select an object first.');
        const next=editObjectCopy(s.objects,s.quantities,s.copies,range.objectId,action);
        previous={copies:s.copies,quantities:{...s.quantities},arrangement:s.arrangement};
        apply(next);after=signature(getState());
      }
      preview.selectRange(-1);sync();
      note.textContent=action==='undo'?'Restored the previous object counts.':action==='duplicate'?'Added one copy. Other object counts are unchanged.':'Removed one copy. Other object counts are unchanged.';
    }catch(error){note.textContent=error.message;}
  });
  sync();return {sync};
}
