const icons={select:'<path d="m5 3 14 9-7 1-3 7z"/>',colour:'<path d="m14 3 7 7-10 10H4v-7zM11 6l7 7M3 21h18"/>',split:'<path d="M3 4h7v6H3zM14 14h7v6h-7zM18 3 6 21"/>',arrange:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'};
const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
import {fitCompleteSets,fitOnOnePlate,waitForMeasuredState} from './auto-layout.js';
import {colourName} from '../../web/shared/assignment.js';
export function mountStudio({view,engine,kind,api,objects,setPanel}){
  const doc=view.stage.ownerDocument,make=view.make;
  let multiple=false,preferredColour='',colourDirty=false;
  let regions=[],regionPending=false,regionWorker=null,regionRequest=0,regionKey='';const regionCache=new WeakMap();
  let mode='select',selectionKey='',knownSource=null,working=false,committing=false,worker=null,rejectPending=null,baseColours=null,sourceColours=null,previewPending=false,previewRequest=0,undo=[],request=0;
  const tools=make('nav',{class:'studio-toolstrip','aria-label':'Model tools'},Object.entries({select:'Select',colour:'Colour',split:'Split',arrange:'Arrange'}).map(([key,label])=>`<button data-studio-tool="${key}" aria-pressed="${key===mode}" title="${label}">${svg(key)}<span>${label}</span></button>`).join('')+'<button data-studio-undo title="Undo model edit (Ctrl+Z)" aria-label="Undo model edit" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12"/></svg></button>');
  view.stage.append(tools);
  const panel=make('section',{'data-task':'edit',hidden:'','aria-label':'Selected objects'},'<div class="task-heading"><h1 data-edit-heading>Objects</h1><p data-selection-title>Choose an object on the canvas.</p></div><button data-multi-select aria-pressed="false">Select multiple</button><p class="hint" data-multi-hint hidden>Tap objects on the canvas or in the list to add or remove them from the selection.</p><div data-selection-controls></div><div data-tool-settings></div><p class="studio-message" role="status" aria-live="polite"></p><div class="studio-apply" hidden><button data-edit-cancel>Cancel</button><button class="primary" data-edit-apply>Apply colour</button></div><details class="studio-objects" open><summary>Objects on this plate <span data-scene-count></span></summary><div data-scene-list></div></details>');
  view.panels.edit=panel;view.inspector.append(panel);
  panel.querySelector('[data-selection-controls]').append(objects.element);
  const oldUndo=objects.element.querySelector('[data-object-edit=undo]');if(oldUndo)oldUndo.hidden=true;
  const settings=panel.querySelector('[data-tool-settings]'),message=panel.querySelector('.studio-message'),actions=panel.querySelector('.studio-apply');
  const autoResult=make('section',{class:'studio-auto-result',hidden:'','aria-label':'Automatic separation result'},'<strong data-auto-summary></strong><p class="hint"></p><details><summary>Why some parts stayed attached</summary><ul></ul></details>');message.after(autoResult);
  function showAutoReport(reports,container=panel){
    const separated=reports.reduce((n,r)=>n+r.separated.length,0),existing=reports.reduce((n,r)=>n+(r.disconnected||0),0),retained=reports.flatMap(r=>r.retained.map(p=>({...p,name:r.name})));
    autoResult.hidden=false;
    autoResult.querySelector('[data-auto-summary]').textContent=separated?`${separated} coloured part${separated===1?'':'s'} separated`:existing?`${existing} existing pieces separated`:'No safe automatic colour split found';
    const kept=[...new Set(retained.map(r=>r.colour).filter(Boolean))].map(n=>colourName(palette()[n-1]||'#FFFFFF'));
    autoResult.querySelector('p').textContent=retained.length?`${kept.length?`${kept.join(' and ')} regions remain attached.`:'Some regions stayed attached.'} See the reasons below.${separated||existing?' They stay on the body when it is duplicated.':' Your model and quantities are unchanged.'}`:'The main body and its remaining paint are preserved.';
    autoResult.querySelector('details').hidden=!retained.length;
    const list=autoResult.querySelector('ul');list.replaceChildren();const grouped=new Map();
    for(const row of retained){const key=`${row.colour?`${colourName(palette()[row.colour-1]||'#FFFFFF')} — `:''}${row.reason}`,count=grouped.get(key)||0;grouped.set(key,count+row.count);}
    for(const [reason,count]of grouped){const item=make('li');item.textContent=`${reason}${count>1?` (${count} regions)`:''}`;list.append(item);}
    if(container===panel)message.after(autoResult);else container.querySelector('.task-heading').after(autoResult);
  }
  const palette=()=>kind==='converter'?engine.session.state?.colours||[]:engine.state.project?.colors||[];
  const state=()=>engine.workbenchObjects();
  const selected=()=>objects.selected();
  const snapshot=()=>({file:api.source(),context:api.context(),settings:engine.workbenchCaptureSettings?.()});
  const sourceName=(colour,i)=>`Colour ${i+1} · ${colour}`;
  const commonColours=()=>{const s=state(),ids=selected();return palette().map((colour,i)=>({colour,index:i+1})).filter(c=>ids.every(id=>{const o=s.objects.find(o=>String(o.objectId)===id);return !o?.colours?.length||o.colours.some(v=>Number(v.extruder)===c.index);}));};
  const splitMethod=()=>settings.querySelector('[data-split-method]')?.value||'cut';
  const splitOperation=()=>splitMethod()==='by-colour'?settings.querySelector('[data-colour-action]').value:splitMethod();
  const autoFinish=()=>settings.querySelector('[data-auto-finish]')?.value||'once';
  const applyLabel=()=>mode==='colour'?'Apply colour':splitMethod()==='auto-separate'?({once:'Separate automatically',fill:'Separate & fill plate',sequential:'Separate & prepare plates'}[autoFinish()]):splitOperation()==='remove-colour'?'Remove coloured part':splitMethod()==='by-colour'?'Separate colour':'Split objects';
  const chosenRegion=()=>regions.find(r=>r.id===settings.querySelector('[data-region-piece]')?.value);
  function stopRegions(){regionRequest++;regionWorker?.terminate();regionWorker=null;regionPending=false;regionKey='';regions=[];}
  function regionFeedback(){const selected=chosenRegion();message.textContent=selected?.error?`${selected.error} This region has not been changed.`:regions.length>1?'Choose one region. Other areas using this colour stay on the model. The highlight is a simplified preview.':'';}
  async function loadRegions(){
    const from=settings.querySelector('[data-region-colour]')?.value,file=api.source(),ids=selected();
    const key=`${from}|${ids.join(',')}`;if(key===regionKey)return;
    stopRegions();regionKey=key;const picker=settings.querySelector('[data-region-piece]');if(!picker)return;
    picker.replaceChildren(new Option('Checking colour regions…',''));
    if(!from){picker.replaceChildren(new Option('Choose a colour first',''));sync();return;}
    if(ids.length!==1){message.textContent='Select one object to choose a painted region.';sync();return;}
    if(!file)return;
    const stamp=regionRequest;regionPending=true;message.textContent='Checking the separate regions of this colour…';sync();
    try{
      let cache=regionCache.get(file);if(!cache){cache=new Map();regionCache.set(file,cache);}
      let result=cache.get(key);
      if(!result){const bytes=await file.arrayBuffer();if(stamp!==regionRequest)return;
        result=await new Promise((resolve,reject)=>{regionWorker=new Worker(new URL('./model-edit-worker.js',import.meta.url),{type:'module'});regionWorker.onmessage=({data})=>{if(data.progress){message.textContent=data.progress;return;}data.error?reject(Error(data.error)):resolve(data.regions);};regionWorker.onerror=()=>reject(Error('Region checking stopped. Choose the colour again to retry.'));regionWorker.postMessage({bytes,options:{operation:'inspect-regions',plateId:api.context().plateId,objectIds:ids,from}},[bytes]);});
        cache.set(key,result);
      }
      if(stamp!==regionRequest)return;regions=result;
      picker.replaceChildren(new Option(regions.length>1?'Choose a region':'Selected region',''));
      regions.forEach((r,i)=>picker.add(new Option(`Region ${i+1} · ${r.size.map(n=>n.toFixed(1)).join(' × ')} mm${r.error?' · needs slicer editing':''}`,r.id)));
      if(regions.length===1)picker.value=regions[0].id;
      if(!regions.length)throw Error('This object has no regions in that colour.');
      regionFeedback();
    }catch(e){if(stamp===regionRequest){regionKey='';message.textContent=e.message;}}
    finally{if(stamp===regionRequest){regionWorker?.terminate();regionWorker=null;regionPending=false;preview();sync();}}
  }
  function loadSourcePreview(){const stamp=++previewRequest;previewPending=true;engine.workbenchSourceColours().then(colours=>{if(stamp!==previewRequest)return;sourceColours=colours;previewPending=false;preview();sync();}).catch(error=>{if(stamp!==previewRequest)return;previewPending=false;message.textContent=error.message;sync();});}
  function restorePreview(){colourDirty=false;stopRegions();previewRequest++;previewPending=false;sourceColours=null;const p=state().preview;if(p){p.suppressSelection=false;if(baseColours&&baseColours.length===p.lastPositions?.length)p.setColors(baseColours);p.requestDraw();}baseColours=null;}
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
      settings.querySelector('.hint').textContent='Choose a swatch to preview a colour on these copies, then Apply. Undo or Cancel restores their paint. Export palette replacements still apply.';
      panel.querySelector('[data-edit-apply]').textContent='Apply colour';
      loadSourcePreview();
    }else if(mode==='split'){
      settings.innerHTML='<label class="studio-field">Split method<select data-split-method><option value="by-colour">By painted colour</option><option value="cut">Plane cut</option><option value="separate">Disconnected parts</option></select></label><div data-region-settings><label class="studio-field">Colour to separate<select data-region-colour aria-label="Colour to separate"><option value="">Choose a source colour</option></select></label><div class="studio-region-swatches" data-region-swatches aria-label="Choose a source colour"></div><label class="studio-field">Painted region<select data-region-piece aria-label="Painted region"><option value="">Choose a colour first</option></select></label><label class="studio-field">What to do<select data-colour-action><option value="separate-colour">Keep both parts</option><option value="remove-colour">Remove this coloured part</option></select></label></div><div data-plane-settings hidden><label class="studio-field">Direction<select data-cut-axis><option value="2">Horizontal · Z</option><option value="0">Left / right · X</option><option value="1">Front / back · Y</option></select></label><label class="studio-field">Cut position <output data-cut-label>50%</output><input type="range" min="1" max="99" step="0.5" value="50" data-cut-position></label></div><div data-joint-settings><label class="studio-check"><input type="checkbox" data-add-pin> Add locating pin &amp; socket</label><div data-pin-settings hidden><div class="studio-dimensions"><label>Diameter (mm)<input type="number" min="1" max="20" step="0.1" value="3" data-pin-diameter></label><label>Length (mm)<input type="number" min="1" max="20" step="0.1" value="3" data-pin-length></label><label>Fit clearance (mm)<input type="number" min="0.05" max="1" step="0.05" value="0.3" data-pin-clearance></label></div><label class="studio-field">Pin on<select data-pin-side><option value="selected">Separated colour / upper half</option><option value="base">Remaining model / lower half</option></select></label><label class="studio-check"><input type="checkbox" data-orient-pins checked> Orient pins upwards</label><p class="hint">The pin-bearing part is turned and placed on the bed. Check its contact area and supports in the slicer. Pin position is fitted automatically. Clearance is added to the socket diameter; its depth is 0.2 mm longer than the pin. Check the fit with a small test print.</p></div></div><p class="hint" data-split-hint></p>';
      const area=settings.querySelector('[data-region-colour]');
      const method=settings.querySelector('[data-split-method]');method.prepend(new Option('Automatic · find detachable parts','auto-separate'));method.value=preferredColour?'by-colour':'auto-separate';
      const automatic=make('div',{'data-auto-settings':''},'<p class="hint">Checks disconnected pieces and each painted region. Separates what can be closed safely; the main body and unsuitable paint patches stay intact.</p><label class="studio-field">After separating<select data-auto-finish><option value="once">Keep one set of parts</option><option value="fill">Fill one plate with complete sets</option><option value="sequential">Fill sequential colour-group plates</option></select></label><p class="hint" data-auto-fill-help>All colours are checked in one pass. Undo restores the complete model.</p>');area.closest('[data-region-settings]').before(automatic);
      settings.querySelector('[data-add-pin]').checked=!preferredColour;
      for(const {colour,index} of commonColours()){area.add(new Option(sourceName(colour,index-1),String(index)));const b=make('button',{'data-region-colour-button':String(index),'aria-label':sourceName(colour,index-1),'aria-pressed':'false'},`<i aria-hidden="true"></i><span>${index}</span>`);b.style.setProperty('--swatch',colour);settings.querySelector('[data-region-swatches]').append(b);}
      if(preferredColour&&commonColours().some(c=>String(c.index)===preferredColour))area.value=preferredColour;
      preferredColour='';if(splitMethod()!=='auto-separate')loadSourcePreview();
      panel.querySelector('[data-edit-apply]').textContent='Split objects';
    }
    preview();
  }
  function preview(){
    if(!['colour','split'].includes(mode)||working)return;
    const p=state().preview;
    if(!baseColours)baseColours=p?.lastColors?.slice();
    const source=sourceColours?.length===baseColours?.length?sourceColours:baseColours;
    const colours=source?.slice(),ranges=p?.lastPositions&&colours?[...p.selectedRanges].map(i=>p.pickRanges[i]).filter(Boolean):[];
    if(mode==='colour'){
      const hex=settings.querySelector('[data-paint-colour]').value,from=settings.querySelector('[data-paint-area]').value;
      settings.querySelector('[data-hex]').textContent=hex.toUpperCase();
      if(!colourDirty){sync();return;}
      const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),hexSource=palette()[Number(from)-1];
      const match=hexSource?[1,3,5].map(i=>parseInt(hexSource.slice(i,i+2),16)/255):null;
      for(const r of ranges)for(let i=r.start*3;i<(r.start+r.count)*3;i+=3)if(!match||match.every((c,j)=>Math.abs(c-source[i+j])<.015))colours.set(rgb,i);
    }else if(mode==='split'){
      const method=splitMethod(),axis=Number(settings.querySelector('[data-cut-axis]').value),position=Number(settings.querySelector('[data-cut-position]').value),removing=splitOperation()==='remove-colour';
      settings.querySelector('[data-plane-settings]').hidden=method!=='cut';settings.querySelector('[data-cut-label]').textContent=`${position}%`;
      settings.querySelector('[data-region-settings]').hidden=method!=='by-colour';settings.querySelector('[data-joint-settings]').hidden=method==='separate'||removing;
      settings.querySelector('[data-auto-settings]').hidden=method!=='auto-separate';
      settings.querySelector('[data-pin-side]').closest('label').hidden=method==='auto-separate';
      settings.querySelector('[data-auto-fill-help]').textContent=autoFinish()==='once'?'All colours are checked in one pass. Undo restores the complete model.':autoFinish()==='fill'?'Adds matching quantities of every piece, up to 64 per part. Other objects keep their quantities. The fit uses your printer, spacing and reserved areas.':'Fits complete sets, up to 64 per part: single-colour pieces share sequential groups; multicoloured bodies get a separate by-layer job. Check head clearance in your slicer.';
      settings.querySelector('[data-pin-settings]').hidden=!settings.querySelector('[data-add-pin]').checked;
      settings.querySelector('[data-pin-side]').options[0].textContent=method==='by-colour'?'Separated colour':'Upper / positive half';settings.querySelector('[data-pin-side]').options[1].textContent=method==='by-colour'?'Remaining model':'Lower / negative half';
      settings.querySelector('[data-split-hint]').textContent=method==='cut'?'Cuts through the object and closes both faces. Both parts stay on this plate.':method==='by-colour'?(removing?'Removes the highlighted coloured region and closes the remaining model. Undo brings it back.':'Follows the original paint boundary and closes both parts. Best for protruding parts such as a stalk; flat paint patches cannot be detached.'):'Separates existing disconnected pieces without changing their painting. Turn to By painted colour for a part joined to the model.';
      if(method==='auto-separate')settings.querySelector('[data-split-hint]').textContent='Pins go on the detached pieces. If a join cannot hold the chosen pin, that region stays attached. Turn pins off to try separation without connectors.';
      if(method==='cut')for(const r of ranges){let lo=Infinity,hi=-Infinity;for(let i=r.start*3+axis;i<(r.start+r.count)*3;i+=3){lo=Math.min(lo,p.lastPositions[i]);hi=Math.max(hi,p.lastPositions[i]);}const cut=lo+(hi-lo)*position/100;for(let i=r.start*3;i<(r.start+r.count)*3;i+=9){const side=(p.lastPositions[i+axis]+p.lastPositions[i+3+axis]+p.lastPositions[i+6+axis])/3>cut,rgb=side?[.34,.64,.85]:[.94,.57,.28];for(let k=0;k<9;k++)colours[i+k]=.45*colours[i+k]+.55*rgb[k%3];}}
      if(method==='by-colour'){
        const from=settings.querySelector('[data-region-colour]').value,hex=palette()[Number(from)-1],match=hex?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255):null,region=chosenRegion();
        for(const b of settings.querySelectorAll('[data-region-colour-button]'))b.setAttribute('aria-pressed',String(b.dataset.regionColourButton===from));
        if(match)for(const r of ranges){
          const bounds=state().objects.find(o=>String(o.objectId)===String(r.objectId))?.bounds,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
          for(let i=r.start*3;i<(r.start+r.count)*3;i+=3)for(let j=0;j<3;j++){min[j]=Math.min(min[j],p.lastPositions[i+j]);max[j]=Math.max(max[j],p.lastPositions[i+j]);}
          const offset=min.map((v,j)=>bounds?(v+max[j]-bounds.min[j]-bounds.max[j])/2:0);
          for(let i=r.start*3;i<(r.start+r.count)*3;i+=3){
            const yes=match.every((c,j)=>Math.abs(c-source[i+j])<.015)&&(!region||[0,1,2].every(j=>p.lastPositions[i+j]-offset[j]>=region.bounds.min[j]-.25&&p.lastPositions[i+j]-offset[j]<=region.bounds.max[j]+.25));
            if(!yes)for(let j=0;j<3;j++)colours[i+j]=source[i+j]*.18+.68;
          }
        }
      }
    }
    if(p&&colours){p.suppressSelection=true;p.setColors(colours);}sync();
  }
  async function loadSnapshot(saved){if(!await api.load(saved.file,{...saved.context,edit:true}))throw Error('The edited model could not be opened.');await engine.workbenchRestoreSettings?.(saved.settings);objects.history.reset();knownSource=api.source();setPanel('edit');}
  async function apply(){
    if(working||previewPending||regionPending||!['colour','split'].includes(mode))return;
    const s=state(),ids=selected(),before=snapshot(),finish=autoFinish();if(!ids.length||!before.file)return;
    if(mode==='split'&&splitMethod()==='by-colour'&&!settings.querySelector('[data-region-colour]').value){message.textContent='Choose the source colour to separate.';return;}
    const options={objectIds:ids,plateId:before.context.plateId,operation:mode==='colour'?'colour':splitOperation(),from:mode==='colour'?settings.querySelector('[data-paint-area]')?.value||'all':settings.querySelector('[data-region-colour]')?.value,colour:settings.querySelector('[data-paint-colour]')?.value,axis:Number(settings.querySelector('[data-cut-axis]')?.value||2),position:Number(settings.querySelector('[data-cut-position]')?.value||50)};
    if(mode==='split'&&splitMethod()==='by-colour'){const region=chosenRegion();if(!region||region.error){message.textContent=region?.error||'Choose one colour region first.';return;}options.region=region.id;}
    if(mode==='split')options.orientPins=settings.querySelector('[data-orient-pins]')?.checked!==false;
    if(mode==='split'&&settings.querySelector('[data-add-pin]').checked&&['cut','separate-colour','auto-separate'].includes(options.operation))options.connector={diameter:Number(settings.querySelector('[data-pin-diameter]').value),length:Number(settings.querySelector('[data-pin-length]').value),clearance:Number(settings.querySelector('[data-pin-clearance]').value),side:options.operation==='auto-separate'?'selected':settings.querySelector('[data-pin-side]').value};
    autoResult.hidden=true;
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
      if(!result.changes.length){showAutoReport(result.reports||[]);message.textContent=`No parts were separated.${finish==='once'?'':' Filling was not started.'} Review the reasons below; adjust the pin settings or use a manual split.`;return;}
      const quantities=Object.fromEntries(s.objects.map(o=>[o.objectId,(s.quantities[o.objectId]??1)*s.copies]));
      for(const c of result.changes){quantities[c.oldId]=Math.max(0,(quantities[c.oldId]??1)-1);for(const n of c.created)quantities[n.id]=1;}
      const file=result.changes.length?new File([result.bytes],before.file.name,{type:before.file.type}):before.file;
      const next={...before,file,context:{...before.context,layout:{...before.context.layout,copies:1,quantities,arrangement:'objects'}}};
      committing=true;sync();
      try{await loadSnapshot(next);}catch(error){await loadSnapshot(before);throw error;}
      undo.push(before);if(undo.length>6)undo.shift();
      if(options.operation==='auto-separate'){
        const changed=new Set(result.changes.map(c=>c.oldId)),fillIds=[...result.changes.flatMap(c=>c.created.map(n=>n.id)),...ids.filter(id=>!changed.has(id))];
        mode='select';selectionKey='';render();showAutoReport(result.reports||[]);
        message.textContent='Automatic separation complete. Undo restores the original model.';
        if(finish!=='once'){message.textContent='Measuring the separated parts before filling…';await waitForMeasuredState(state);}
        if(finish==='fill'){
          try{
            const current=state(),filled=await fitCompleteSets(current,fillIds,fitOnOnePlate,async()=>{message.textContent='Finding how many complete sets fit…';await new Promise(resolve=>setTimeout(resolve,0));});
            current.apply({quantities:filled.quantities,copies:1,arrangement:'objects'});
            objects.history.reset();
            message.textContent=`${filled.sets} complete set${filled.sets===1?'':'s'} fitted on the plate. Other object quantities are unchanged. Undo restores the original model.`;
          }catch(error){message.textContent=`Separation kept; the plate was not filled. ${error.message}`;}
        }else if(finish==='sequential'){
          mode='arrange';setPanel('layout');showAutoReport(result.reports||[],view.panels.layout);
          await api.preparePlates({mode:'sequential',fillIds});
        }
        return;
      }
      mode='select';selectionKey='';message.textContent=options.operation==='colour'?'Colour applied to the selected copies.':options.operation==='remove-colour'?'Coloured part removed; the remaining surface is closed. Undo restores it.':options.connector?`Parts separated with a locating pin and matching socket.${options.orientPins?' Pins face upwards.':''} Use Arrange to prepare colour plates or sequential groups; Undo restores the original.`:'Parts separated. Use Arrange to prepare colour plates or sequential groups.';render();
    }catch(error){if(stamp===request)message.textContent=error.message;}finally{worker?.terminate();worker=null;rejectPending=null;working=false;committing=false;sync();}
  }
  async function undoEdit(){if(working||!undo.length)return;working=true;restorePreview();message.textContent='Restoring your previous model…';try{await loadSnapshot(undo.at(-1));undo.pop();autoResult.hidden=true;mode='select';selectionKey='';render();message.textContent='Model edit undone.';}catch(e){message.textContent=e.message;}finally{working=false;sync();}}
  const undoKind=()=>colourDirty?'colour preview':engine.workbenchBlends?.canUndo?'blend':objects.history?.canUndo?'plate':undo.length?'model':null;
  async function undoCurrent(){if(working||state().busy)return;if(colourDirty){show('select');message.textContent='Colour preview undone. Original paint restored.';}else if(undoKind()==='blend')engine.workbenchBlends.undo();else if(undoKind()==='plate')await objects.act('undo');else await undoEdit();sync();}
  let listStamp='';
  function sync(){
    const s=state();tools.hidden=!s.objects.length;if(s.preview)s.preview.selectionToggle=multiple;
    panel.querySelector('[data-multi-select]').setAttribute('aria-pressed',String(multiple));panel.querySelector('[data-multi-hint]').hidden=!multiple;
    const guide=objects.element.querySelector('[data-object-message]');if(guide&&/Shift-click/.test(guide.textContent))guide.textContent='Use Select multiple to pick several copies. Keyboard: Shift adds, Ctrl/Cmd toggles; Delete removes; Ctrl/Cmd+Z undoes.';
    const currentSource=api.source();if(!working&&currentSource!==knownSource){knownSource=currentSource;undo=[];baseColours=null;message.textContent='';autoResult.hidden=true;}
    const ids=selected(),key=JSON.stringify([s.key,ids]);
    if(!working&&!s.busy&&!api.loading&&key!==selectionKey){restorePreview();selectionKey=key;if(mode!=='arrange'){if(ids.length)setPanel('edit');render();}}
    const catalogue=JSON.stringify([s.key,s.objects.map(o=>[o.objectId,o.name]),s.quantities,s.copies,ids]);
    if(catalogue!==listStamp){listStamp=catalogue;if(mode==='select'&&!working)render();const list=panel.querySelector('[data-scene-list]');list.replaceChildren();let total=0;
      for(const o of s.objects){const count=(s.quantities[o.objectId]??1)*s.copies;if(!count)continue;total+=count;const b=make('button',{'data-scene-object':o.objectId,'aria-pressed':String(ids.includes(String(o.objectId)))});b.append(make('span',{},''),make('span',{},''));b.children[0].textContent=o.name||`Object ${o.objectId}`;b.children[1].textContent=`×${count}`;list.append(b);}
      panel.querySelector('[data-scene-count]').textContent=String(total);
    }
    const apply=panel.querySelector('[data-edit-apply]');apply.disabled=working||s.busy;apply.textContent=working?'Working…':applyLabel();
    panel.setAttribute('aria-busy',String(working));for(const b of tools.querySelectorAll('button')){b.disabled=working||s.busy;if(b.dataset.studioTool)b.setAttribute('aria-pressed',String(b.dataset.studioTool===mode));}const undoButton=tools.querySelector('[data-studio-undo]'),nextUndo=undoKind();undoButton.disabled=working||s.busy||!nextUndo;undoButton.setAttribute('aria-label',nextUndo?`Undo ${nextUndo} edit`:'Undo');undoButton.title=nextUndo?`Undo ${nextUndo} edit (Ctrl/Cmd+Z)`:'Nothing to undo';
    for(const control of panel.querySelectorAll('input,select,button'))if(!control.closest('.workbench-object-tools'))control.disabled=working||s.busy;
    panel.querySelector('[data-edit-cancel]').disabled=committing;
    apply.disabled=working||s.busy||previewPending||regionPending||(mode==='colour'&&!colourDirty)||(mode==='split'&&splitMethod()==='by-colour'&&(!chosenRegion()||Boolean(chosenRegion().error)));
    const regionPicker=settings.querySelector('[data-region-piece]');if(regionPicker)regionPicker.disabled=working||s.busy||regionPending;
    objects.element.inert=working;
  }
  tools.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.studioTool)show(b.dataset.studioTool);if(b?.matches('[data-studio-undo]'))undoCurrent();});
  panel.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.matches('[data-multi-select]')){multiple=!multiple;sync();}
    if(b.dataset.swatch){colourDirty=true;settings.querySelector('[data-paint-colour]').value=b.dataset.swatch;preview();}
    if(b.dataset.regionColourButton){settings.querySelector('[data-region-colour]').value=b.dataset.regionColourButton;loadRegions();preview();}
    if(b.matches('[data-open-colour-split]'))show('split');
    if(b.dataset.findColour){const s=state(),ids=new Set(s.objects.filter(o=>(s.quantities[o.objectId]??1)*s.copies>0&&!o.undecodable&&o.colours?.length===1&&Number(o.colours[0].extruder)===Number(b.dataset.findColour)).map(o=>String(o.objectId))),p=s.preview;
      if(p?.pickRanges.length){p.selectedRanges.clear();for(let i=0;i<p.pickRanges.length;i++)if(ids.has(String(p.pickRanges[i].objectId)))p.selectedRanges.add(i);p.selectedRange=[...p.selectedRanges][0]??null;p.onSelectionChange?.();p.requestDraw();objects.sync();sync();message.textContent=p.selectedRanges.size===1?'One single-colour object selected. Remove one deletes this whole object.':`${p.selectedRanges.size} single-colour copies selected. Remove selected deletes these whole objects.`;}
      else message.textContent='Select the matching objects by name below; 3D selection is unavailable in this browser.';
    }
    if(b.matches('[data-edit-cancel]')){if(committing)return;if(working){request++;worker?.terminate();rejectPending?.(Error('Cancelled'));working=false;message.textContent='Edit cancelled. Your model is unchanged.';}show('select');}
    if(b.matches('[data-edit-apply]'))apply();
    if(b.dataset.sceneObject){const p=state().preview;if(p?.pickRanges.length){p.selectRange(p.pickRanges.findIndex(r=>String(r.objectId)===b.dataset.sceneObject),e);objects.sync();}else{objects.element.querySelector('select').value=b.dataset.sceneObject;objects.element.querySelector('select').dispatchEvent(new Event('change'));}sync();}
  });
  settings.addEventListener('input',e=>{if(e.target.matches('[data-paint-colour]'))colourDirty=true;preview();});settings.addEventListener('change',e=>{if(e.target.matches('[data-split-method]')){stopRegions();if(splitMethod()!=='auto-separate')loadSourcePreview();}if(e.target.matches('[data-region-colour]'))loadRegions();if(e.target.matches('[data-region-piece]'))regionFeedback();preview();});
  return {sync,show,get busy(){return working;},get pending(){return ['colour','split'].includes(mode)&&selected().length>0;},leavePanel(){if(!working&&['colour','split'].includes(mode)){restorePreview();mode='select';}},key(e){if(e.target?.closest?.('input,select,textarea,[contenteditable=true]'))return false;if(working){if(['Delete','Escape','z'].includes(e.key)){e.preventDefault();return true;}return false;}if(e.key==='Delete'&&['colour','split'].includes(mode)){e.preventDefault();message.textContent=mode==='split'?'To remove only a colour, choose “Remove this coloured part”. Cancel to delete whole objects.':'Apply or cancel the colour edit before deleting whole objects.';return true;}if(e.key==='Escape'){show('select');return true;}if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undoCurrent();return true;}return false;}};
}
