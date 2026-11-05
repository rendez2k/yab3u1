import {FILAMENT_BUNDLES} from './filamentBundles.js';
import {wallTestSetup} from './wallComparison.js';

export function mountWallComparison(host) {
  let busy=false,downloadUrl=null;
  const names=['Cyan','Magenta','Yellow','White'];
  host.classList.add('wall-comparison');
  host.innerHTML=`<summary>Compare layer and wall mixing · experimental</summary>
    <p class="hint">Two matching sample plates for your U1: native layer blends and separate outer/inner colours. Test your actual reels before changing a model.</p>
    <label class="field">Test pack<select data-test-pack>${FILAMENT_BUNDLES.filter(b=>['elegoo-rilievo','esun-pla-plus-cmyk','snapmaker-white'].includes(b.id)).map(b=>`<option value="${b.id}">${b.brand} · ${b.name}</option>`).join('')}</select></label>
    <div class="wall-test-slots" role="group" aria-label="Loaded U1 slots">${names.map((n,i)=>`<label class="field">${n}<select data-test-slot="${i}" aria-label="${n} U1 slot">${[1,2,3,4].map(s=>`<option value="${s}" ${s===i+1?'selected':''}>Slot ${s}</option>`).join('')}</select></label>`).join('')}</div>
    <p class="hint">Match these to your loaded slots. Choosing an occupied slot swaps the two colours. The model's palette stays unchanged.</p>
    <div class="wall-test-process"><label class="field">Regular layer height<select data-test-height><option value="0.1">0.10 mm</option><option value="0.08">0.08 mm</option></select></label><p class="hint">U1 · 0.4 mm nozzle</p></div>
    <label class="check"><input type="checkbox" data-test-subdivide checked>Subdivide the native layer blends</label>
    <figure class="wall-test-section"><svg viewBox="0 0 310 110" role="img" aria-label="Example wall cross-section: cyan outer wall, yellow inner wall, and hollow centre. This shows physical materials, not a predicted green."><path d="M18 20H292V90H18Z M34 32V78H276V32Z" fill="#00FFFF" fill-rule="evenodd" stroke="currentColor" stroke-width="1"/><path d="M34 32H276V78H34Z M66 49V61H244V49Z" fill="#FFFF00" fill-rule="evenodd" stroke="currentColor" stroke-width="1"/><text x="155" y="15" text-anchor="middle" fill="currentColor" font-size="12">Outside · cyan</text><text x="155" y="44" text-anchor="middle" fill="#22282c" font-size="12">Inside · yellow</text><text x="155" y="109" text-anchor="middle" fill="currentColor" font-size="12">Hollow centre</text></svg><figcaption class="hint">Physical cross-section, enlarged. Green is the intended optical effect; its appearance with this pack is unmeasured.</figcaption></figure>
    <p class="hint">10 samples per plate: curved walls, flat top tiles, reversed colours, thicker outer walls and pure-colour controls. Both use a white base. Generic PLA temperatures need checking against your reels.</p>
    <button type="button" data-test-download>Download both U1 test plates (.zip)</button>
    <p class="hint" role="status" aria-live="polite" data-test-status></p>
    <a data-test-save hidden>Save comparison ZIP</a>`;
  const $=q=>host.querySelector(q),slotInputs=[...host.querySelectorAll('[data-test-slot]')];
  function invalidateDownload(){
    if(downloadUrl)URL.revokeObjectURL(downloadUrl);
    downloadUrl=null;$('[data-test-save]').hidden=true;$('[data-test-save]').removeAttribute('href');$('[data-test-status]').textContent='';
  }
  host.addEventListener('change',invalidateDownload);
  $('[data-test-pack]').value='elegoo-rilievo';
  let slots=[1,2,3,4];
  slotInputs.forEach((input,i)=>input.addEventListener('change',()=>{
    const destination=Number(input.value),other=slots.indexOf(destination);
    [slots[i],slots[other]]=[slots[other],slots[i]];
    slotInputs.forEach((field,j)=>field.value=String(slots[j]));
  }));
  function choosePack(id){if(busy)return;const option=[...$('[data-test-pack]').options].find(o=>o.value===id);if(option&&$('[data-test-pack]').value!==id){$('[data-test-pack]').value=id;invalidateDownload();}host.open=true;}
  $('[data-test-download]').onclick=async()=>{
    if(busy)return;
    const options={bundleId:$('[data-test-pack]').value,slots:[...slots],height:Number($('[data-test-height]').value),subdivideMixLayer:$('[data-test-subdivide]').checked};
    busy=true;for(const c of host.querySelectorAll('button,input,select'))c.disabled=true;
    $('[data-test-save]').hidden=true;
    host.setAttribute('aria-busy','true');const status=$('[data-test-status]');status.textContent='Building the comparison plates…';
    try {
      wallTestSetup(options);
      await new Promise(resolve=>setTimeout(resolve,0));
      const {wallComparisonPack}=await import('./wallComparison.js');
      const pack=await wallComparisonPack(options,message=>status.textContent=message);
      if(downloadUrl)URL.revokeObjectURL(downloadUrl);
      downloadUrl=URL.createObjectURL(new Blob([pack.bytes],{type:'application/zip'}));
      const a=$('[data-test-save]');a.href=downloadUrl;a.download=`yab3d-${options.bundleId}-wall-comparison.zip`;a.hidden=false;a.click();
      status.textContent='ZIP download requested: two 3MF plates, exact settings and a print guide. Open as projects in Snapmaker Orca and inspect the sliced thin walls. Printed results have not been validated.';
    } catch(error){status.textContent=`Could not build the tests: ${error.message}`;}
    finally{busy=false;host.removeAttribute('aria-busy');for(const c of host.querySelectorAll('button,input,select'))c.disabled=false;}
  };
  return {choosePack};
}
