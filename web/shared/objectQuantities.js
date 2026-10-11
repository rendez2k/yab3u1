const esc = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Source filament IDs, never merely similar RGB values. Unknown paint cannot
// be offered as a confirmed single-colour object.
export function objectGroup(object) {
  if (object.undecodable || !object.colours?.length) return 'unknown';
  return object.colours.length === 1 ? `filament:${object.colours[0].extruder}` : 'multi';
}
export function groupQuantities(objects, quantities, group, action) {
  return Object.fromEntries(objects.map(object => {
    const id=String(object.objectId), count=quantities[id] ?? 1;
    const match=group==='all' || objectGroup(object)===group;
    return [id, action==='restore' ? 1 : action==='only' ? (match ? count || 1 : 0) : match ? 0 : count];
  }));
}
const safeColour = value => /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080';

/** Turn a set multiplier into explicit quantities before editing one copy. */
export function editObjectCopy(objects,quantities,copies,objectId,action) {
  if(!['duplicate','remove'].includes(action)||!objects.some(o=>String(o.objectId)===String(objectId)))throw Error('Select an object first.');
  if(!Number.isInteger(copies)||copies<1)throw Error('Choose a valid copy count first.');
  const next=Object.fromEntries(objects.map(o=>[o.objectId,(quantities[o.objectId]??1)*copies]));
  if(!(next[objectId]>0))throw Error('This object is no longer on the plate.');
  next[objectId]+=action==='duplicate'?1:-1;
  if(Object.values(next).some(n=>!Number.isInteger(n)||n<0||n>64))throw Error('Direct editing supports up to 64 copies of each object. Reduce the plate copy count first.');
  return {quantities:next,copies:1,arrangement:'objects'};
}

/** Shared object controls for the converter and Full Spectrum. */
export function quantityRows(objects, quantities = {}) {
  const groups = new Map([['all','All objects']]);
  for (const object of objects) {
    const group=objectGroup(object);
    if(group==='unknown') continue;
    groups.set(group,group==='multi' ? 'Multicoloured objects' : `Only filament ${object.colours[0].extruder} · ${object.colours[0].color}`);
  }
  const toolbar = `<div class="object-group-tools"><label>Source colour group<select data-object-group>${[...groups].map(([key,label])=>`<option value="${esc(key)}">${esc(label)}</option>`).join('')}</select></label><div class="quantity-actions"><button type="button" data-group-action="remove">Remove group</button><button type="button" data-group-action="only">Keep only group</button><button type="button" data-group-action="restore">Restore all</button><button type="button" data-group-action="undo" hidden>Undo group change</button></div><p class="hint">Source paint only. Supports, blends and repainting can use additional filaments. Keep a group to export it separately, then undo to return to the other parts.</p><p class="hint" data-group-status role="status"></p></div>`;
  return `<details class="object-groups"><summary>Manage by source colour</summary>${toolbar}</details>` + objects.map(f => {
    const count = quantities[f.objectId] ?? 1;
    const name = esc(f.name);
    const colours=(f.colours||[]).map(c=>`<span class="object-swatch" style="background:${safeColour(c.color)}" title="Source filament ${esc(c.extruder)} · ${esc(c.color)}"></span>`).join('');
    const size=f.bounds ? f.bounds.max.map((n,i)=>(n-f.bounds.min[i]).toFixed(1)).join(' × ')+' mm' : '';
    const description=`<small class="object-colours">${colours}${f.undecodable ? 'Unknown paint' : `${f.colours?.length || '?'} source colour(s)`}${size ? ` · ${size}` : ''}</small>`;
    return `<div class="object-quantity"><span>${name}${f.instances > 1 ? ` <small>· ${f.instances} linked instances</small>` : ''}${description}</span><div class="quantity-actions"><input aria-label="Quantity for ${name}" data-object="${esc(f.objectId)}" type="number" min="0" max="64" step="1" value="${count}"><button type="button" data-quantity="add" aria-label="Add copy of ${name}">Add copy</button><button type="button" data-quantity="remove" aria-label="Remove ${name}">Remove</button><button type="button" data-quantity="restore" aria-label="Restore ${name}"${count !== 0 ? ' hidden' : ''}>Restore</button></div></div>`;
  }).join('');
}

export function syncQuantityButtons(host) {
  host.querySelectorAll('.object-quantity').forEach(row => {
    const count = Number(row.querySelector('input').value);
    row.querySelector('[data-quantity="restore"]').hidden = count !== 0;
    row.querySelector('[data-quantity="remove"]').hidden = count === 0;
    row.querySelector('[data-quantity="add"]').disabled = count >= 64;
  });
}
export function bindQuantityButtons(host, groups = null) {
  let previous=null, previousKey=null;
  const syncGroup = () => {
    const undo=host.querySelector('[data-group-action="undo"]');
    if(undo) undo.hidden=!previous || previousKey!==groups?.key();
  };
  host.addEventListener('click', event => {
    const button=event.target.closest('[data-group-action]');
    if(!button || !groups)return;
    const action=button.dataset.groupAction;
    if(action==='undo') {
      if(previous && previousKey===groups.key()) { const restore=previous;previous=null;groups.write(restore); }
    } else {
      previous={...groups.read()};previousKey=groups.key();
      groups.write(groupQuantities(groups.objects(),previous,host.querySelector('[data-object-group]').value,action));
    }
    syncGroup();
    const status=host.querySelector('[data-group-status]');
    if(status)status.textContent=action==='undo' ? 'Restored the previous object quantities.' : 'Object quantities updated. Fill plate repeats the remaining set; check quantities of matching parts.';
  });
  const sync = () => syncQuantityButtons(host);
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-quantity]');
    if (!button) return;
    const input = button.closest('.object-quantity').querySelector('input');
    input.value = button.dataset.quantity === 'remove' ? 0 : button.dataset.quantity === 'restore' ? 1 : Math.min(64, (Number(input.value) || 0) + 1);
    input.dispatchEvent(new Event('input', {bubbles:true}));
    sync();
  });
  host.addEventListener('input', sync);
  new MutationObserver(()=>{sync();syncGroup();}).observe(host, {childList:true});
}
