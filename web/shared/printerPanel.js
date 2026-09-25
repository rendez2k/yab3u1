import {printerOrigin,filamentSetup,inspectPrinter,sendSetup} from './printer.js';
export function mountPrinter(host,getPalette) {
 const $=id=>host.querySelector('[data-printer="'+id+'"]');
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 host.innerHTML=`<summary>Send filament setup to U1</summary><p class="hint">Set the four physical slots to match your applied palette. Blended colours stay in the project. Load the actual reels first; this updates colour and material labels only.</p>
 <label class="field">U1 address<input data-printer="address" type="text" placeholder="192.168.1.100" autocomplete="off"></label>
 <label class="field">Moonraker API key (only if required)<input data-printer="key" type="password" autocomplete="off"></label>
 <p class="hint">The address and key stay in this tab.</p><button type="button" data-printer="check">Check printer & review slots</button>
 <div data-printer="review"></div><button type="button" class="primary" data-printer="send" hidden>Send reviewed slots to U1</button><p class="hint" role="status" data-printer="status"></p>
 <details><summary>Connection help / local launch</summary><p class="hint">Use the same network as your U1. Direct browser access needs Moonraker to allow this site and your browser to permit local network access. If the browser blocks it, run this same app locally:</p><p><a href="local-printer.js" download="yab3d-local.cjs">Download local launcher</a></p><p class="hint">Requires Node.js 22 or newer. Save the file, then run:</p><pre>node yab3d-local.cjs http://YOUR-PRINTER-IP</pre><p class="hint">Open the localhost address it prints and load your model there. It connects straight to your U1, with no Spool Studio account or public printer port. If Moonraker requires a key, set YAB3D_PRINTER_API_KEY in the launcher’s environment.</p></details>`;
 let review=null,request=null,busy=false;
 const signature=()=>JSON.stringify(getPalette());
 const clear=()=>{review=null;$('send').hidden=true;$('review').replaceChildren();};
 for(const id of ['address','key']) $(id).addEventListener('input',()=>{clear();$('status').textContent='Connection changed. Check again.';});
 function lock(value){busy=value;host.querySelectorAll('input,button,select').forEach(el=>el.disabled=value);}
 $('check').addEventListener('click',async()=>{
  if(busy)return;clear();lock(true);$('status').textContent='Reading U1 status…';
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
   $('send').hidden=false;$('status').textContent='Connected. Review is valid for one minute. Sending does not start a print.';
  }catch(error){clear();$('status').textContent=error instanceof TypeError?'Browser could not reach the U1. Check its address and local-network permission, or use the local launcher below.':error.message;}
  finally{lock(false);if(review)host.querySelectorAll('[data-slot]').forEach(el=>el.disabled=!review.before.slots[Number(el.dataset.slot)].present||review.before.slots[Number(el.dataset.slot)].spoolId!==0);}
 });
 $('send').addEventListener('click',async()=>{
  if(!review||busy)return;
  const job=review;job.channels=[...host.querySelectorAll('[data-slot]:checked')].map(el=>Number(el.dataset.slot));
  host.querySelectorAll('[data-finish]').forEach(el=>job.profiles[Number(el.dataset.finish)].subtype=el.value);
  lock(true);$('status').textContent='Sending reviewed metadata and checking the U1…';
  const result=await sendSetup(request,job,()=>signature()===job.signature);
  clear();$('status').textContent=result.message;lock(false);
 });
 return {refresh(){if(review&&!busy&&signature()!==review.signature){clear();$('status').textContent='Palette changed. Check the printer again before sending.';}}};
}
