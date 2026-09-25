import {printerOrigin,filamentSetup,inspectPrinter,sendSetup} from './printer.js';
import {openPrinterBridge} from './printerBridge.js';
export function mountPrinter(host,getPalette) {
 const $=id=>host.querySelector('[data-printer="'+id+'"]');
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 host.innerHTML=`<summary>Send filament setup to U1</summary><p class="hint">Set the four physical slots to match your applied palette. Blended colours stay in the project. Load the actual reels first; this updates colour and material labels only.</p>
 <button type="button" data-printer="bridge">Use my Spool Studio Bridge</button>
 <p class="hint">Already running Spool Studio Bridge? Carry this palette and slot order into Spool Studio to review against your library. Your existing connection handles the send.</p>
 <div class="printer-status" role="status" aria-live="polite"><strong data-printer="bridge-state">Nothing sent</strong><p class="hint" data-printer="bridge-status">Apply a palette, then open your existing bridge.</p></div>
 <button type="button" data-printer="bridge-cancel" hidden>End palette handoff</button>
 <button type="button" data-printer="palette" hidden>Go to Apply palette</button>
 <details data-printer="direct"><summary>Connect directly / local launcher</summary>
 <label class="field">U1 address<input data-printer="address" type="text" placeholder="192.168.1.100" autocomplete="off"></label>
 <label class="field">Moonraker API key (only if required)<input data-printer="key" type="password" autocomplete="off"></label>
 <p class="hint">The address and key stay in this tab.</p>
 <div class="printer-status" role="status" aria-live="polite"><strong data-printer="state">Nothing sent</strong><p class="hint" data-printer="status"></p></div>
 <button type="button" data-printer="check">Check printer & review slots</button>
 <div data-printer="review"></div><button type="button" class="primary" data-printer="send" hidden>Send reviewed slots to U1</button>
 <details><summary>Connection help / local launch</summary><p class="hint">Use the same network as your U1. Direct browser access needs Moonraker to allow this site and your browser to permit local network access. If the browser blocks it, run this same app locally:</p><p><a href="local-printer.js" download="yab3d-local.cjs">Download local launcher</a></p><p class="hint">Requires Node.js 22 or newer. Save the file, then run:</p><pre>node yab3d-local.cjs http://YOUR-PRINTER-IP</pre><p class="hint">Open the localhost address it prints and load your model there. It connects straight to your U1, with no Spool Studio account or public printer port. If Moonraker requires a key, set YAB3D_PRINTER_API_KEY in the launcher’s environment.</p></details></details>`;
 let review=null,request=null,busy=false,cancelBridge=null,bridgePending=false;
 const bridgeStatus=(title,message)=>{$('bridge-state').textContent=title;$('bridge-status').textContent=message;};
 const status=(title,message)=>{$('state').textContent=title;$('status').textContent=message;};
 function readiness(){
  const ready=Boolean(getPalette());$('check').disabled=busy||bridgePending||!ready;$('bridge').disabled=busy||bridgePending||!ready;$('palette').hidden=ready;
  return ready;
 }
 $('bridge').onclick=()=>{
  if(busy||bridgePending||!getPalette())return;
  clear();bridgePending=true;readiness();$('bridge-cancel').hidden=false;$('direct').open=false;
  const cancel=openPrinterBridge({reels:getPalette(),status:bridgeStatus,done:()=>{bridgePending=false;cancelBridge=null;$('bridge-cancel').hidden=true;readiness();}});
  if(bridgePending)cancelBridge=cancel;
 };
 $('bridge-cancel').onclick=()=>cancelBridge?.();
 $('palette').addEventListener('click',()=>{
  const button=document.getElementById('applyforexport');
  const target=button&&!button.hidden?button:document.getElementById('userecommended');
  target?.scrollIntoView({behavior:'smooth',block:'center'});target?.focus({preventScroll:true});
 });
 status('Nothing sent',readiness()?'Check the printer to read its current slots. This does not change any settings.':'Apply your chosen palette first, then check the printer. No connection has been checked.');
 const signature=()=>JSON.stringify(getPalette());
 const clear=()=>{review=null;$('send').hidden=true;$('review').replaceChildren();};
 for(const id of ['address','key']) $(id).addEventListener('input',()=>{clear();status('Connection not checked',getPalette()?'Address or key changed. Check the printer again. No settings have been sent to this connection.':'Apply your chosen palette first, then check the printer.');});
 function lock(value){busy=value;host.querySelectorAll('input,button,select').forEach(el=>el.disabled=value);readiness();}
 $('check').addEventListener('click',async()=>{
  if(busy)return;clear();lock(true);status('Checking connection…','Reading the U1’s current slots. Nothing is being sent.');
  const sourceSignature=signature();
  try {
   const reels=getPalette();if(!reels)throw Error('Apply a palette before sending its physical filament setup.');
   const profiles=filamentSetup(reels);
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
   if(!before.idle)throw Error('Printer is '+before.state+'. Wait until it is ready.');
   review={before,profiles,channels:[],created:Date.now(),signature:sourceSignature};
   $('review').innerHTML='<p class="hint">Review each physical slot. Generic labels do not change temperatures or calibrated slicer profiles. Choose the actual finish of each reel.</p>'+profiles.map((p,i)=>`<div class="printer-slot"><label class="check"><input type="checkbox" data-slot="${i}" ${before.slots[i].present&&before.slots[i].spoolId===0?'checked':'disabled'}>Slot ${i+1}</label><span><i class="swatch" style="background:#${esc(before.slots[i].rgba.slice(0,6))}"></i>${esc(before.slots[i].material)} → <i class="swatch" style="background:#${p.rgba.slice(0,6)}"></i>Generic ${p.material} · #${p.rgba.slice(0,6)}</span><label>Finish <select data-finish="${i}"><option>Basic</option><option>Matte</option><option>Silk</option></select></label>${before.slots[i].spoolId?'<span class="hint">Linked Spoolman reel: update its assignment in the printer first.</span>':!before.slots[i].present?'<span class="hint">Load a reel in this slot first.</span>':''}</div>`).join('');
   $('send').hidden=false;status('Connected · nothing sent','Current slots are shown below. Review them, then choose Send reviewed slots to U1. This review expires after one minute.');
  }catch(error){clear();status('Check failed · nothing sent',error instanceof TypeError?'Browser could not reach the U1. Check its address and local-network permission, or use the local launcher below.':error.message);}
  finally{lock(false);if(review)host.querySelectorAll('[data-slot]').forEach(el=>el.disabled=!review.before.slots[Number(el.dataset.slot)].present||review.before.slots[Number(el.dataset.slot)].spoolId!==0);}
 });
 $('send').addEventListener('click',async()=>{
  if(!review||busy)return;
  const job=review;job.channels=[...host.querySelectorAll('[data-slot]:checked')].map(el=>Number(el.dataset.slot));
  host.querySelectorAll('[data-finish]').forEach(el=>job.profiles[Number(el.dataset.finish)].subtype=el.value);
  lock(true);status('Sending filament settings…','Waiting for the U1 and verifying each selected slot.');
  const result=await sendSetup(request,job,()=>signature()===job.signature);
  clear();status(result.uncertain?'Send could not be verified':result.verified.length>0&&result.verified.length===job.channels.length?'Sent and verified on U1':result.verified.length?'Partly sent · stopped':'Nothing sent',result.message);lock(false);
 });
 let previousPalette=signature();
 return {refresh(){
  if(busy)return;
  const current=signature();
  if(current!==previousPalette){if(cancelBridge)cancelBridge();else bridgeStatus('Nothing sent for this palette',getPalette()?'Palette ready. Open Spool Studio to review your four slots through the existing bridge.':'Apply your chosen palette first.');clear();previousPalette=current;status('Nothing sent for this palette',getPalette()?'Palette ready. Check the printer to review its current slots before sending.':'Apply your chosen palette first, then check the printer.');}
  readiness();
 }};
}
