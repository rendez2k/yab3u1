import {CALIBRATION_KEY,validateCalibration,matchesCalibration} from './blendCalibration.js';
import {reelIdentity} from './filamentIdentity.js';
import {mountWallComparison} from './wallComparisonPanel.js';
import {stripPlan,stripTiles} from './swatchStrip.js';
import {readStrip} from './swatchReader.js';

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
      <div data-strip-block>
        <h3>Swatch strips · read from a photo</h3>
        <p class="hint">Each strip is one print: a row of small upright walls, five for each reel pair (pure A, three blends, pure B). Print it, lay it on its back on white paper, and photograph it straight on in even light with no flash. Then mark it here and the colours are read for you. A phone photo corrected against the paper is not a laboratory measurement, but it is your reels, your printer and your settings.</p>
        <div data-strips></div>
        <div data-reader hidden>
          <p class="hint" role="status" aria-live="polite" data-reader-step></p>
          <canvas data-photo tabindex="0" aria-label="Photo of the swatch strip. Click to mark the four corners of the strip, then a patch of white paper."></canvas>
          <div class="row"><button type="button" data-reader-undo>Undo last mark</button><button type="button" data-reader-skip>No paper in the photo</button><button type="button" class="primary" data-reader-apply disabled>Use these colours</button><button type="button" data-reader-cancel>Cancel</button></div>
          <ol class="strip-reading" data-reader-result></ol>
        </div>
      </div>
      <h3>Or enter measurements by hand</h3>
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
    renderStrips();
    $('[data-coverage]').textContent=profile && profile.surface!=='wall' ? 'Top-face measurements are saved for experiments. They are not applied to vertical model surfaces. Download a backup before starting a wall test.' : enabled ? `${profile.samples.length} recorded recipes enabled for the named reel set. ${valid ? '' : 'This palette uses different reels, so its blends remain estimates. '}Shares between two readings on a pair are read off the line between them; anything outside the readings stays an estimate.`
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
  // ---- Swatch strips: one print per strip, read back from a photo ----
  const reader={strip:-1,image:null,scale:1,marks:[],paper:undefined,result:null};
  const marksNeeded=['the strip’s top-left corner','its top-right corner','its bottom-right corner','its bottom-left corner','a clean patch of the white paper'];
  function strips(){return profile&&profile.surface==='wall'?stripPlan(profile.reels):[];}
  function renderStrips(){
    const list=strips(),box=$('[data-strips]');
    $('[data-strip-block]').hidden=!profile;
    if(!profile)return;
    if(profile.surface!=='wall'){box.innerHTML='<p class="hint">Swatch strips sample vertical walls. Start a calibration with Test surface set to Vertical walls to use them.</p>';return;}
    box.innerHTML=list.map((pairs,i)=>{
      const done=pairs.filter(([a,b])=>[25,50,75].every(p=>profile.samples.some(s=>s.a===a&&s.b===b&&s.percent===p))).length;
      return `<div class="strip-row"><strong>Strip ${i+1} of ${list.length}</strong><span class="hint">${pairs.map(([a,b])=>`${esc(profile.reels[a-1].name)} + ${esc(profile.reels[b-1].name)}`).join(' · ')}${done?` · ${done} of ${pairs.length} pair${pairs.length===1?'':'s'} read`:''}</span><div class="row"><button type="button" data-strip-download="${i}">Download strip ${i+1} (.3mf)</button><label class="strip-photo">Read a photo<input type="file" accept="image/*" data-strip-photo="${i}"></label></div></div>`;
    }).join('')||'<p class="hint">These reels have no pair of the same material to blend.</p>';
    box.querySelectorAll('[data-strip-download]').forEach(button=>{button.disabled=busy||!compatible();button.onclick=()=>downloadStrip(Number(button.dataset.stripDownload));});
    box.querySelectorAll('[data-strip-photo]').forEach(input=>input.onchange=()=>openPhoto(Number(input.dataset.stripPhoto),input));
  }
  async function downloadStrip(index){
    busy=true;render();status('Building the swatch strip…');
    try{
      const current=setup();if(!compatible())throw Error('Restore the recorded reel set and settings before generating a strip.');
      const find=r=>current.reels.findIndex(c=>reelIdentity(c)===reelIdentity(r))+1,pairs=strips()[index].map(([a,b])=>[find(profile.reels[a-1]),find(profile.reels[b-1])]);
      const {swatchStrip}=await import('./swatchStrip.js');
      const bytes=await swatchStrip({...current,pairs,name:`Swatch strip ${index+1}`});
      download(bytes,`swatch-strip-${index+1}-of-${strips().length}.3mf`,'model/3mf');
      status(`Strip ${index+1} downloaded: ${pairs.length*5} walls in a row. Slice it and check the assignments before printing. The file lists the walls in order.`);
    }catch(error){status(error.message);}finally{busy=false;render();}
  }
  function drawPhoto(){
    const canvas=$('[data-photo]'),ctx=canvas.getContext('2d');if(!reader.image||!ctx)return;
    ctx.drawImage(reader.image,0,0,canvas.width,canvas.height);
    ctx.lineWidth=2;ctx.strokeStyle='#00E5FF';ctx.fillStyle='#00E5FF';ctx.font='bold 14px sans-serif';
    const points=reader.marks.map(([x,y])=>[x*reader.scale,y*reader.scale]);
    if(points.length>1){ctx.beginPath();points.slice(0,4).forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(points.length>=4)ctx.closePath();ctx.stroke();}
    points.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#000';ctx.stroke();ctx.strokeStyle='#00E5FF';ctx.fillText(i<4?String(i+1):'paper',x+9,y-9);});
  }
  function readerStep(){
    const step=reader.paper===null?5:reader.marks.length;
    $('[data-reader-step]').textContent=step<4?`Click ${marksNeeded[step]} (mark ${step+1} of 4). Mark the outer corners of the whole row of walls.`
      :step===4?`Now click ${marksNeeded[4]}, in the same light as the strip.`:'Check the colours below against the strip, then choose Use these colours.';
    $('[data-reader-skip]').hidden=step!==4;$('[data-reader-undo]').disabled=!reader.marks.length&&reader.paper!==null;
  }
  function readNow(){
    const pairs=strips()[reader.strip],tiles=stripTiles(pairs);
    try{
      const pixels=reader.pixels,out=readStrip(pixels,reader.marks.slice(0,4),tiles.length,reader.marks[4]||null);
      reader.result={tiles,colours:out.tiles.map(t=>t.hex)};
      $('[data-reader-result]').innerHTML=tiles.map((tile,i)=>`<li><i class="swatch" style="background:${out.tiles[i].hex}"></i><span>${esc(tile.percent===0?`Pure ${profile.reels[tile.a-1].name}`:tile.percent===100?`Pure ${profile.reels[tile.b-1].name}`:`${100-tile.percent}% ${profile.reels[tile.a-1].name} + ${tile.percent}% ${profile.reels[tile.b-1].name}`)}</span><code>${out.tiles[i].hex}</code></li>`).join('');
      $('[data-reader-apply]').disabled=false;
      status(out.warnings.join(' ')||'Colours read. Compare them with the strip before using them.');
    }catch(error){reader.result=null;$('[data-reader-result]').innerHTML='';$('[data-reader-apply]').disabled=true;status(error.message);}
  }
  async function openPhoto(index,input){
    const file=input.files[0];input.value='';if(!file)return;
    try{
      if(file.size>40*1048576)throw Error('Choose a photo smaller than 40 MB.');
      const image=await createImageBitmap(file);
      // Work on a copy no larger than 2400 px: plenty for tiles, and quick to read.
      const fit=Math.min(1,2400/Math.max(image.width,image.height)),w=Math.round(image.width*fit),h=Math.round(image.height*fit);
      const full=document.createElement('canvas');full.width=w;full.height=h;full.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,w,h);
      reader.pixels=full.getContext('2d').getImageData(0,0,w,h);reader.image=full;reader.strip=index;reader.marks=[];reader.paper=undefined;reader.result=null;
      $('[data-reader]').hidden=false;
      const canvas=$('[data-photo]'),room=Math.max(240,canvas.parentElement.clientWidth||320);
      reader.scale=Math.min(1,room/w);canvas.width=Math.round(w*reader.scale);canvas.height=Math.round(h*reader.scale);
      $('[data-reader-result]').innerHTML='';$('[data-reader-apply]').disabled=true;drawPhoto();readerStep();
      status(`Photo loaded for strip ${index+1}.`);canvas.scrollIntoView?.({block:'nearest'});
    }catch(error){status(error.message||'That file could not be read as a photo.');}
  }
  $('[data-photo]').addEventListener('click',event=>{
    if(!reader.image||reader.marks.length>=5||reader.paper===null)return;
    const canvas=$('[data-photo]'),box=canvas.getBoundingClientRect();
    reader.marks.push([(event.clientX-box.left)*(canvas.width/box.width)/reader.scale,(event.clientY-box.top)*(canvas.height/box.height)/reader.scale]);
    drawPhoto();readerStep();if(reader.marks.length===5)readNow();
  });
  $('[data-reader-skip]').onclick=()=>{if(reader.marks.length===4){reader.paper=null;readerStep();readNow();}};
  $('[data-reader-undo]').onclick=()=>{if(reader.paper===null)reader.paper=undefined;else reader.marks.pop();reader.result=null;$('[data-reader-result]').innerHTML='';$('[data-reader-apply]').disabled=true;drawPhoto();readerStep();};
  $('[data-reader-cancel]').onclick=()=>{reader.image=null;reader.result=null;$('[data-reader]').hidden=true;status('Photo closed. Nothing was saved.');};
  $('[data-reader-apply]').onclick=()=>{
    try{
      if(!reader.result)return;
      const pairs=strips()[reader.strip],samples=profile.samples.filter(s=>!pairs.some(([a,b])=>s.a===a&&s.b===b)),pure=(profile.pure||profile.reels.map(()=>null)).slice();
      reader.result.tiles.forEach((tile,i)=>{
        const colour=reader.result.colours[i];
        if(tile.percent===0)pure[tile.a-1]=colour;else if(tile.percent===100)pure[tile.b-1]=colour;else samples.push({a:tile.a,b:tile.b,percent:tile.percent,color:colour});
      });
      profile=validateCalibration({...profile,samples,pure,revision:(profile.revision||0)+1});
      enabled=false;const saved=persist();reader.image=null;reader.result=null;$('[data-reader]').hidden=true;renderProfile();render();onChange();
      if(saved)status(`Strip ${reader.strip+1} saved: ${pairs.length*3} blends and the reels' own colours. Tick "Use these measurements" below to apply them.`);
    }catch(error){status(error.message);}
  };
  renderProfile();render();
  return {render,openWallComparison:bundleId=>{host.open=true;wallComparison.choosePack(bundleId);$('[data-wall-comparison]').scrollIntoView({block:'start'});},active:()=>enabled&&compatible()&&profile?.surface==='wall'?profile:null};
}
