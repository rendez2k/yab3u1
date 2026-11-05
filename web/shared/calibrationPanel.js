import {CALIBRATION_KEY,validateCalibration,matchesCalibration} from './blendCalibration.js';
import {reelIdentity} from './filamentIdentity.js';
import {mountWallComparison} from './wallComparisonPanel.js';

const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountCalibration(host,{getSetup,onChange}) {
  let profile=null, enabled=false, signature='', busy=false;
  try { const saved=localStorage.getItem(CALIBRATION_KEY); if(saved) profile=validateCalibration(JSON.parse(saved)); } catch { /* damaged storage is never applied */ }
  host.innerHTML=`<summary>Printed blend samples <span data-count></span></summary>
    <details data-wall-comparison></details>
    <h3>Calibrate the current model's palette</h3>
    <p class="hint">These calibration samples use your model's palette and settings, separately from the comparison above. Wall samples can improve model predictions; top-face samples are for flat-surface experiments. One profile is saved here at a time; export a backup before replacing it.</p>
    <label class="field">Test surface<select data-surface><option value="wall">Vertical walls · model colours</option><option value="top">Top faces · experimental</option></select></label>
    <p class="hint" data-setup></p>
    <details data-setup-editor open><summary>Reel names and print conditions</summary>
    <label class="field">Calibration name<input data-name maxlength="120" value="My printer reels"></label>
    <label class="field">Reels and print conditions<input data-conditions maxlength="500" placeholder="Printer, temperatures, cooling and measurement device"></label>
    <div data-reels></div>
    <button type="button" data-create>Start from this palette</button></details>
    <label class="field">Import calibration JSON<input type="file" accept=".json,application/json" data-import></label>
    <div data-samples hidden>
      <p class="hint" data-description></p>
      <label class="field">Reel pair<select data-pair></select></label>
      <button type="button" data-tiles>Download five test tiles (.3mf)</button>
      <p class="hint">Left to right: pure A, 75% A / 25% B, 50/50, 25% A / 75% B, pure B. Measure the selected surface with a colour measurement device; enter its sRGB hex values below. Leave unmeasured blends blank. Screen colours and ordinary photos are not measurements.</p>
      <div class="calibration-samples">${[25,50,75].map(p=>`<label class="field">${100-p}% A / ${p}% B<input data-percent="${p}" placeholder="#RRGGBB" maxlength="7" spellcheck="false" aria-label="Measured colour for ${p} percent B"></label>`).join('')}</div>
      <div class="row"><button type="button" data-save>Save measurements</button><button type="button" data-backup>Download calibration JSON</button><button type="button" data-clear>Clear saved calibration</button></div>
      <label class="check"><input type="checkbox" data-enable>Use these measurements: I confirm these are the same reels and print conditions</label>
      <p class="hint" data-coverage></p>
    </div>
    <p class="hint" role="status" aria-live="polite" data-status></p>`;
  const $=s=>host.querySelector(s), status=message=>$('[data-status]').textContent=message;
  const wallComparison=mountWallComparison($('[data-wall-comparison]'));
  function setup(){try{return getSetup($('[data-surface]').value);}catch(error){return {error:error.message};}}
  function contextMatches(){const current=setup();return profile && !current.error && current.context===profile.context;}
  function compatible(){const current=setup();return contextMatches() && matchesCalibration(profile,current.reels,$('[data-surface]').value);}
  function persist() {
    try {if(profile)localStorage.setItem(CALIBRATION_KEY,JSON.stringify(profile));else localStorage.removeItem(CALIBRATION_KEY);return true;}
    catch {status('Browser storage is unavailable. Download the calibration JSON to keep a backup.');return false;}
  }
  function download(bytes,name,type) {
    const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function pair(){return $('[data-pair]').value.split(',').map(Number);}
  function fillSamples(){
    const [a,b]=pair();
    for(const input of host.querySelectorAll('[data-percent]')) input.value=profile?.samples.find(s=>s.a===a&&s.b===b&&s.percent===Number(input.dataset.percent))?.color || '';
  }
  function renderProfile(){
    $('[data-samples]').hidden=!profile;
    $('[data-setup-editor]').open=!profile;
    $('[data-count]').textContent=profile ? `· ${profile.samples.length} recorded` : '';
    if(!profile)return;
    $('[data-surface]').value=profile.surface || 'top';
    $('[data-name]').value=profile.name;
    $('[data-conditions]').value=profile.setup;
    $('[data-description]').textContent=`${profile.name} · ${profile.setup}`;
    const previous=$('[data-pair]').value;
    $('[data-pair]').innerHTML=profile.reels.flatMap((a,i)=>profile.reels.flatMap((b,j)=>j>i&&a.type===b.type ? [`<option value="${i+1},${j+1}">A: ${esc(a.name)} (${a.color}) · B: ${esc(b.name)} (${b.color})</option>`] : [])).join('');
    if([...$('[data-pair]').options].some(o=>o.value===previous))$('[data-pair]').value=previous;
    fillSamples();
  }
  function render(){
    const current=setup(), valid=compatible();
    $('[data-setup]').textContent=current.error || `Current model calibration: ${current.target || 'snapmaker'} · ${current.nozzle} mm nozzle · ${current.height} mm layers · subdivision ${current.subdivideMixLayer?'on':'off'}. Separate from the layer / wall comparison above.`;
    $('[data-create]').disabled=busy||Boolean(current.error);
    const next=JSON.stringify(current.reels?.map(reelIdentity) || []);
    if(signature!==next){signature=next;$('[data-reels]').innerHTML=(current.reels||[]).map((r,i)=>`<label class="field"><span><i class="swatch" style="background:${r.color}"></i> Slot ${i+1} · ${esc(r.type)} · ${r.color}</span><input data-reel-name="${i}" maxlength="120" placeholder="Brand and reel / spool name" value="${esc(profile?.reels.find(p=>p.color===r.color&&p.type===r.type)?.name||r.name||'')}"></label>`).join('');}
    if(enabled&&!valid)enabled=false;
    $('[data-enable]').checked=enabled;
    $('[data-enable]').disabled=(!valid&&!enabled)||!profile?.samples.length||profile?.surface!=='wall';
    $('[data-tiles]').disabled=busy||!valid||!$('[data-pair]').value;
    $('[data-coverage]').textContent=profile && profile.surface!=='wall' ? 'Top-face measurements are saved for experiments. They are not applied to vertical model surfaces. Download a backup before starting a wall test.' : enabled ? `${profile.samples.length} recorded recipes enabled for the named reel set. ${valid ? '' : 'This palette uses different reels, so its blends remain estimates. '}Unrecorded recipes still use estimates; no values are extrapolated.`
      : profile && !valid ? 'Measurements are inactive: choose the recorded reel set, output and layer settings. Reconfirm actual reels and print conditions before enabling.'
      : 'Measurements are off. Saving or importing does not enable them automatically. Reconfirm your actual reels and print conditions each visit.';
  }
  $('[data-create]').onclick=()=>{
    try {
      const current=setup();if(current.error)throw Error(current.error);
      if(profile && !host.querySelector('[data-replace]')) {
        const button=document.createElement('button');button.type='button';button.dataset.replace='';button.textContent='Replace saved calibration';
        button.onclick=()=>{button.remove();const latest=setup();if(latest.error){status(latest.error);return;}create(latest);};$('[data-create]').after(button);
        status('Starting again replaces the saved samples. Download a backup first if you want to keep them.');return;
      }
      create(current);
    }catch(error){status(error.message);}
  };
  function create(current){
    try {
      profile=validateCalibration({version:2,surface:$('[data-surface]').value,revision:1,name:$('[data-name]').value,setup:$('[data-conditions]').value,context:current.context,
        reels:current.reels.map((r,i)=>({...r,name:host.querySelector(`[data-reel-name="${i}"]`).value})),samples:[]});
      enabled=false;const saved=persist();renderProfile();render();onChange();if(saved)status('Reel setup saved. Download a pair of test tiles, then record its measurements.');
    }catch(error){status(error.message);}
  }
  $('[data-pair]').onchange=fillSamples;
  $('[data-save]').onclick=()=>{
    try{
      const [a,b]=pair();
      const samples=profile.samples.filter(s=>s.a!==a||s.b!==b);
      for(const input of host.querySelectorAll('[data-percent]')) if(input.value.trim())samples.push({a,b,percent:Number(input.dataset.percent),color:input.value.trim()});
      profile=validateCalibration({...profile,samples,revision:(profile.revision || 0)+1});
      enabled=false;const saved=persist();renderProfile();render();onChange();if(saved)status('Measurements saved. Confirm the setup below to use them in suggestions and previews.');
    }catch(error){status(error.message);}
  };
  $('[data-enable]').onchange=()=>{enabled=$('[data-enable]').checked&&compatible()&&profile?.surface==='wall';render();onChange();status(enabled?'Recorded measurements enabled for the matching reel set.':'Recorded measurements disabled; using estimates.');};
  $('[data-surface]').onchange=()=>{enabled=false;render();onChange();};
  $('[data-backup]').onclick=()=>download(JSON.stringify(profile,null,2),'yab3d-blend-calibration.json','application/json');
  $('[data-clear]').onclick=()=>{profile=null;enabled=false;persist();renderProfile();render();onChange();status('Saved calibration cleared. Predictions use estimates again.');};
  $('[data-import]').onchange=async event=>{
    try{
      const file=event.target.files[0];if(!file)return;if(file.size>65536)throw Error('Choose a calibration JSON smaller than 64 KB.');
      const imported=validateCalibration(JSON.parse(await file.text()));
      profile=imported;enabled=false;const saved=persist();renderProfile();render();onChange();if(saved)status('Calibration imported, but inactive until you confirm the matching setup.');
    }catch(error){status(error.message);}finally{event.target.value='';}
  };
  $('[data-tiles]').onclick=async()=>{
    busy=true;render();status('Building the five-tile Full Spectrum project…');
    try{
      const current=setup();if(!compatible())throw Error('Restore the recorded reel set and settings before generating its test.');
      // Profile order is permanent, regardless of current physical slot order.
      const [pa,pb]=pair(), find=r=>current.reels.findIndex(c=>reelIdentity(c)===reelIdentity(r))+1;
      const ordered=[find(profile.reels[pa-1]),find(profile.reels[pb-1])];
      const {calibrationSwatches}=await import('./calibrationSwatches.js');
      const bytes=await calibrationSwatches({...current,surface:$('[data-surface]').value,a:ordered[0],b:ordered[1]});
      download(bytes,`blend-${$('[data-surface]').value}-test-slots-${ordered.join('-')}.3mf`,'model/3mf');
      status('Test project downloaded. Slice it and check the five assignments and layer settings before printing.');
    }catch(error){status(error.message);}finally{busy=false;render();}
  };
  renderProfile();render();
  return {render,openWallComparison:bundleId=>{host.open=true;wallComparison.choosePack(bundleId);$('[data-wall-comparison]').scrollIntoView({block:'start'});},active:()=>enabled&&compatible()&&profile?.surface==='wall'?profile:null};
}
