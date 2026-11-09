export function mountSplitPreview({root,source,options,inspection,busy=()=>false,changed=()=>{},reports=()=>{},returnToEdit=()=>{}}){
  root.innerHTML='<button type="button" data-split-preview>Preview split</button><div data-assembly-controls hidden><label class="studio-field">Separate pieces <output data-explode-label>15 mm</output><input type="range" min="0" max="60" value="15" step="1" data-explode aria-label="Separate preview pieces"></label><div class="boundary-actions"><button type="button" data-assembly-together>Show assembled</button><button type="button" data-assembly-back>Back to editing</button></div></div><p class="hint" data-assembly-status role="status" aria-live="polite">Inspect the closed pieces before applying.</p>';
  const q=s=>root.querySelector(s);let worker=null,pending=false,dead=false,active=false,signature='',file=null,soup=null,request=0;
  const status=(text,error=false)=>{q('[data-assembly-status]').textContent=text;q('[data-assembly-status]').dataset.error=String(error);};
  function invalidate(){request++;worker?.terminate();worker=null;pending=false;soup=null;file=null;reports([]);inspection.hide('assembly');q('[data-assembly-controls]').hidden=true;status('Inspect the closed pieces before applying.');}
  function sync({enabled=active}={}){if(dead)return;active=enabled;let next='';try{next=JSON.stringify(options());}catch{}
    if((signature&&next!==signature)||(file&&file!==source())||(soup&&inspection.owner!=='assembly'))invalidate();signature=next;
    q('[data-split-preview]').disabled=busy()||!active;q('[data-split-preview]').textContent=pending?'Cancel preview':'Preview split';
    for(const c of root.querySelectorAll('[data-assembly-controls] button,input'))c.disabled=busy()||pending;
  }
  function explode(){if(inspection.owner!=='assembly')return;const gap=Number(q('[data-explode]').value);q('[data-explode-label]').textContent=`${gap} mm`;inspection.explode(gap);}
  async function check(){
    if(dead||busy()||!active)return;if(pending){invalidate();sync();changed();return;}
    let opts;try{opts=options();}catch(e){status(e.message,true);return;}invalidate();const stamp=request;file=source();if(!file)return;pending=true;signature=JSON.stringify(opts);status('Closing the pieces and checking connectors…');sync();changed();
    try{const bytes=await file.arrayBuffer();if(stamp!==request||dead)return;worker=new Worker(new URL('./model-edit-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{if(stamp!==request||dead)return;if(data.progress){status(data.progress);return;}worker?.terminate();worker=null;pending=false;
        if(data.error){status(data.error,true);sync();changed();return;}soup=data.assembly?.positions.length?data.assembly:null;reports(data.reports||[]);
        if(!soup?.positions.length){status(data.reports?.flatMap(r=>r.retained||[])[0]?.reason||'No pieces could be separated. Adjust the split and try again.',true);sync();changed();return;}
        try{inspection.show('assembly',soup,'Split preview · model unchanged');q('[data-explode]').value='15';explode();q('[data-assembly-controls]').hidden=false;status(`${soup.ranges.length} pieces checked, including any dowels. Assembled view uses their original positions; Apply places them for printing.`);}catch(e){status(e.message,true);}
        sync();changed();
      };
      worker.onerror=()=>{if(stamp!==request||dead)return;invalidate();status('The preview stopped. Try again; your model is unchanged.',true);sync();changed();};
      worker.postMessage({bytes,options:{...opts,previewOnly:true,includeAssembly:true}},[bytes]);
    }catch(e){if(stamp===request&&!dead){pending=false;status(e.message,true);sync();changed();}}
  }
  function click(e){const b=e.target.closest('button');if(!b)return;if(b.matches('[data-split-preview]'))check();if(b.matches('[data-assembly-together]')){q('[data-explode]').value='0';explode();}if(b.matches('[data-assembly-back]')){invalidate();returnToEdit();sync();changed();}}
  root.addEventListener('click',click);q('[data-explode]').addEventListener('input',explode);
  return {sync,invalidate,get pending(){return pending;},destroy(){dead=true;invalidate();root.removeEventListener('click',click);q('[data-explode]').removeEventListener('input',explode);}};
}
