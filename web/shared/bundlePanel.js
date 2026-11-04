import {FILAMENT_BUNDLES,CATALOGUE_REVISION,bundleFit,bundleReels,validateBundle} from './filamentBundles.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='yab3d-filament-sets-v1';
export function mountBundlePanel(host,{getState,apply,compare,changeCapacity,changePriority,ownedChanged}) {
  let custom=[],owned=[];
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');custom=(saved.custom||[]).slice(0,40).map(validateBundle);owned=(saved.owned||[]).filter(x=>typeof x==='string').slice(0,100);}catch{/* damaged data never applies */}
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify({custom,owned}));}catch{status('Browser storage is unavailable. Export your set to keep it.');}};
  host.innerHTML=`<label class="field bundle-capacity">Physical inputs available<select data-capacity aria-label="Physical inputs available"></select></label>
    <label class="field">Filament set<select data-bundle><option value="">Choose a real filament set…</option></select></label>
    <div data-set hidden><button type="button" class="primary" data-use>Use this set</button><p class="hint" data-fit></p>
    <details class="bundle-details"><summary>Reels and product details</summary><p class="hint" data-description></p><div class="bundle-swatches" data-swatches></div>
    <label class="check"><input type="checkbox" data-owned>I own this set</label></details></div>
    <p class="hint" data-capacity-note></p>
    <button type="button" data-source hidden>Load this project's saved reel products</button>
    <label class="field">Compare for<select data-priority><option value="colour">Closest predicted colours</option><option value="changes">Fewer blend recipes</option><option value="owned">Filaments I own</option></select></label>
    <button type="button" data-compare>Compare filament sets</button>
    <p class="hint">Predictions are estimates until measured. Fewer recipes is a proxy for fewer changes; slice to compare actual print times.</p>
    <details><summary>Save or import my own set</summary><label class="field">Set name<input data-name maxlength="120" placeholder="My loaded reels"></label>
    <div class="row"><button type="button" data-save>Save current reels</button><button type="button" data-backup>Export current reels</button></div>
    <label class="field">Import filament set JSON<input data-import type="file" accept=".json,application/json"></label>
    <p class="hint">Saved here on this device. Imported sets contain product identities and display colours, not executable profiles.</p></details>
    <p class="hint" role="status" aria-live="polite" data-status></p>`;
  const $=q=>host.querySelector(q),status=s=>$('[data-status]').textContent=s;
  const sets=()=>[...FILAMENT_BUNDLES,...custom];
  function options(){const selected=$('[data-bundle]').value;$('[data-bundle]').innerHTML='<option value="">Choose a real filament set…</option>'+sets().map(b=>`<option value="${esc(b.id)}">${esc(b.brand?b.brand+' · ':'')}${esc(b.name)}${b.application==='backlit'?' · backlit':''}</option>`).join('');$('[data-bundle]').value=selected;}
  function ownStock(){return sets().filter(b=>owned.includes(b.id)).flatMap(b=>b.reels);}
  function render(){
    const s=getState(),max=s.target==='bambu'?24:s.target==='snapmaker'?4:16;
    $('[data-capacity]').innerHTML=Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1} input${i?'s':''}</option>`).join('');
    $('[data-capacity]').value=s.capacity;$('[data-priority]').value=s.priority;
    const source=s.project?.colourPlan?.reels?.filter(r=>r.role!=='support-interface');
    $('[data-source]').hidden=!source?.length;
    $('[data-source]').disabled=Boolean(source && !bundleFit({reels:source},s.capacity,s.supportInterface).fits);
    $('[data-capacity-note]').textContent=`${s.capacity} physical input${s.capacity===1?'':'s'}${s.supportInterface?' · 1 reserved for PETG':''}. Blended shades do not use extra inputs. ${s.target==='bambu'?'Match this to the printer and AMS units you have.':''}`;
    const b=sets().find(b=>b.id===$('[data-bundle]').value);$('[data-set]').hidden=!b;
    if(!b)return;
    const fit=bundleFit(b,s.capacity,s.supportInterface);
    $('[data-description]').textContent=`${b.kind==='retail'?'Manufacturer bundle':b.kind==='custom'?'Your saved set':'Selected product combination'} · ${b.note}`;
    $('[data-swatches]').innerHTML=b.reels.map(r=>`<span title="${esc(r.family||'')} ${esc(r.edition||'')}"><i class="swatch" style="background:${r.color}"></i>${esc(r.name)}</span>`).join('');
    $('[data-fit]').textContent=fit.reason||`${b.reels.length} physical reels · unmeasured blends${b.checked?' · catalogue checked '+b.checked:''}`;
    $('[data-use]').disabled=!fit.fits;$('[data-owned]').checked=owned.includes(b.id);
    if(b.source){const a=document.createElement('a');a.href=b.source;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Product source';$('[data-description]').append(' ',a);}
  }
  $('[data-bundle]').onchange=render;
  $('[data-source]').onclick=()=>{try{const s=getState(),source=s.project?.colourPlan?.reels?.filter(r=>r.role!=='support-interface');if(!source)return;apply(bundleReels({reels:source},s.capacity,s.supportInterface?s.reels.find(r=>r.role==='support-interface'):null));status('Saved model reel products loaded. Blend suggestions are recalculated for this model; review before applying.');}catch(e){status(e.message);}};
  $('[data-capacity]').onchange=()=>{changeCapacity(Number($('[data-capacity]').value));render();};
  $('[data-priority]').onchange=()=>changePriority($('[data-priority]').value);
  $('[data-owned]').onchange=()=>{const id=$('[data-bundle]').value;owned=owned.filter(x=>x!==id);if($('[data-owned]').checked)owned.push(id);persist();ownedChanged(ownStock());};
  $('[data-use]').onclick=()=>{try{const s=getState(),b=sets().find(b=>b.id===$('[data-bundle]').value);const reels=bundleReels(b,s.capacity,s.supportInterface?s.reels.find(r=>r.role==='support-interface'):null);apply(reels);status(`${b.name} applied. Review the changed colours before export.`);}catch(e){status(e.message);}render();};
  $('[data-compare]').onclick=()=>{const s=getState(),candidates=sets().filter(b=>bundleFit(b,s.capacity,s.supportInterface).fits&&b.application!=='backlit'&&(s.priority!=='owned'||owned.includes(b.id)));if(!candidates.length){status('No matching sets. Mark a set as owned, choose another priority, or save a smaller custom set.');return;}compare(candidates);status('Comparing compatible sets. Results appear below; your current reels stay unchanged until you apply a result.');};
  function current(){const s=getState();return validateBundle({id:'custom-'+Date.now(),name:$('[data-name]').value.trim()||'My loaded reels',reels:s.reels.filter(r=>r.role!=='support-interface')});}
  $('[data-save]').onclick=()=>{try{const b=current();custom=[...custom.filter(x=>x.name!==b.name),b].slice(-40);owned.push(b.id);persist();options();$('[data-bundle]').value=b.id;ownedChanged(ownStock());render();status('Filament set saved on this device.');}catch(e){status(e.message);}};
  $('[data-backup]').onclick=()=>{try{const value={...current(),catalogueRevision:CATALOGUE_REVISION};const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='yab3d-filament-set.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message);}};
  $('[data-import]').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>65536)throw Error('Filament set must be smaller than 64 KB.');const b=validateBundle(JSON.parse(await file.text()));b.id='custom-'+Date.now();custom=[...custom,b].slice(-40);persist();options();$('[data-bundle]').value=b.id;render();status('Set imported. Choose Use this set to apply it.');}catch(e){status(e.message);}finally{event.target.value='';}};
  options();render();ownedChanged(ownStock());return {render};
}
