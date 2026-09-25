// Original project transfer from the MakerWorld extension; never uploads a model.
const SENDERS = ['https://makerworld.com', 'https://makerworld.com.cn'];
export const MAX_MODEL_BYTES = 96 * 1024 * 1024;

export function receiveModel({host=window, mount, canReceive, load}) {
  const params = new URLSearchParams(host.location.hash.slice(1));
  const token = params.get('yab3d-model'), origin = params.get('sender');
  if (!token) return () => {};
  const note = host.document.createElement('p');
  note.className = 'hint'; note.setAttribute('role', 'status'); mount.prepend(note);
  if (!/^[a-f0-9]{32}$/.test(token) || !SENDERS.includes(origin) || !host.opener) {
    note.textContent = 'This MakerWorld connection is unavailable. Open YAB3D again from the extension, or drop the original 3MF here.';
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
  const cancel = () => { if(active){ post('error', {message:'The receiving page changed. Open YAB3D again from MakerWorld.'}); cleanup(); } };
  const manual = event => { if(event.type==='drop' || event.target?.type==='file'){ cancel(); note.textContent='MakerWorld transfer cancelled; using your selected file.'; } };
  async function listener(event) {
    const data=event.data;
    if (!active || event.origin!==origin || event.source!==source || data?.token!==token || data.version!==1) return;
    if(data.type==='yab3d-model:cancel'){ note.textContent='MakerWorld transfer cancelled. You can drop a 3MF here.'; cleanup(); return; }
    if(received || data.type!=='yab3d-model:file') return;
    try {
      if(!canReceive()) throw new Error('A model is already open. Open a new YAB3D tab from MakerWorld.');
      if(!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength<4 || data.bytes.byteLength>MAX_MODEL_BYTES) throw new Error('Choose a 3MF project up to 96 MB.');
      if(typeof data.name!=='string' || data.name.length>240 || !/\.3mf$/i.test(data.name) || /[\\/\x00-\x1f]/.test(data.name)) throw new Error('The transfer did not contain a valid 3MF filename.');
      const signature=new Uint8Array(data.bytes,0,4);
      if(signature[0]!==80 || signature[1]!==75 || signature[2]!==3 || signature[3]!==4) throw new Error('The captured file is not a 3MF ZIP archive. Download the original project and drop it here.');
      received=true; host.clearInterval(retry); host.clearTimeout(timer);
      post('received'); note.textContent='Original MakerWorld project received. Analysing '+data.name+'…';
      const ok=await load(new host.File([data.bytes], data.name, {type:'model/3mf'}));
      if(!active) return;
      if(!ok) throw new Error('YAB3D received the original file but could not open it. See the file analysis below.');
      note.textContent='Original MakerWorld project opened. Review its colours and settings before exporting.';
      post('opened'); cleanup();
    } catch(error) {
      if(!active) return;
      note.textContent=error.message; post('error',{message:error.message}); cleanup();
    }
  }
  const ready=()=>post('ready');
  const retry=host.setInterval(ready, 750);
  const timer=host.setTimeout(()=>{note.textContent='MakerWorld transfer timed out. Complete any MakerWorld verification and try again, or drop the original 3MF here.'; cancel();},120000);
  host.addEventListener('message',listener); host.addEventListener('pagehide',cancel);
  host.document.addEventListener('change',manual,true); host.document.addEventListener('drop',manual,true);
  note.textContent='Waiting for the original 3MF from MakerWorld…'; ready();
  return cancel;
}
