import {colourLabel} from './shared/assignment.js';
export function mountFilamentTools(host,session) {
  const box=host.ownerDocument.createElement('section');box.className='filament-tools';
  box.innerHTML='<h2>Filaments on this plate</h2><p data-filament-count></p><div data-filament-list></div><div data-replace hidden><label>Replace every painted region using this filament with<select data-replacement></select></label><button data-confirm>Replace & remove filament</button><button data-cancel>Cancel</button></div><button data-undo hidden>Undo filament removal</button><p data-filament-status role="status">Unused filaments are removed automatically when their last object leaves the plate.</p>';
  host.prepend(box);const $=q=>box.querySelector(q);let stamp='',from=null,undo=null;
  function entries(){if(!session.state)return [];const ids=session.activeColourIds();return [...new Set(ids.map(id=>session.assignmentMode==='slots'?id:session.rule[id]||id))];}
  function sync(){
    const state=session.state;box.hidden=!state;if(!state)return;
    const ids=entries(),key=JSON.stringify([session.epoch,ids,session.rule,session.state.includeUnused]);if(key===stamp)return;stamp=key;
    $('[data-filament-count]').textContent=`${ids.length} model filament${ids.length===1?'':'s'}${session.supportInterface?' + PETG interface':''}. Removing a used filament replaces its paint; objects stay on the plate.`;
    const list=$('[data-filament-list]');list.replaceChildren();
    ids.forEach(id=>{const row=host.ownerDocument.createElement('div');row.className='filament-row';const label=host.ownerDocument.createElement('span');label.textContent=colourLabel(state.colours[id-1]);const swatch=host.ownerDocument.createElement('i');swatch.style.background=state.colours[id-1];swatch.setAttribute('aria-hidden','true');const b=host.ownerDocument.createElement('button');b.textContent='Remove filament';b.dataset.removeFilament=id;b.disabled=ids.length<2||session.busy;row.append(swatch,label,b);list.append(row);});
    if(from&&!ids.includes(from)){from=null;$('[data-replace]').hidden=true;}
    $('[data-undo]').hidden=!undo||undo.epoch!==session.epoch||undo.after!==JSON.stringify(session.rules);
  }
  box.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    try{
      if(b.dataset.removeFilament){from=Number(b.dataset.removeFilament);const select=$('[data-replacement]');select.replaceChildren(new Option('Choose replacement colour',''));entries().filter(id=>id!==from).forEach(id=>select.add(new Option(colourLabel(session.state.colours[id-1]),String(id))));$('[data-replace]').hidden=false;select.focus();}
      if(b.hasAttribute('data-cancel')){$('[data-replace]').hidden=true;from=null;}
      if(b.hasAttribute('data-confirm')){const to=Number($('[data-replacement]').value);const before={rules:structuredClone(session.rules),mode:session.assignmentMode,epoch:session.epoch};session.removeFilament(from,to);undo={...before,after:JSON.stringify(session.rules)};$('[data-filament-status]').textContent=`Replaced ${colourLabel(session.state.colours[from-1])} with ${colourLabel(session.state.colours[to-1])}. The export uses ${entries().length} model filaments.`;from=null;$('[data-replace]').hidden=true;}
      if(b.hasAttribute('data-undo')&&undo?.epoch===session.epoch&&undo.after===JSON.stringify(session.rules)){session.rules=undo.rules;session.assignmentMode=undo.mode;session.invalidate();session.hooks.mode?.(session.assignmentMode);session.hooks.rule?.(session.rule);session.hooks.settings?.();undo=null;$('[data-filament-status]').textContent='Restored the previous filaments and painting.';}
    }catch(error){$('[data-filament-status]').textContent=error.message;}
    stamp='';sync();
  });return {sync};
}
