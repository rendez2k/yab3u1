import {FILAMENT_BUNDLES,CATALOGUE_REVISION,BAMBU_PALETTE_SWATCH_SOURCE,bundleFit,validateBundle,selectBundleReels,smallerBundleOptions,compatibleBundleOptions} from './filamentBundles.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='yab3d-filament-sets-v1';
export function mountBundlePanel(host,{getState,compare,chooseSource,changeCapacity,changePriority,ownedChanged,printComparison}) {
  let custom=[],owned=[],selected=[];
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');custom=(saved.custom||[]).slice(0,40).map(validateBundle);owned=(saved.owned||[]).filter(x=>typeof x==='string').slice(0,100);}catch{/* Damaged saved data never applies. */}
  host.innerHTML=`<div class="palette-source" role="group" aria-label="Choose your filament colours"><button type="button" data-start="model" title="Suggest colours from the model">Suggest</button><button type="button" data-start="loaded" title="Use my own reels">My reels</button><button type="button" data-start="bundle" title="Choose a filament pack">Packs</button></div>
    <div data-custom-colours></div>
    <label class="field bundle-capacity">Physical inputs available<select data-capacity></select></label>
    <p class="hint" data-capacity-note></p>
    <div data-pack-controls hidden>
      <h3 class="bundle-step">1 · Pick a pack</h3>
      <div class="bundle-cards" data-cards role="radiogroup" aria-label="Filament pack"></div>
      <label class="field" hidden>Filament set<select data-bundle><option value="">Choose a filament set…</option></select></label>
      <div data-set hidden>
        <h3 class="bundle-step">2 · Choose its reels</h3>
        <p class="hint" data-pack-purpose>Choose the reels to compare. Apply a result to change your palette.</p>
        <div class="bundle-reel-options" data-swatches role="group" aria-label="Reels to include"></div>
        <p class="bundle-fit" data-fit role="status"></p>
        <div class="bundle-actions"><button type="button" class="primary" data-use>Preview on the model</button><button type="button" data-restore hidden>Include all reels</button></div>
        <details class="bundle-more"><summary>More options</summary>
          <button type="button" data-smaller></button>
          <button type="button" data-print-comparison>Print a layer / wall comparison…</button>
          <p class="hint" data-description></p><label class="check"><input type="checkbox" data-owned>I own this set</label>
        </details>
      </div>
      <details class="bundle-compare"><summary>Not sure? Compare packs for this model</summary>
        <label class="field">Compare for<select data-priority><option value="colour">Closest predicted colours</option><option value="changes">Fewer blend recipes</option><option value="owned">Filaments I own</option></select></label>
        <button type="button" data-compare>Compare compatible packs</button>
        <p class="hint">Smaller subsets are included when a pack has too many reels. Each result names the reels left out. Fewer recipes is not a print-time estimate.</p>
      </details>
      <p class="hint">Display swatches are published or nominal colours. Unmeasured blends cannot establish which brand prints more accurately.</p>
    </div>
    <button type="button" data-source hidden>Preview this project's saved reels</button>
    <details data-collection hidden><summary>Save or import my own set</summary><label class="field">Set name<input data-name maxlength="120" placeholder="My loaded reels"></label>
      <div class="row"><button type="button" data-save>Save current reels</button><button type="button" data-backup>Export current reels</button></div>
      <label class="field">Import filament set JSON<input data-import type="file" accept=".json,application/json"></label>
      <p class="hint">Saved on this device. Export JSON to keep a backup.</p>
    </details>
    <p class="hint" role="status" aria-live="polite" data-status></p>`;
  const $=q=>host.querySelector(q),status=s=>$('[data-status]').textContent=s;
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify({custom,owned}));}catch{status('Browser storage is unavailable. Export your set to keep it.');}};
  const sets=()=>[...FILAMENT_BUNDLES,...custom],currentBundle=()=>sets().find(b=>b.id===$('[data-bundle]').value);
  const ownStock=()=>sets().filter(b=>owned.includes(b.id)).flatMap(b=>b.reels);
  $('[data-print-comparison]').onclick=()=>printComparison?.(currentBundle()?.id);
  function options(){const value=$('[data-bundle]').value;$('[data-bundle]').innerHTML='<option value="">Choose a filament set…</option>'+sets().map(b=>`<option value="${esc(b.id)}">${esc(b.brand?b.brand+' · ':'')}${esc(b.name)} · ${b.reels.length} reels${b.application==='backlit'?' · backlit':''}</option>`).join('');$('[data-bundle]').value=value;cards();}
  const short=(reel,brand)=>brand&&reel.name.startsWith(brand+' ')?reel.name.slice(brand.length+1):reel.name;
  // Packs as a pick-list: the name is readable in full and the colours are visible before choosing.
  function cards(){
    const value=$('[data-bundle]').value;
    $('[data-cards]').innerHTML=sets().map(b=>`<button type="button" role="radio" aria-checked="${b.id===value}" data-card="${esc(b.id)}"><span class="bundle-card-copy"><small>${esc(b.brand||'My set')}${b.application==='backlit'?' · backlit':''}</small><strong>${esc(b.name)}</strong></span><span class="bundle-dots" aria-hidden="true">${b.reels.slice(0,8).map(r=>`<i style="background:${esc(r.color)}"></i>`).join('')}</span></button>`).join('');
    $('[data-cards]').querySelectorAll('[data-card]').forEach(card=>card.onclick=()=>{$('[data-bundle]').value=card.dataset.card;$('[data-bundle]').onchange();$(`[data-card="${CSS.escape(card.dataset.card)}"]`)?.focus();});
  }
  // Choosing a pack or changing its reels previews straight away when the reels fit the printer.
  function autoPreview(){const s=getState(),bundle=currentBundle();if(!bundle||!selected.length)return;try{const chosen=selectBundleReels(bundle,selected);if(bundleFit(chosen,s.capacity,s.supportInterface).fits)preview([chosen]);}catch(e){status(e.message);}}
  function resetSelection(){selected=currentBundle()?.reels.map((_,i)=>i)||[];render();}
  function render(){
    const s=getState(),max=s.target==='bambu'?24:s.target==='snapmaker'?4:16,source=s.paletteSource||s.workflow||'model';
    host.querySelectorAll('[data-start]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.start===source)));$('[data-pack-controls]').hidden=source!=='bundle';$('[data-collection]').hidden=source==='model';
    $('[data-capacity]').innerHTML=Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1} input${i?'s':''}</option>`).join('');
    $('[data-capacity]').value=s.capacity;$('[data-capacity]').disabled=Boolean(s.supportInterface);$('[data-priority]').value=s.priority;
    const saved=s.project?.colourPlan?.reels?.filter(r=>r.role!=='support-interface');
    $('[data-source]').hidden=!saved?.length||source==='model';$('[data-source]').disabled=Boolean(saved&&!bundleFit({reels:saved},s.capacity,s.supportInterface).fits);
    $('[data-capacity-note]').textContent=`${s.capacity-(s.supportInterface?1:0)} inputs for model colours${s.supportInterface?' + 1 for PETG':''}. Blended shades do not need extra inputs.${s.target==='bambu'?' Match the printer and AMS units you have.':''}`;
    const b=currentBundle();$('[data-set]').hidden=!b;if(!b)return;
    $('[data-print-comparison]').hidden=!printComparison||!['elegoo-rilievo','esun-pla-plus-cmyk','snapmaker-white'].includes(b.id);
    $('[data-pack-purpose]').textContent=b.application==='backlit'?'This pack is made for backlit lithophanes. You can try it on this model, but the preview uses unmeasured blends, not a calibrated prediction for this pack.':'Choose the reels to compare. Apply a result to change your palette.';
    const signature=JSON.stringify([b.id,selected]);
    if($('[data-swatches]').dataset.signature!==signature){
      $('[data-swatches]').dataset.signature=signature;
      $('[data-swatches]').innerHTML=b.reels.map((r,i)=>`<label class="bundle-reel" title="${esc(r.name)} · ${esc(r.color)}${r.opticalClass&&r.opticalClass!=='unknown'?' · '+esc(r.opticalClass):''}"><input type="checkbox" data-reel="${i}" ${selected.includes(i)?'checked':''}><i class="swatch" style="background:${esc(r.color)}" aria-hidden="true"></i><span>${esc(short(r,b.brand))}</span></label>`).join('');
      $('[data-swatches]').querySelectorAll('[data-reel]').forEach(box=>box.onchange=()=>{selected=[...$('[data-swatches]').querySelectorAll('[data-reel]')].filter(n=>n.checked).map(n=>Number(n.dataset.reel));render();$(`[data-reel="${box.dataset.reel}"]`)?.focus();status('');autoPreview();});
    }
    const fit=bundleFit({reels:selected},s.capacity,s.supportInterface);
    $('[data-use]').disabled=!selected.length||!fit.fits;
    $('[data-fit]').textContent=!selected.length?'Select at least one reel.':fit.reason||`${selected.length} reel${selected.length===1?'':'s'} selected${b.reels.length>selected.length?` · ${b.reels.length-selected.length} left out`:''}. The model shows the result; choose Apply palette to keep it.${s.capacity-(s.supportInterface?1:0)<=4&&selected.length>=4?' Four reels leave room for cyan, magenta, yellow and one neutral, so a model with both black and white areas will lose one of them.':''}`;
    for(const card of $('[data-cards]').querySelectorAll('[data-card]'))card.setAttribute('aria-checked',String(card.dataset.card===b.id));
    const count=Math.min(fit.available,selected.length-1);$('[data-smaller]').hidden=count<1;$('[data-smaller]').textContent=`Compare ${count}-reel options`;$('[data-smaller]').dataset.count=count;
    $('[data-restore]').hidden=selected.length===b.reels.length;$('[data-owned]').checked=owned.includes(b.id);
    $('[data-description]').textContent=`${b.kind==='retail'?'Manufacturer bundle':b.kind==='custom'?'Your saved set':'Selected product combination'} · ${b.note}`;
    if(b.source){const a=document.createElement('a');a.href=b.source;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Product source';$('[data-description]').append(' ',a);}
    if(b.id.startsWith('bambu-palette-')){const a=document.createElement('a');a.href=BAMBU_PALETTE_SWATCH_SOURCE;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Official colour swatches';$('[data-description]').append(' · ',a);}
  }
  function preview(candidates){if(!candidates.length){status('No matching packs. Choose more inputs, mark a pack as owned, or select reels manually.');return;}compare(candidates.map(b=>b.application==='backlit'?{...b,allowModelPreview:true}:b));status('Comparing colours on the model. Your applied reels stay unchanged until you apply a result.');render();}
  function selectSource(source){chooseSource(source);status('');render();}
  host.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>selectSource(b.dataset.start));
  $('[data-bundle]').onchange=()=>{status('');resetSelection();autoPreview();};$('[data-restore]').onclick=()=>{resetSelection();autoPreview();};
  $('[data-source]').onclick=()=>{const reels=getState().project?.colourPlan?.reels?.filter(r=>r.role!=='support-interface');if(reels?.length)preview([{id:'saved-project',name:'Saved project reels',reels,application:'model'}]);};
  $('[data-capacity]').onchange=()=>{changeCapacity(Number($('[data-capacity]').value));render();};$('[data-priority]').onchange=()=>changePriority($('[data-priority]').value);
  $('[data-owned]').onchange=()=>{const id=$('[data-bundle]').value;owned=owned.filter(x=>x!==id);if($('[data-owned]').checked)owned.push(id);persist();ownedChanged(ownStock());};
  $('[data-use]').onclick=()=>{try{const s=getState(),b=selectBundleReels(currentBundle(),selected),fit=bundleFit(b,s.capacity,s.supportInterface);if(!fit.fits)throw Error(fit.reason);preview([b]);}catch(e){status(e.message);}};
  $('[data-smaller]').onclick=()=>{try{preview(smallerBundleOptions(selectBundleReels(currentBundle(),selected),Number($('[data-smaller]').dataset.count)));}catch(e){status(e.message);}};
  $('[data-compare]').onclick=()=>{const s=getState();preview(compatibleBundleOptions(sets().filter(b=>s.priority!=='owned'||owned.includes(b.id)),s.capacity,s.supportInterface));};
  function current(){return validateBundle({id:'custom-'+Date.now(),name:$('[data-name]').value.trim()||'My loaded reels',reels:getState().reels.filter(r=>r.role!=='support-interface')});}
  $('[data-save]').onclick=()=>{try{const b=current();custom=[...custom.filter(x=>x.name!==b.name),b].slice(-40);owned.push(b.id);persist();options();$('[data-bundle]').value=b.id;ownedChanged(ownStock());resetSelection();status('Filament set saved on this device.');}catch(e){status(e.message);}};
  $('[data-backup]').onclick=()=>{try{const value={...current(),catalogueRevision:CATALOGUE_REVISION};const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='yab3d-filament-set.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message);}};
  $('[data-import]').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>65536)throw Error('Filament set must be smaller than 64 KB.');const b=validateBundle(JSON.parse(await file.text()));b.id='custom-'+Date.now();custom=[...custom,b].slice(-40);persist();options();$('[data-bundle]').value=b.id;chooseSource('bundle');resetSelection();status('Set imported. Preview its reels before applying.');}catch(e){status(e.message);}finally{event.target.value='';}};
  const customControls=host.ownerDocument.getElementById('loadedcontrols');if(customControls)$('[data-custom-colours]').append(customControls);
  options();render();ownedChanged(ownStock());return {render,selectSource};
}
