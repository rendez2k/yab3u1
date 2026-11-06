const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function mountProjectPlates({view,session,select,editColours}) {
  const panel=view.panels.layout,content=document.getElementById('platelayout').parentElement;
  panel.querySelector('h1').textContent='Plates & objects';
  panel.setAttribute('aria-label','Plates & objects');
  panel.querySelector('.task-heading p').textContent='Choose a plate, edit its objects, then save the complete project.';
  const host=view.make('section',{class:'project-plates','aria-label':'Project plates'},
    '<div class="plate-collection-heading"><h2>Project plates</h2><span data-plate-count></span></div><div class="source-plate-list" role="group" aria-label="Choose a plate"></div><div class="plate-management"><button data-delete-plate>Delete this plate</button><button data-restore-plate hidden>Undo deletion</button></div><div class="project-saves"><button class="primary" data-save-project>Save all plates · 3MF</button><button data-save-jobs>Export print jobs · ZIP</button><p class="hint">3MF keeps your plates together for editing. ZIP gives each plate its own printer file and filament list.</p><p class="hint" data-project-result role="status" aria-live="polite"></p></div>');
  content.prepend(host);
  const $=q=>host.querySelector(q),result=$('[data-project-result]'),list=$('.source-plate-list');
  // The legacy plate selector now lives beside plate operations, never in a
  // different task panel. Keep it hidden as the shared engine's event bridge.
  const legacy=document.getElementById('convertplate').closest('.field');legacy.hidden=true;host.append(legacy);
  const quantities=document.getElementById('objectquantities');quantities.open=true;
  quantities.querySelector('summary').textContent='Objects on this plate';
  quantities.querySelector('.hint').textContent='Add copies or remove an object. Its parts stay together. Ctrl/Cmd+Z undoes quantity changes.';
  host.after(quantities);
  const arrangement=document.getElementById('platelayout');
  const advanced=view.make('details',{class:'plate-layout-options'},'<summary>Spacing, fill & bed settings</summary>');
  arrangement.before(advanced);advanced.append(arrangement);
  const autoArrange=panel.querySelector('.auto-arrange-controls');quantities.after(autoArrange);
  autoArrange.after(document.getElementById('printoptimiser'));
  const help=panel.querySelector(':scope > .workflow-explanation');if(help)advanced.append(help);
  let key='',pending=false,urls=[],fileEpoch=-1,downloadUrl=null,downloadRevision=-1;
  const rows=new Map();
  function draw(){
    const scrollTop=list.scrollTop;
    const focused=document.activeElement?.closest('[data-source-plate]');
    const focusedPlate=focused&&list.contains(focused)?focused.dataset.sourcePlate:null;
    const visible=session.visiblePlates();$('[data-plate-count]').textContent=`${visible.length} ${visible.length===1?'plate':'plates'}`;
    list.innerHTML=visible.map((p,i)=>{
      const r=rows.get(String(p.id)),active=String(p.id)===String(session.state?.plateId);
      return `<button type="button" class="source-plate" data-source-plate="${escape(p.id)}" aria-pressed="${active}">${r?.url?`<img src="${r.url}" alt="" width="64" height="64">`:'<span class="plate-thumbnail-placeholder" aria-hidden="true"></span>'}<span class="source-plate-copy"><strong>${escape(p.name || `Plate ${i+1}`)}</strong><span>${r?.objectCount!=null?`${r.objectCount} objects`:'Measuring…'}</span><span class="plate-filament-swatches">${(r?.colours||[]).map(c=>`<i style="background:${/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#ffffff'}" title="Slot ${c.slot}: ${escape(c.color)} ${escape(c.type)}"></i>`).join('')}${r?.problem?'<b>Needs review</b>':''}</span></span></button>`;
    }).join('');
    list.scrollTop=scrollTop;
    // Async thumbnail/count updates must not drop a keyboard user's position.
    if(focusedPlate!=null)[...list.querySelectorAll('[data-source-plate]')].find(b=>b.dataset.sourcePlate===focusedPlate)?.focus({preventScroll:true});
    const active=rows.get(String(session.state?.plateId));
    let note=host.querySelector('[data-plate-review]');
    if(!note){note=view.make('p',{'data-plate-review':'',class:'plate-review'});$('.plate-management').before(note);}
    note.replaceChildren();note.hidden=!active?.problem;
    if(active?.problem){note.append(document.createTextNode(active.problem+' '));if(active.plan!==false&&/colours|inputs|slots/.test(active.problem)){const b=view.make('button',{type:'button'},'Review colours');b.onclick=editColours;note.append(b);}}
  }
  async function refresh(){
    if(pending||!session.state||!session.worker)return;
    const jobs=session.plateJobs(),options=session.plateExportOptions(),signature=JSON.stringify([session.epoch,jobs,options]);
    if(signature===key)return;
    pending=true;const epoch=session.epoch;
    try{
      const reply=await session.worker.request('review-plates',{jobs,options});
      if(epoch!==session.epoch||signature!==JSON.stringify([session.epoch,session.plateJobs(),session.plateExportOptions()]))return;
      for(const url of urls)URL.revokeObjectURL(url);urls=[];rows.clear();
      for(const row of reply.plates){if(row.thumbnail){row.url=URL.createObjectURL(new Blob([row.thumbnail],{type:'image/png'}));urls.push(row.url);}rows.set(String(row.plateId),row);}
      key=signature;draw();
    }catch(error){if(epoch===session.epoch){key=signature;result.textContent=error.message;}}
    finally{pending=false;}
  }
  async function switchPlate(id){if(session.busy)return;await select(id);draw();refresh();}
  list.onclick=e=>{const b=e.target.closest('[data-source-plate]');if(b)switchPlate(b.dataset.sourcePlate);};
  $('[data-delete-plate]').onclick=async()=>{try{const name=session.state.plates.find(p=>String(p.id)===String(session.state.plateId))?.name;session.deletePlate();await select(session.state.plateId,true);result.textContent=`${name || 'Plate'} deleted. Undo deletion restores its objects and edits.`;draw();refresh();}catch(e){result.textContent=e.message;}};
  $('[data-restore-plate]').onclick=async()=>{session.restorePlate();await select(session.state.plateId,true);result.textContent='Plate restored.';draw();refresh();};
  async function save(format){
    result.textContent=format==='project'?'Saving the complete project…':'Preparing separate print jobs…';
    const output=await session.exportPlates(format);
    if(!output){result.textContent='Could not save. Check the plate review or the message above the preview.';return;}
    if(downloadUrl)URL.revokeObjectURL(downloadUrl);
    downloadUrl=URL.createObjectURL(new Blob([output.bytes],{type:format==='zip'?'application/zip':'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'}));
    downloadRevision=session.revision;
    const a=document.createElement('a');a.href=downloadUrl;a.download=output.name;a.textContent=`Download ${output.name} again`;
    a.click();result.replaceChildren(document.createTextNode(`${output.plates} plates saved. ${output.notes?.filter(n=>/four logical|need review/.test(n)).join(' ') || ''} `),a);
  }
  $('[data-save-project]').onclick=()=>save('project');$('[data-save-jobs]').onclick=()=>save('zip');
  return {save,primary:$('[data-save-project]'),sync(){
    if(!session.state)return;
    if(downloadUrl&&downloadRevision!==session.revision){URL.revokeObjectURL(downloadUrl);downloadUrl=null;result.replaceChildren();}
    if(fileEpoch!==session.epoch){fileEpoch=session.epoch;key='';rows.clear();draw();}
    const disabled=session.busy||session.boundsPending;
    for(const b of host.querySelectorAll('button'))b.disabled=disabled;
    $('[data-delete-plate]').disabled=disabled||session.visiblePlates().length<2;
    $('[data-restore-plate]').hidden=!session.plateCollection.undo.length;
    $('[data-save-project]').disabled=disabled||session.target==='prusa';
    for(const b of list.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.sourcePlate===String(session.state.plateId)));
    refresh();
  }};
}
