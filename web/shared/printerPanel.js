import {printerOrigin,filamentSetup,inspectPrinter,sendSetup} from './printer.js';
import {colourName} from './assignment.js';
import {openPrinterBridge} from './printerBridge.js';
export function mountPrinter(host,getPalette,options={}) {
 const converter=options.converter===true;
 const notReady=()=>converter?'Load a project and assign its colours within the four U1 slots first.':'Apply your chosen palette first, then check the printer.';
 const $=id=>host.querySelector('[data-printer="'+id+'"]');
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 host.innerHTML=`<summary>Send filament setup to U1</summary>
 <p class="hint">${converter?'Check the slots below against the reels loaded in your U1.':'Apply your palette, then check these slots against the reels loaded in your U1.'} This changes colour and material labels only.</p>
 <div class="printer-palette" data-printer="slots" aria-label="Filaments to send"></div>
 <p class="hint" data-printer="ready-note"></p>
 <button type="button" data-printer="palette" hidden>Go to Apply palette</button>
 <div data-printer="direct">
 <label class="field">U1 address<input data-printer="address" type="text" placeholder="192.168.1.100" autocomplete="off"></label>
 <details><summary>API key (only if your printer requires one)</summary><label class="field">Moonraker API key<input data-printer="key" type="password" autocomplete="off"></label></details>
 <p class="hint">Use the same network as your U1. The address is remembered in this tab; the key is not saved.</p>
 <button type="button" class="primary" data-printer="check">Check U1 & review slots</button>
 <div class="printer-status" role="status" aria-live="polite"><strong data-printer="state">Nothing sent</strong><p class="hint" data-printer="status"></p></div>
 <div data-printer="review"></div><button type="button" class="primary" data-printer="send" hidden>Send reviewed slots to U1</button>
 <details data-printer="help"><summary>Browser cannot connect? Run YAB3D locally</summary><p class="hint">If your browser blocks the printer connection, the local launcher keeps this same review and send screen. No Spool Studio account is needed.</p><p><a href="local-printer.js" download="yab3d-local.cjs">Download local launcher</a></p><p class="hint">With Node.js 22 or newer installed, save the file and run:</p><pre data-printer="command"></pre><p class="hint">Open the localhost address it prints and load your model. If Moonraker requires a key, set YAB3D_PRINTER_API_KEY in the launcher's environment.</p></details>
 </div>
 <details data-printer="bridge-option"><summary>Use Spool Studio Bridge instead</summary>
 <p class="hint">Optional alternative if you already use its bridge. This opens another tab for review.</p>
 <button type="button" data-printer="bridge">Open Spool Studio to review & send</button>
 <details data-printer="steps"><summary>What to do in Spool Studio</summary>
 <ol><li>Sign in if asked, then choose your U1.</li><li>Under <strong>Your YAB3D slots</strong>, choose a slot and check its reel and finish.</li><li>Choose <strong>Review change</strong>, then <strong>Send to printer</strong>. Repeat for the other slots.</li></ol></details>
 <div class="printer-status" role="status" aria-live="polite"><strong data-printer="bridge-state">Nothing sent through Spool Studio</strong><p class="hint" data-printer="bridge-status">This alternative requires four assigned reels. Keep YAB3D open while reviewing.</p></div>
 <button type="button" data-printer="continue" hidden>Continue in Spool Studio</button>
 <button type="button" data-printer="bridge-cancel" hidden>Cancel this handoff</button>
 </details>`;
 try{$('address').value=sessionStorage.getItem('yab3d-u1-address')||'';}catch{}
 let review=null,request=null,busy=false,cancelBridge=null,bridgePending=false;
 const slotStates = new Map();
 function renderSlots() {
  const reels = getPalette();
  $('slots').innerHTML = reels ? reels.map((reel,i)=>`<div class="printer-palette-slot"><strong>Slot ${i+1}</strong>${reel?`<span><i class="swatch" style="background:${/^#[a-f0-9]{6}$/i.test(reel.color)?reel.color:'#FFFFFF'}"></i> ${esc(colourName(reel.color))}</span><small>${esc(reel.type)} · ${esc(reel.color)}</small><small>${esc(slotStates.get(i+1)||'Not sent')}</small>`:'<span>Unused</span><small>Left unchanged</small>'}</div>`).join('') : '';
 }
 const bridgeStatus=(title,message)=>{$('bridge-state').textContent=title;$('bridge-status').textContent=message;};
 const status=(title,message)=>{$('state').textContent=title;$('status').textContent=message;};
 function readiness(){
  renderSlots();
  let address='http://YOUR-PRINTER-IP';try{address=printerOrigin($('address').value.trim());}catch{}
  $('command').textContent='node yab3d-local.cjs '+address+(location.hostname==='u1-reel-changes--yab3u1.netlify.app'?' --review':'')+(converter?'':' --recolour');
  const ready=Boolean(getPalette());
  $('ready-note').textContent = bridgePending?'Continue in Spool Studio to review and send. Verified slot results appear here.':!ready?notReady():'Check the printer, review the changes below, then send the selected slots. Unused slots stay unchanged.';
  $('continue').hidden=!bridgePending;
  $('check').disabled=busy||bridgePending||!ready;$('bridge').disabled=busy||bridgePending||!ready||!getPalette()?.every(Boolean);$('palette').hidden=ready||converter;
  const selected=host.querySelectorAll('[data-slot]:checked:not(:disabled)').length;
  $('send').disabled=busy||bridgePending||!review?.before.idle||!selected;
  $('send').textContent=review && !review.before.idle?`Printer ${review.before.state} · sending disabled`:selected?`Send ${selected} slot${selected===1?'':'s'} to U1`:'Select slots to send';
  return ready;
 }
 $('bridge').onclick=()=>{
  if(busy||bridgePending||!getPalette())return;
  clear();slotStates.clear();bridgePending=true;readiness();$('steps').open=true;$('bridge-cancel').hidden=false;
  const cancel=openPrinterBridge({reels:getPalette(),status:bridgeStatus,progress:result=>{const names={queued:'Waiting for bridge',executing:'Sending…',verified:result.exact?'Verified on U1':'Sent with a different reel',blocked:'Blocked · see Spool Studio',uncertain:'Not verified · check printer',cancelled:'Cancelled',expired:'Review expired'};slotStates.set(result.slot,names[result.state]);renderSlots();},done:()=>{bridgePending=false;cancelBridge=null;$('bridge-cancel').hidden=true;readiness();}});
  if(bridgePending)cancelBridge=cancel;
 };
 $('continue').onclick=()=>cancelBridge?.focus?.();
 $('bridge-cancel').onclick=()=>cancelBridge?.();
 $('palette').addEventListener('click',()=>{
  const button=document.getElementById('applyforexport');
  const target=button&&!button.hidden?button:document.getElementById('userecommended');
  target?.scrollIntoView({behavior:'smooth',block:'center'});target?.focus({preventScroll:true});
 });
 status('Nothing sent',readiness()?'Check the printer to read its current slots. This does not change any settings.':notReady()+' No connection has been checked.');
 const signature=()=>JSON.stringify(getPalette());
 const clear=()=>{review=null;$('send').hidden=true;$('review').replaceChildren();$('check').textContent='Check U1 & review slots';$('check').classList.add('primary');};
 for(const id of ['address','key']) $(id).addEventListener('input',()=>{clear();slotStates.clear();renderSlots();if(id==='address')try{sessionStorage.setItem('yab3d-u1-address',$('address').value.trim());}catch{};readiness();status('Connection not checked',getPalette()?'Address or key changed. Check the printer again. No settings have been sent to this connection.':notReady());});
 function lock(value){busy=value;host.querySelectorAll('input,button,select').forEach(el=>el.disabled=value);readiness();}
 $('check').addEventListener('click',async()=>{
  if(busy)return;clear();lock(true);status('Checking connection…','Reading the U1’s current slots. Nothing is being sent.');
  const sourceSignature=signature();
  try {
   const reels=getPalette();if(!reels)throw Error(notReady());
   const profiles=filamentSetup(reels.map(r=>r||{color:'#FFFFFF',type:'PLA'})).map((p,i)=>reels[i]?p:null);
   let origin,token='';
   if(['127.0.0.1','localhost'].includes(location.hostname)) {
    const response=await fetch('/__printer/session');
    if(response.ok && response.headers.get('content-type')?.includes('application/json')) {const session=await response.json();token=session.token;origin='/__printer';$('address').value=session.printer;}
   }
   if(!origin)origin=printerOrigin($('address').value.trim());
   const key=$('key').value;
   request=async(route,body)=>{
    const response=await fetch(origin+route,{method:body?'POST':'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:key?{'X-Api-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw Error('Printer request failed ('+response.status+'). Check address and access settings.');
    return response.json();
   };
   const before=await inspectPrinter(request);
   if(signature()!==sourceSignature)throw Error('Palette changed while checking. Check again.');
   if(!before.supported)throw Error('This firmware does not expose the supported U1 metadata command.');
   review={before,profiles,channels:[],created:Date.now(),signature:sourceSignature};
   $('review').innerHTML='<p class="hint">Review each physical slot. Generic labels do not change temperatures or calibrated slicer profiles. Choose the actual finish of each reel.</p>'+profiles.map((p,i)=>!p?`<p class="hint">Slot ${i+1}: unused by this project · left unchanged</p>`:`<div class="printer-slot"><label class="check"><input type="checkbox" data-slot="${i}" ${before.idle&&before.slots[i].present&&before.slots[i].spoolId===0?'checked':'disabled'}>Slot ${i+1}</label><span><i class="swatch" style="background:#${esc(before.slots[i].rgba.slice(0,6))}"></i>${esc(before.slots[i].material)} → <i class="swatch" style="background:#${p.rgba.slice(0,6)}"></i>Generic ${p.material} · #${p.rgba.slice(0,6)}</span><label>Finish <select data-finish="${i}"><option>Basic</option><option>Matte</option><option>Silk</option></select></label>${before.slots[i].spoolId?'<span class="hint">Managed by Spoolman · left unchanged. Update this reel’s assignment in the printer filament manager first.</span>':!before.slots[i].present?'<span class="hint">Load a reel in this slot first.</span>':''}</div>`).join('');
   $('send').hidden=false;$('check').textContent='Refresh slot check';$('check').classList.remove('primary');
   status(before.idle?'Connected · ready to review':'Connected · printer '+before.state,before.idle?'Check the selected slots below, then send. This review expires after one minute. Nothing has been sent.':'Current slots are shown below. Sending is disabled while the printer is '+before.state+'. Finish or cancel the job on your printer, then refresh this check. Nothing has been sent.');
  }catch(error){clear();if(error instanceof TypeError)$('help').open=true;status('Check failed · nothing sent',error instanceof TypeError?'Browser could not reach the U1. Check its address and local-network permission, or use the local launcher below.':error.message);}
  finally{lock(false);if(review)host.querySelectorAll('[data-slot]').forEach(el=>el.disabled=!review.before.idle||!review.before.slots[Number(el.dataset.slot)].present||review.before.slots[Number(el.dataset.slot)].spoolId!==0);readiness();}
 });
 $('review').addEventListener('change',readiness);
 $('send').addEventListener('click',async()=>{
  if(!review||busy)return;
  const job=review;job.channels=[...host.querySelectorAll('[data-slot]:checked')].map(el=>Number(el.dataset.slot));
  host.querySelectorAll('[data-finish]').forEach(el=>job.profiles[Number(el.dataset.finish)].subtype=el.value);
  lock(true);status('Sending filament settings…','Waiting for the U1 and verifying each selected slot.');
  const result=await sendSetup(request,job,()=>signature()===job.signature);
  for(const slot of result.verified)slotStates.set(slot,'Verified on U1');
  clear();status(result.uncertain?'Send could not be verified':result.verified.length>0&&result.verified.length===job.channels.length?'Sent and verified on U1':result.verified.length?'Partly sent · stopped':'Nothing sent',result.message);lock(false);
 });
 let previousPalette=signature();
 return {refresh(){
  if(busy)return;
  const current=signature();
  if(current!==previousPalette){slotStates.clear();if(cancelBridge)cancelBridge();else bridgeStatus('Nothing sent for this palette',getPalette()?.every(Boolean)?'Open Spool Studio, then review and send each required slot there.':getPalette()?'Some slots are unused. Use the direct connection to review occupied slots; the bridge needs four assigned reels.':notReady());clear();previousPalette=current;status('Nothing sent for this palette',getPalette()?'Palette ready. Check the printer to review its current slots before sending.':notReady());}
  readiness();
 }};
}
