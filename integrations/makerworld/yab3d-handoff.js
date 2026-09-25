// Runs in the extension's isolated world. The original 3MF stays in browser memory.
globalThis.YAB3DModelHandoff = (() => {
  const origin='https://u1-reel-changes--yab3u1.netlify.app';
  function open(path, status) {
    const controller=new AbortController(), sourcePath=location.pathname;
    const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    const url=new URL(path==='recolour.html'?'/recolour.html':'/',origin);
    url.hash=new URLSearchParams({'yab3d-model':token,sender:location.origin});
    const popup=window.open(url.href,'_blank');
    if(!popup) throw new Error('Allow pop-ups for MakerWorld, then try Open in YAB3D again.');
    let active=true, ready=false, sent=false, file, resolve, reject;
    const completion=new Promise((yes,no)=>{resolve=yes;reject=no;});
    // The download capture runs before send() awaits this promise.
    completion.catch(()=>{});
    const post=(type,extra={})=>popup.postMessage({type:'yab3d-model:'+type,version:1,token,...extra},origin);
    const cleanup=()=>{active=false;clearTimeout(timer);clearInterval(poll);window.removeEventListener('message',listener);window.removeEventListener('pagehide',cancel);file=null;};
    const fail=message=>{if(!active)return;try{post('cancel');}catch{}cleanup();controller.abort();status(message);reject(new Error(message));};
    const cancel=()=>fail('Transfer cancelled. Open YAB3D again to retry.');
    function deliver(){if(active&&ready&&file&&!sent){sent=true;post('file',file);file=null;status('Original 3MF sent. Waiting for YAB3D analysis…');}}
    function listener(event){
      const data=event.data;
      if(!active||event.origin!==origin||event.source!==popup||data?.token!==token||data.version!==1)return;
      if(data.type==='yab3d-model:ready'){ready=true;deliver();}
      if(data.type==='yab3d-model:received'&&sent){clearTimeout(timer);timer=setTimeout(()=>fail('YAB3D received the file, but analysis has not finished. Check the YAB3D tab.'),300000);status('YAB3D received the original file. Analysing…');}
      if(data.type==='yab3d-model:opened'&&sent){cleanup();status('Original project opened in YAB3D. Review its colours and settings there.');resolve();}
      if(data.type==='yab3d-model:error')fail(typeof data.message==='string'?data.message.slice(0,300):'YAB3D could not open the file. Check its tab.');
    }
    let timer=setTimeout(()=>fail('Transfer timed out. Complete MakerWorld verification and try again.'),120000);
    const poll=setInterval(()=>{if(popup.closed)fail('YAB3D tab closed. Open it again to retry.');else if(location.pathname!==sourcePath)fail('MakerWorld model changed. Open YAB3D again for the new model.');},1000);
    window.addEventListener('message',listener);window.addEventListener('pagehide',cancel);
    status('Capturing the original MakerWorld project…');
    return {cancel, fail, signal:controller.signal, async send(bytes,name){
      if(!active)return completion;
      if(bytes.byteLength>96*1024*1024){fail('YAB3D accepts projects up to 96 MB.');return completion;}
      name=String(name||'MakerWorld-model.3mf').replace(/[\\/\x00-\x1f]/g,'_').slice(0,230).replace(/\.3mf$/i,'')+'.3mf';
      file={bytes:bytes.slice().buffer,name};deliver();return completion;
    }};
  }
  function mount({button,busy,capture}) {
    if(!button?.parentElement || document.getElementById('yab3d-model-tools'))return;
    const panel=document.createElement('div'); panel.id='yab3d-model-tools';
    panel.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px 10px;margin:12px 0;width:100%;min-width:0;box-sizing:border-box;flex:0 0 100%;grid-column:1/-1;clear:both;font:14px/1.5 system-ui;color:inherit';
    const style=document.createElement('style');
    style.textContent='#yab3d-model-tools :is(select,button):focus-visible{outline:2px solid currentColor;outline-offset:3px}#yab3d-model-tools button:disabled{opacity:.55;cursor:wait}#yab3d-model-tools button:hover:not(:disabled){background:#9bdf28}';
    const select=document.createElement('select');select.setAttribute('aria-label','YAB3D workspace');
    for(const [value,label] of [['index.html','Analyse & convert'],['recolour.html','Full Spectrum']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
    select.style.cssText='height:42px;width:100%;min-width:0;box-sizing:border-box;padding:0 12px;border:1px solid #888;border-radius:8px;background:Canvas;color:CanvasText;font:inherit';
    const launch=document.createElement('button');launch.type='button';launch.textContent='Open in YAB3D';
    launch.style.cssText='height:42px;box-sizing:border-box;padding:0 16px;border:1px solid #598500;border-radius:8px;background:#adf238;color:#132000;font:600 14px/1.5 system-ui;white-space:nowrap;cursor:pointer';
    const note=document.createElement('span');note.setAttribute('role','status');note.style.cssText='grid-column:1/-1;font-size:12px;overflow-wrap:anywhere';note.textContent='YAB3D review · open the original model';
    launch.addEventListener('click',async event=>{
      event.preventDefault();event.stopPropagation();
      if(busy()){note.textContent='Wait for the current MakerWorld download to finish.';return;}
      launch.disabled=true;select.disabled=true;let handoff;
      try{handoff=open(select.value,message=>note.textContent=message);await capture(handoff);}
      catch(error){if(handoff)handoff.fail(error.message);else note.textContent=error.message;}
      finally{launch.disabled=false;select.disabled=false;}
    });
    panel.append(style,select,launch,note);
    // MakerWorld nests the native button inside a horizontal action bar. Insert
    // after that bar, never between its download button and dropdown arrow.
    let anchor=button.parentElement;
    for(let level=0;level<3&&anchor.parentElement;level++){
      const parent=anchor.parentElement, css=getComputedStyle(parent);
      if(!['flex','inline-flex'].includes(css.display)||css.flexDirection!=='row'||parent.getBoundingClientRect().height>180)break;
      anchor=parent;
    }
    anchor.insertAdjacentElement('afterend',panel);
  }
  return {open,mount};
})();
