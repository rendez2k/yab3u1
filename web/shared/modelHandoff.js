// Original project transfer from MakerWorld or another same-origin YAB3D tab.
const SENDERS = ['https://makerworld.com', 'https://makerworld.com.cn'];
export const MAX_MODEL_BYTES = 96 * 1024 * 1024;

export function receiveModel({host=window, mount, canReceive, load}) {
  const params = new URLSearchParams(host.location.hash.slice(1));
  const token = params.get('yab3d-model'), origin = params.get('sender');
  if (!token) return () => {};
  const local = origin === host.location.origin && /^https?:$/.test(new URL(origin).protocol);
  const sourceName = local ? 'YAB3D' : 'MakerWorld';
  const context = local ? {
    purpose: params.get('purpose') === 'reel-changes' ? 'reel-changes' : 'blends',
    target: ['snapmaker','bambu','prusa'].includes(params.get('target')) ? params.get('target') : 'snapmaker',
    plateId: params.get('plate'),
  } : {};
  const note = host.document.createElement('p');
  note.setAttribute('data-model-handoff', '');
  note.className = 'hint'; note.setAttribute('role', 'status'); mount.prepend(note);
  if (!/^[a-f0-9]{32}$/.test(token) || !(local || SENDERS.includes(origin)) || !host.opener) {
    note.textContent = 'This model connection is unavailable. Open the model again from its source tab, or drop the original 3MF here.';
    return () => {};
  }
  const source = host.opener;
  host.history.replaceState(null, '', host.location.pathname + host.location.search);
  let active = true, received = false;
  const post = (type, extra={}) => source.postMessage({type:'yab3d-model:'+type, version:1, token, ...extra}, origin);
  const cleanup = () => {
    active = false; host.clearInterval(retry); host.clearTimeout(timer);
    host.removeEventListener('message', listener); host.removeEventListener('pagehide', cancel);
    host.document.removeEventListener('change', manual, true); host.document.removeEventListener('drop', manual, true);
  };
  const cancel = () => { if(active){ post('error', {message:'The receiving page changed. Open the model again from its source tab.'}); cleanup(); } };
  const manual = event => { if(event.type==='drop' || event.target?.type==='file'){ cancel(); note.textContent='Model transfer cancelled; using your selected file.'; } };
  async function listener(event) {
    const data=event.data;
    if (!active || event.origin!==origin || event.source!==source || data?.token!==token || data.version!==1) return;
    if(data.type==='yab3d-model:cancel'){ note.textContent='Model transfer cancelled. You can drop a 3MF here.'; cleanup(); return; }
    if(received || data.type!=='yab3d-model:file') return;
    try {
      if(!canReceive()) throw new Error('A model is already open. Open a new YAB3D tab from the source page.');
      if(!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength<4 || data.bytes.byteLength>MAX_MODEL_BYTES) throw new Error('Choose a 3MF project up to 96 MB.');
      if(typeof data.name!=='string' || data.name.length>240 || !/\.3mf$/i.test(data.name) || /[\\/\x00-\x1f]/.test(data.name)) throw new Error('The transfer did not contain a valid 3MF filename.');
      const signature=new Uint8Array(data.bytes,0,4);
      if(signature[0]!==80 || signature[1]!==75 || signature[2]!==3 || signature[3]!==4) throw new Error('The captured file is not a 3MF ZIP archive. Download the original project and drop it here.');
      received=true; host.clearInterval(retry); host.clearTimeout(timer);
      post('received'); note.textContent=`Original ${sourceName} project received. Analysing ${data.name}…`;
      const file=new host.File([data.bytes], data.name, {type:'model/3mf'});
      if(typeof data.displayName==='string' && data.displayName.trim() && data.displayName.length<=240 && !/[\x00-\x1f]/.test(data.displayName)) {
        file.yab3dDisplayName=data.displayName.trim();
      }
      const ok=await load(file, context);
      if(!active) return;
      if(!ok) throw new Error('YAB3D received the original file but could not open it. See the file analysis below.');
      note.textContent=`Original ${sourceName} project opened. Review its colours and settings before exporting.`;
      post('opened'); cleanup();
    } catch(error) {
      if(!active) return;
      note.textContent=error.message; post('error',{message:error.message}); cleanup();
    }
  }
  const ready=()=>post('ready');
  const retry=host.setInterval(ready, 750);
  const timer=host.setTimeout(()=>{note.textContent=local ? 'Model transfer timed out. Try again from the source tab, or drop the original 3MF here.' : 'MakerWorld transfer timed out. Complete any MakerWorld verification and try again, or drop the original 3MF here.'; cancel();},120000);
  host.addEventListener('message',listener); host.addEventListener('pagehide',cancel);
  host.document.addEventListener('change',manual,true); host.document.addEventListener('drop',manual,true);
  note.textContent=`Waiting for the original 3MF from ${sourceName}…`; ready();
  return cancel;
}

/** Same-origin tab transfer. Bytes stay in memory; the original is never mutated. */
export function sendModel({file, displayName, target='snapmaker', plateId, purpose='blends', host=window, status=()=>{}}) {
  if (!file || file.size > MAX_MODEL_BYTES) { status('Choose a 3MF project up to 96 MB first.'); return () => {}; }
  const token = Array.from(host.crypto.getRandomValues(new Uint8Array(16)), n=>n.toString(16).padStart(2,'0')).join('');
  const url = new URL('recolour.html', host.location.href);
  url.hash = new URLSearchParams({'yab3d-model':token, sender:host.location.origin, target, purpose, plate:String(plateId ?? '')}).toString();
  // Must happen synchronously during the user's click, before reading the file.
  const popup = host.open(url.href, '_blank');
  if (!popup) { status('Allow this site to open a new tab, then try again.'); return () => {}; }
  let active=true, sending=false;
  const finish = message => {
    if (!active) return;
    active=false; host.clearTimeout(timer); host.clearInterval(closed);
    host.removeEventListener('message',listener); host.removeEventListener('pagehide',cancel);
    status(message);
  };
  const cancel = () => {
    if (!active) return;
    popup.postMessage({type:'yab3d-model:cancel',version:1,token}, url.origin);
    finish('Model transfer cancelled. Open the current model again to continue.');
  };
  async function listener(event) {
    const data=event.data;
    if (!active || event.origin!==url.origin || event.source!==popup || data?.token!==token || data.version!==1) return;
    if (data.type==='yab3d-model:opened') finish('Original model opened in Full Spectrum. Continue in the new tab.');
    else if (data.type==='yab3d-model:error') finish(typeof data.message==='string' ? data.message : 'Model transfer failed.');
    else if (data.type==='yab3d-model:received') status('Model received; analysing in the new tab…');
    else if (data.type==='yab3d-model:ready' && !sending) {
      sending=true;
      try {
        const bytes=await file.arrayBuffer();
        if (active) popup.postMessage({type:'yab3d-model:file',version:1,token,bytes,name:file.name,displayName},url.origin);
      } catch (error) { cancel(); status(`Could not read this model: ${error.message}`); }
    }
  }
  const timer=host.setTimeout(()=>{cancel();status('Model transfer timed out. Try opening it again.');},120000);
  const closed=host.setInterval(()=>{if(popup.closed)finish('The receiving tab closed. Open Full Spectrum again to continue.');},750);
  host.addEventListener('message',listener);host.addEventListener('pagehide',cancel);
  status('Opening your original model in a new tab…');
  return cancel;
}
