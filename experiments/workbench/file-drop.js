/** File drops belong to the workspace, including same-origin engine frames.
 * Capture prevents an old drop-zone listener from opening the same file twice. */
export function installModelDrop(doc,{load,show=()=>{},error=()=>{},delegate=()=>false}) {
  let depth=0;
  const files=event=>Array.from(event.dataTransfer?.types || []).includes('Files');
  const clear=()=>{depth=0;show(false);};
  const handlers={
    dragenter(event){if(!files(event))return;event.preventDefault();depth++;show(true);},
    dragover(event){if(!files(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';show(true);},
    dragleave(event){if(!files(event))return;if(--depth<=0)clear();},
    drop(event){
      if(!files(event)&&!event.dataTransfer?.files?.length)return;
      event.preventDefault();event.stopImmediatePropagation();clear();
      const incoming=Array.from(event.dataTransfer.files || []);
      if(incoming.length!==1){error('Drop one model at a time. Use App menu → Batch for several 3MF files.');return;}
      const file=incoming[0];
      if(!/\.(3mf|glb|zip)$/i.test(file.name)){error('Open a 3MF, GLB or ZIP containing your OBJ and textures.');return;}
      Promise.resolve().then(()=>load(file)).catch(error);
    },
    keydown(event){if(event.key==='Escape')clear();}
  };
  const listeners=Object.fromEntries(Object.entries(handlers).map(([name,fn])=>[name,event=>{if(delegate(event)){clear();return;}fn(event);} ]));
  for(const [name,fn]of Object.entries(listeners))doc.addEventListener(name,fn,true);
  doc.defaultView?.addEventListener('blur',clear);
  return ()=>{clear();for(const [name,fn]of Object.entries(listeners))doc.removeEventListener(name,fn,true);doc.defaultView?.removeEventListener('blur',clear);};
}
