const icons={select:'<path d="m5 3 14 9-7 1-3 7z"/>',colour:'<path d="m14 3 7 7-10 10H4v-7zM11 6l7 7M3 21h18"/>',split:'<path d="M3 4h7v6H3zM14 14h7v6h-7zM18 3 6 21"/>',arrange:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'};
const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
export function mountStudio({view,engine,kind,api,objects,setPanel}){
  const doc=view.stage.ownerDocument,make=view.make;
  let multiple=false,preferredColour='';
  let mode='select',selectionKey='',knownSource=null,working=false,committing=false,worker=null,rejectPending=null,baseColours=null,sourceColours=null,previewPending=false,previewRequest=0,undo=[],request=0;
  const tools=make('nav',{class:'studio-toolstrip','aria-label':'Model tools'},Object.entries({select:'Select',colour:'Colour',split:'Split',arrange:'Arrange'}).map(([key,label])=>`<button data-studio-tool="${key}" aria-pressed="${key===mode}" title="${label}">${svg(key)}<span>${label}</span></button>`).join('')+'<button data-studio-undo title="Undo model edit (Ctrl+Z)" aria-label="Undo model edit" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12"/></svg></button>');
  view.stage.append(tools);
  const panel=make('section',{'data-task':'edit',hidden:'','aria-label':'Selected objects'},'<div class="task-heading"><h1 data-edit-heading>Objects</h1><p data-selection-title>Choose an object on the canvas.</p></div><button data-multi-select aria-pressed="false">Select multiple</button><p class="hint" data-multi-hint hidden>Tap objects on the canvas or in the list to add or remove them from the selection.</p><div data-selection-controls></div><div data-tool-settings></div><p class="studio-message" role="status" aria-live="polite"></p><div class="studio-apply" hidden><button data-edit-cancel>Cancel</button><button class="primary" data-edit-apply>Apply colour</button></div><details class="studio-objects" open><summary>Objects on this plate <span data-scene-count></span></summary><div data-scene-list></div></details>');
  view.panels.edit=panel;view.inspector.append(panel);
  panel.querySelector('[data-selection-controls]').append(objects.element);
  const oldUndo=objects.element.querySelector('[data-object-edit=undo]');if(oldUndo)oldUndo.hidden=true;
  const settings=panel.querySelector('[data-tool-settings]'),message=panel.querySelector('.studio-message'),actions=panel.querySelector('.studio-apply');
  const palette=()=>kind==='converter'?engine.session.state?.colours||[]:engine.state.project?.colors||[];
  const state=()=>engine.workbenchObjects();
  const selected=()=>objects.selected();
  const snapshot=()=>({file:api.source(),context:api.context(),settings:engine.workbenchCaptureSettings?.()});
  const sourceName=(colour,i)=>`Colour ${i+1} · ${colour}`;
  const commonColours=()=>{const s=state(),ids=selected();return palette().map((colour,i)=>({colour,index:i+1})).filter(c=>ids.every(id=>{const o=s.objects.find(o=>String(o.objectId)===id);return !o?.colours?.length||o.colours.some(v=>Number(v.extruder)===c.index);}));};
  const splitMethod=()=>settings.querySelector('[data-split-method]')?.value||'cut';
  const splitOperation=()=>splitMethod()==='by-colour'?settings.querySelector('[data-colour-action]').value:splitMethod();
  const applyLabel=()=>mode==='colour'?'Apply colour':splitOperation()==='remove-colour'?'Remove coloured part':splitMethod()==='by-colour'?'Separate colour':'Split objects';
  function loadSourcePreview(){const stamp=++previewRequest;previewPending=true;engine.workbenchSourceColours().then(colours=>{if(stamp!==previewRequest)return;sourceColours=colours;previewPending=false;preview();sync();}).catch(error=>{if(stamp!==previewRequest)return;previewPending=false;message.textContent=error.message;sync();});}
  function restorePreview(){previewRequest++;previewPending=false;sourceColours=null;const p=state().preview;if(p){p.suppressSelection=false;if(baseColours&&baseColours.length===p.lastPositions?.length)p.setColors(baseColours);p.requestDraw();}baseColours=null;}
  function show(next){
    if(working)return;
    restorePreview();mode=next;message.textContent='';
    for(const b of tools.querySelectorAll('[data-studio-tool]'))b.setAttribute('aria-pressed',String(b.dataset.studioTool===mode));
    if(next==='arrange'){setPanel('layout');return;}
    setPanel('edit');render();
  }
  function render(){
    const s=state(),ids=selected(),colours=palette();
    panel.dataset.editing=String(['colour','split'].includes(mode)&&ids.length>0);
    panel.querySelector('[data-edit-heading]').textContent={select:'Objects',colour:'Colour selection',split:'Split selection'}[mode]||'Objects';
    const names=ids.map(id=>s.objects.find(o=>String(o.objectId)===id)?.name||`Object ${id}`);
    panel.querySelector('[data-selection-title]').textContent=!ids.length?'Click an object on the canvas or choose it below.':ids.length===1?names[0]:`${ids.length} copies selected`;
    objects.element.hidden=mode!=='select';actions.hidden=!['colour','split'].includes(mode)||!ids.length;settings.replaceChildren();
    if(mode==='select'){
      const quick=make('div',{class:'studio-colour-select'},'<h2>Select single-colour objects</h2><div class="studio-region-swatches" data-find-colours></div><p class="hint">Select whole objects by their original colour, then remove or duplicate them.</p><button data-open-colour-split>Separate a painted colour…</button>');
      let count=0;
      colours.forEach((colour,i)=>{const matches=s.objects.filter(o=>(s.quantities[o.objectId]??1)*s.copies>0&&!o.undecodable&&o.colours?.length===1&&Number(o.colours[0].extruder)===i+1);if(!matches.length)return;count++;const b=make('button',{'data-find-colour':String(i+1),title:sourceName(colour,i)},`<i aria-hidden="true"></i><span>Colour ${i+1}</span>`);b.style.setProperty('--swatch',colour);quick.querySelector('[data-find-colours]').append(b);});
      if(!count){quick.querySelector('h2').textContent='Remove part of a model';quick.querySelector('.hint').textContent='Choose a painted colour to detach or remove just that region. The rest of the object stays.';}
      settings.append(quick);return;
    }
    if(!ids.length){settings.append(make('p',{class:'hint'},'Select the copies you want to change. Shift-click adds to your selection.'));return;}
    if(mode==='colour'){
      settings.innerHTML='<label class="studio-field">Paint area<select data-paint-area><option value="all">Whole selected objects</option></select></label><label class="studio-field">Filament colour<div class="studio-colour-input"><input type="color" value="#F58231" data-paint-colour aria-label="New filament colour"><span data-hex>#F58231</span></div></label><div class="studio-swatches" aria-label="Source filament colours"></div><p class="hint">Only the selected copies change. Choosing an existing colour reuses its filament.</p>';
      const area=settings.querySelector('[data-paint-area]');
      colours.forEach((c,i)=>area.add(new Option(`Replace colour ${i+1} · ${c}`,String(i+1))));
      for(const colour of colours){const b=make('button',{type:'button','aria-label':`Use ${colour}`,title:colour,'data-swatch':colour});b.style.setProperty('--swatch',colour);settings.querySelector('.studio-swatches').append(b);}
      settings.querySelector('[data-paint-colour]').value=colours[0]||'#F58231';
      settings.querySelector('.hint').textContent='Editing original paint on the selected copies. Export palette replacements still apply. Other copies stay unchanged.';
      panel.querySelector('[data-edit-apply]').textContent='Apply colour';
      loadSourcePreview();
    }else if(mode==='split'){
      settings.innerHTML='<label class="studio-field">Split method<select data-split-method><option value="by-colour">By painted colour</option><option value="cut">Plane cut</option><option value="separate">Disconnected parts</option></select></label><div data-region-settings><label class="studio-field">Colour to separate<select data-region-colour aria-label="Colour to separate"><option value="">Choose a source colour</option></select></label><div class="studio-region-swatches" data-region-swatches aria-label="Choose a source colour"></div><label class="studio-field">What to do<select data-colour-action><option value="separate-colour">Keep both parts</option><option value="remove-colour">Remove this coloured part</option></select></label></div><div data-plane-settings hidden><label class="studio-field">Direction<select data-cut-axis><option value="2">Horizontal · Z</option><option value="0">Left / right · X</option><option value="1">Front / back · Y</option></select></label><label class="studio-field">Cut position <output data-cut-label>50%</output><input type="range" min="1" max="99" step="0.5" value="50" data-cut-position></label></div><div data-joint-settings><label class="studio-check"><input type="checkbox" data-add-pin> Add locating pin &amp; socket</label><div data-pin-settings hidden><div class="studio-dimensions"><label>Diameter (mm)<input type="number" min="1" max="20" step="0.1" value="3" data-pin-diameter></label><label>Length (mm)<input type="number" min="1" max="20" step="0.1" value="3" data-pin-length></label><label>Fit clearance (mm)<input type="number" min="0.05" max="1" step="0.05" value="0.3" data-pin-clearance></label></div><label class="studio-field">Pin on<select data-pin-side><option value="selected">Separated colour / upper half</option><option value="base">Remaining model / lower half</option></select></label><p class="hint">Pin position is fitted automatically. Clearance is added to the socket diameter; its depth is 0.2 mm longer than the pin. Check the fit with a small test print.</p></div></div><p class="hint" data-split-hint></p>';
      const area=settings.querySelector('[data-region-colour]');
      for(const {colour,index} of commonColours()){area.add(new Option(sourceName(colour,index-1),String(index)));const b=make('button',{'data-region-colour-button':String(index),'aria-label':sourceName(colour,index-1),'aria-pressed':'false'},`<i aria-hidden="true"></i><span>${index}</span>`);b.style.setProperty('--swatch',colour);settings.querySelector('[data-region-swatches]').append(b);}
      if(preferredColour&&commonColours().some(c=>String(c.index)===preferredColour))area.value=preferredColour;
      preferredColour='';loadSourcePreview();
      panel.querySelector('[data-edit-apply]').textContent='Split objects';
    }
    preview();
  }
  function preview(){
    if(!['colour','split'].includes(mode)||working)return;
    const p=state().preview;if(!p?.lastPositions)return;
    if(!baseColours)baseColours=p.lastColors?.slice();if(!baseColours)return;
    const source=sourceColours?.length===baseColours.length?sourceColours:baseColours;
    const colours=source.slice(),ranges=[...p.selectedRanges].map(i=>p.pickRanges[i]).filter(Boolean);
    if(mode==='colour'){
      const hex=settings.querySelector('[data-paint-colour]').value,from=settings.querySelector('[data-paint-area]').value;
      settings.querySelector('[data-hex]').textContent=hex.toUpperCase();
      const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),hexSource=palette()[Number(from)-1];
      const match=hexSource?[1,3,5].map(i=>parseInt(hexSource.slice(i,i+2),16)/255):null;
      for(const r of ranges)for(let i=r.start*3;i<(r.start+r.count)*3;i+=3)if(!match||match.every((c,j)=>Math.abs(c-source[i+j])<.015))colours.set(rgb,i);
    }else if(mode==='split'){
      const method=splitMethod(),axis=Number(settings.querySelector('[data-cut-axis]').value),position=Number(settings.querySelector('[data-cut-position]').value),removing=splitOperation()==='remove-colour';
      settings.querySelector('[data-plane-settings]').hidden=method!=='cut';settings.querySelector('[data-cut-label]').textContent=`${position}%`;
      settings.querySelector('[data-region-settings]').hidden=method!=='by-colour';settings.querySelector('[data-joint-settings]').hidden=method==='separate'||removing;
      settings.querySelector('[data-pin-settings]').hidden=!settings.querySelector('[data-add-pin]').checked;
      settings.querySelector('[data-pin-side]').options[0].textContent=method==='by-colour'?'Separated colour':'Upper / positive half';settings.querySelector('[data-pin-side]').options[1].textContent=method==='by-colour'?'Remaining model':'Lower / negative half';
      settings.querySelector('[data-split-hint]').textContent=method==='cut'?'Cuts through the object and closes both faces. Both parts stay on this plate.':method==='by-colour'?(removing?'Removes the highlighted coloured region and closes the remaining model. Undo brings it back.':'Follows the original paint boundary and closes both parts. Best for protruding parts such as a stalk; flat paint patches cannot be detached.'):'Separates existing disconnected pieces without changing their painting. Turn to By painted colour for a part joined to the model.';
      if(method==='cut')for(const r of ranges){let lo=Infinity,hi=-Infinity;for(let i=r.start*3+axis;i<(r.start+r.count)*3;i+=3){lo=Math.min(lo,p.lastPositions[i]);hi=Math.max(hi,p.lastPositions[i]);}const cut=lo+(hi-lo)*position/100;for(let i=r.start*3;i<(r.start+r.count)*3;i+=9){const side=(p.lastPositions[i+axis]+p.lastPositions[i+3+axis]+p.lastPositions[i+6+axis])/3>cut,rgb=side?[.34,.64,.85]:[.94,.57,.28];for(let k=0;k<9;k++)colours[i+k]=.45*colours[i+k]+.55*rgb[k%3];}}
      if(method==='by-colour'){const from=settings.querySelector('[data-region-colour]').value,hex=palette()[Number(from)-1],match=hex?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255):null;for(const b of settings.querySelectorAll('[data-region-colour-button]'))b.setAttribute('aria-pressed',String(b.dataset.regionColourButton===from));if(match)for(const r of ranges)for(let i=r.start*3;i<(r.start+r.count)*3;i+=3){const yes=match.every((c,j)=>Math.abs(c-source[i+j])<.015);if(!yes)for(let j=0;j<3;j++)colours[i+j]=source[i+j]*.18+.68;}}
    }
    p.suppressSelection=true;p.setColors(colours);sync();
  }
  async function loadSnapshot(saved){if(!await api.load(saved.file,{...saved.context,edit:true}))throw Error('The edited model could not be opened.');await engine.workbenchRestoreSettings?.(saved.settings);objects.history.reset();knownSource=api.source();setPanel('edit');}
  async function apply(){
    if(working||previewPending||!['colour','split'].includes(mode))return;
    const s=state(),ids=selected(),before=snapshot();if(!ids.length||!before.file)return;
    if(mode==='split'&&splitMethod()==='by-colour'&&!settings.querySelector('[data-region-colour]').value){message.textContent='Choose the source colour to separate.';return;}
    const options={objectIds:ids,plateId:before.context.plateId,operation:mode==='colour'?'colour':splitOperation(),from:mode==='colour'?settings.querySelector('[data-paint-area]')?.value||'all':settings.querySelector('[data-region-colour]')?.value,colour:settings.querySelector('[data-paint-colour]')?.value,axis:Number(settings.querySelector('[data-cut-axis]')?.value||2),position:Number(settings.querySelector('[data-cut-position]')?.value||50)};
    if(mode==='split'&&settings.querySelector('[data-add-pin]').checked&&['cut','separate-colour'].includes(options.operation))options.connector={diameter:Number(settings.querySelector('[data-pin-diameter]').value),length:Number(settings.querySelector('[data-pin-length]').value),clearance:Number(settings.querySelector('[data-pin-clearance]').value),side:settings.querySelector('[data-pin-side]').value};
    const stamp=++request;working=true;restorePreview();message.textContent='Preparing your edit…';sync();
    try{
      const bytes=await before.file.arrayBuffer();
      if(stamp!==request)return;
      const result=await new Promise((resolve,reject)=>{
        rejectPending=reject;
        worker=new Worker(new URL('./model-edit-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{if(data.progress){message.textContent=data.progress;return;}data.error?reject(Error(data.error)):resolve(data);};worker.onerror=()=>reject(Error('The editing worker stopped. Your current model is unchanged.'));
        worker.postMessage({bytes,options},[bytes]);
      });
      if(stamp!==request)return;
      const quantities=Object.fromEntries(s.objects.map(o=>[o.objectId,(s.quantities[o.objectId]??1)*s.copies]));
      for(const c of result.changes){quantities[c.oldId]=Math.max(0,(quantities[c.oldId]??1)-1);for(const n of c.created)quantities[n.id]=1;}
      const file=new File([result.bytes],before.file.name,{type:before.file.type});
      const next={...before,file,context:{...before.context,layout:{...before.context.layout,copies:1,quantities,arrangement:'objects'}}};
      committing=true;sync();
      try{await loadSnapshot(next);}catch(error){await loadSnapshot(before);throw error;}
      undo.push(before);if(undo.length>6)undo.shift();
      mode='select';selectionKey='';message.textContent=options.operation==='colour'?'Colour applied to the selected copies.':options.operation==='remove-colour'?'Coloured part removed; the remaining surface is closed. Undo restores it.':options.connector?'Parts separated with a locating pin and matching socket. Arrange the plate to see them apart; Undo restores the original.':'Parts separated. Select a part to colour it, duplicate it or arrange the plate.';render();
    }catch(error){if(stamp===request)message.textContent=error.message;}finally{worker?.terminate();worker=null;rejectPending=null;working=false;committing=false;sync();}
  }
  async function undoEdit(){if(working||!undo.length)return;working=true;restorePreview();message.textContent='Restoring your previous model…';try{await loadSnapshot(undo.at(-1));undo.pop();mode='select';selectionKey='';render();message.textContent='Model edit undone.';}catch(e){message.textContent=e.message;}finally{working=false;sync();}}
  const undoKind=()=>objects.history?.canUndo?'plate':undo.length?'model':null;
  async function undoCurrent(){if(working||state().busy)return;if(undoKind()==='plate')await objects.act('undo');else await undoEdit();sync();}
  let listStamp='';
  function sync(){
    const s=state();tools.hidden=!s.objects.length;if(s.preview)s.preview.selectionToggle=multiple;
    panel.querySelector('[data-multi-select]').setAttribute('aria-pressed',String(multiple));panel.querySelector('[data-multi-hint]').hidden=!multiple;
    const guide=objects.element.querySelector('[data-object-message]');if(guide&&/Shift-click/.test(guide.textContent))guide.textContent='Use Select multiple to pick several copies. Keyboard: Shift adds, Ctrl/Cmd toggles; Delete removes; Ctrl/Cmd+Z undoes.';
    const currentSource=api.source();if(!working&&currentSource!==knownSource){knownSource=currentSource;undo=[];baseColours=null;message.textContent='';}
    const ids=selected(),key=JSON.stringify([s.key,ids]);
    if(!working&&key!==selectionKey){restorePreview();selectionKey=key;if(mode!=='arrange'){if(ids.length)setPanel('edit');render();}}
    const catalogue=JSON.stringify([s.key,s.objects.map(o=>[o.objectId,o.name]),s.quantities,s.copies,ids]);
    if(catalogue!==listStamp){listStamp=catalogue;if(mode==='select'&&!working)render();const list=panel.querySelector('[data-scene-list]');list.replaceChildren();let total=0;
      for(const o of s.objects){const count=(s.quantities[o.objectId]??1)*s.copies;if(!count)continue;total+=count;const b=make('button',{'data-scene-object':o.objectId,'aria-pressed':String(ids.includes(String(o.objectId)))});b.append(make('span',{},''),make('span',{},''));b.children[0].textContent=o.name||`Object ${o.objectId}`;b.children[1].textContent=`×${count}`;list.append(b);}
      panel.querySelector('[data-scene-count]').textContent=String(total);
    }
    const apply=panel.querySelector('[data-edit-apply]');apply.disabled=working||s.busy;apply.textContent=working?'Working…':applyLabel();
    panel.setAttribute('aria-busy',String(working));for(const b of tools.querySelectorAll('button')){b.disabled=working||s.busy;if(b.dataset.studioTool)b.setAttribute('aria-pressed',String(b.dataset.studioTool===mode));}const undoButton=tools.querySelector('[data-studio-undo]'),nextUndo=undoKind();undoButton.disabled=working||s.busy||!nextUndo;undoButton.setAttribute('aria-label',nextUndo?`Undo ${nextUndo} edit`:'Undo');undoButton.title=nextUndo?`Undo ${nextUndo} edit (Ctrl/Cmd+Z)`:'Nothing to undo';
    for(const control of panel.querySelectorAll('input,select,button'))if(!control.closest('.workbench-object-tools'))control.disabled=working||s.busy;
    panel.querySelector('[data-edit-cancel]').disabled=committing;
    apply.disabled=working||s.busy||previewPending||(mode==='split'&&splitMethod()==='by-colour'&&!settings.querySelector('[data-region-colour]')?.value);
    objects.element.inert=working;
  }
  tools.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.studioTool)show(b.dataset.studioTool);if(b?.matches('[data-studio-undo]'))undoCurrent();});
  panel.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.matches('[data-multi-select]')){multiple=!multiple;sync();}
    if(b.dataset.swatch){settings.querySelector('[data-paint-colour]').value=b.dataset.swatch;preview();}
    if(b.dataset.regionColourButton){settings.querySelector('[data-region-colour]').value=b.dataset.regionColourButton;preview();}
    if(b.matches('[data-open-colour-split]'))show('split');
    if(b.dataset.findColour){const s=state(),ids=new Set(s.objects.filter(o=>(s.quantities[o.objectId]??1)*s.copies>0&&!o.undecodable&&o.colours?.length===1&&Number(o.colours[0].extruder)===Number(b.dataset.findColour)).map(o=>String(o.objectId))),p=s.preview;
      if(p?.pickRanges.length){p.selectedRanges.clear();for(let i=0;i<p.pickRanges.length;i++)if(ids.has(String(p.pickRanges[i].objectId)))p.selectedRanges.add(i);p.selectedRange=[...p.selectedRanges][0]??null;p.onSelectionChange?.();p.requestDraw();objects.sync();sync();message.textContent=p.selectedRanges.size===1?'One single-colour object selected. Remove one deletes this whole object.':`${p.selectedRanges.size} single-colour copies selected. Remove selected deletes these whole objects.`;}
      else message.textContent='Select the matching objects by name below; 3D selection is unavailable in this browser.';
    }
    if(b.matches('[data-edit-cancel]')){if(committing)return;if(working){request++;worker?.terminate();rejectPending?.(Error('Cancelled'));working=false;message.textContent='Edit cancelled. Your model is unchanged.';}show('select');}
    if(b.matches('[data-edit-apply]'))apply();
    if(b.dataset.sceneObject){const p=state().preview;if(p?.pickRanges.length){p.selectRange(p.pickRanges.findIndex(r=>String(r.objectId)===b.dataset.sceneObject),e);objects.sync();}else{objects.element.querySelector('select').value=b.dataset.sceneObject;objects.element.querySelector('select').dispatchEvent(new Event('change'));}sync();}
  });
  settings.addEventListener('input',preview);settings.addEventListener('change',preview);
  return {sync,show,get busy(){return working;},get pending(){return ['colour','split'].includes(mode)&&selected().length>0;},leavePanel(){if(!working&&['colour','split'].includes(mode)){restorePreview();mode='select';}},key(e){if(e.target?.closest?.('input,select,textarea,[contenteditable=true]'))return false;if(working){if(['Delete','Escape','z'].includes(e.key)){e.preventDefault();return true;}return false;}if(e.key==='Delete'&&['colour','split'].includes(mode)){e.preventDefault();message.textContent=mode==='split'?'To remove only a colour, choose “Remove this coloured part”. Cancel to delete whole objects.':'Apply or cancel the colour edit before deleting whole objects.';return true;}if(e.key==='Escape'){show('select');return true;}if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undoCurrent();return true;}return false;}};
}
