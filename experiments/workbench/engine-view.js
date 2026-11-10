import {composeView} from './view-layout.js';
import {mountWorkbenchObjects} from './object-tools.js';
import {mountFilamentTools} from './filament-tools.js';
import {mountStudio} from './studio-tools.js';
import {prepareWorkbenchPlates,connectPlatePreview} from './shared/sequentialPanel.js';
import {mountPreparedPreview} from './prepared-preview.js';
import {mountProjectPlates} from './project-plates.js';
import {installModelDrop} from './file-drop.js';
import {mountModelColours} from './model-colours.js';
import {mountFeatureToolbox} from './feature-toolbox.js';
const kind=document.body.dataset.engine,$=id=>document.getElementById(id);
const view=composeView(document,kind);
let engine, currentPanel='project', lastReport='', source=null, workspaceMode='studio', colourSummary, toolbox;
let fallbackKey='',fallbackPending=false,fallbackUrl=null;
let objectTools, filamentTools, studio, prepared, projectPlates, loading=false, busySince=0,previewSettledAt=0;
const progress=view.make('div',{class:'workbench-progress',hidden:'',role:'status','aria-live':'polite'},'<span class="working-orb" aria-hidden="true"></span><div><strong>Preparing your model…</strong><p></p></div>');
view.stage.append(progress);
const fallback=view.make('div',{class:'software-preview',hidden:''},'<div><img alt="Static preview of the current model and colours"></div><p>Static preview · 3D acceleration is unavailable in this browser. Use Layout to edit objects.</p>');
view.stage.append(fallback);
const parentHost=window.parent!==window ? window.parent : null;
const reportError=error=>{const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=`The workspace could not complete that action: ${error.message}`;view.feedback.append(p);};
function setPanel(panel) {
  if(!view.panels[panel])return;
  if(workspaceMode==='quick'&&!['project','output','help'].includes(panel)){
    if(parentHost?.workbench){parentHost.workbench.chooseWorkspace('studio').then(changed=>{if(changed)setPanel(panel);});return;}
    api.setWorkspaceMode('studio');
  }
  if(panel===currentPanel&&!view.panels[panel].hidden)return;
  if(panel!=='colours')engine?.workbenchFocus?.stop();
  if(panel!=='layout')prepared?.close();
  else prepared?.resume();
  if(panel!=='edit')studio?.leavePanel();
  currentPanel=panel;
  for(const [key,node]of Object.entries(view.panels))node.hidden=workspaceMode==='quick'&&panel!=='help'?!['project','output'].includes(key):key!==panel;
  if(kind==='converter')$('mode-single').click();
  view.inspector.scrollTop=0;
  parentHost?.workbench?.panelChanged(kind,panel);
}
const panelFor=id=>{
  const node=$(id);return node?.closest('[data-task]')?.dataset.task || (['sourcepreview','mixcard','platecontrols'].includes(id)?currentPanel:null);
};
document.addEventListener('click',event=>{
  const b=event.target.closest('button,a');if(!b)return;
  if(b.matches('[data-open-model]'))api.open();
  if(b.matches('[data-open-sample]'))parentHost?.workbench?.sample(b.dataset.openSample);
  if(b.dataset.colourWorkflow)parentHost?.workbench?.switchMode(b.dataset.colourWorkflow);
  if(b.matches('[data-close-batch]'))setPanel('project');
  if(['petgfullspectrum','capacityblend','capacityswaps'].includes(b.id)||b.matches('[data-model-workflow]')) {
    event.preventDefault();event.stopImmediatePropagation();parentHost?.workbench?.switchMode('spectrum',b.id==='capacityswaps'?'reel-changes':'blends');return;
  }
  const id=b.dataset.jump||b.dataset.convertJump;
  if(id&&panelFor(id))setPanel(panelFor(id));
  if(b.matches('[data-arrange]')||/^(Objects|Object list|Arrange plate)$/.test(b.textContent.trim()))setPanel('layout');
  if(b.id==='advancedlink')setPanel('colours');
  if(b.id==='capacityrepaint')setPanel('colours');
},true);
function context() {
  if(kind==='converter')return {capacity:engine.session.inputCapacity(),bambuSetup:engine.session.bambuSetup,target:engine.session.target,plateId:String(engine.session.state?.plateId??''),supportInterface:engine.session.supportInterface,interfaceSlot:engine.session.interfaceSlot,interfaceColor:engine.session.interfaceColor,layout:{...engine.session.layout},u1Nozzle:engine.session.u1Nozzle};
  const s=engine.state;return {capacity:s.capacity,bambuSetup:s.bambuSetup,target:s.target,plateId:String(s.plateId??''),supportInterface:s.supportInterface,interfaceSlot:s.interfacePosition+1,interfaceColor:s.reels[s.interfacePosition]?.color,layout:{quantities:{...s.quantities},copies:Number($('spectrumcopies').value),spacing:Number($('spectrumgap').value),width:Number($('spectrumwidth').value),depth:Number($('spectrumdepth').value),tower:$('spectrumtower').checked,arrangement:$('spectrumarrangement').value},u1Nozzle:s.u1Nozzle};
}
const api={kind,setPanel,context,
  // Colour and export choices, as already captured for undoing a model edit.
  captureSettings:()=>engine.workbenchCaptureSettings?.(),
  restoreSettings:saved=>engine.workbenchRestoreSettings?.(saved),
  setWorkspaceMode(value){
    const next=value==='quick'&&kind==='converter'?'quick':'studio',changed=next!==workspaceMode;workspaceMode=next;
    document.body.dataset.workspaceMode=workspaceMode;
    view.panels.project.querySelector('h1').textContent=workspaceMode==='quick'?'Quick conversion':'Your project';
    view.panels.project.querySelector('.task-heading p').textContent=workspaceMode==='quick'?'Open a model, choose its destination and download.':'Choose the model, plate and destination.';
    if(workspaceMode==='quick'){studio?.leavePanel();currentPanel='project';prepared?.close();}
    for(const [key,node]of Object.entries(view.panels))node.hidden=workspaceMode==='quick'?!['project','output'].includes(key):key!==currentPanel;
    const advanced=document.querySelector('.conversion-settings');if(advanced&&changed)advanced.open=workspaceMode!=='quick';
    tick();
  },
  get loading(){return loading;},
  preparePlates:options=>{setPanel('layout');return prepareWorkbenchPlates($('printoptimiser'),options);},
  key:event=>{if(!engine?.workbenchFocus?.key(event)&&!prepared?.key(event)&&!studio?.key(event))objectTools?.key(event);},
  captureView:()=>({panel:currentPanel,scroll:view.inspector.scrollTop,panelScroll:view.panels[currentPanel]?.scrollTop||0}),
  restoreView(saved){if(saved){setPanel(saved.panel);view.inspector.scrollTop=saved.scroll;if(view.panels[saved.panel])view.panels[saved.panel].scrollTop=saved.panelScroll||0;}},
  source:()=>kind==='converter'?engine.session.sourceFile:engine.workbenchSource(),
  theme:value=>{document.documentElement.dataset.theme=value;prepared?.theme();const p=engine?.workbenchObjects()?.preview;if(p){p.plateKey='';p.requestDraw();engine.refreshPreview?.();}},
  open:()=>{if(studio?.busy)throw Error('Finish or cancel the current model edit first.');if(kind==='converter')$('mode-single').click();const input=$(kind==='converter'?'convertfile':'file');input.value='';input.click();},
  batch:()=>{if(studio?.busy)throw Error('Finish or cancel the current model edit first.');if(kind==='converter')$('mode-bulk').click();},
  async load(file,options={}) {
    if(studio?.busy&&!options.edit)throw Error('Finish or cancel the current model edit first.');
    loading=true;prepared?.reset();if(!options.edit)setPanel('project');tick();
    try{
    if(kind==='converter') {
      if(/\.(glb|zip)$/i.test(file.name)){engine.textureImporter.open(file);return;}
      if(options.target)engine.session.setTarget(options.target);
      engine.session.rememberPlate();
      const collection=options.edit?engine.session.plateCollection.snapshot():null;
      await engine.session.load(file);
      if(collection&&engine.session.state){
        // A geometry edit rebuilds the active plate. Other source plates keep
        // their independent layout and reversible deletion state.
        collection.edits=collection.edits.filter(([id])=>String(id)!==String(options.plateId));
        engine.session.plateCollection.restoreSnapshot(collection,engine.session.state.plates);
      }
      if(options.u1Nozzle)engine.session.setU1Nozzle(options.u1Nozzle);
      if(options.bambuSetup)engine.session.setBambuSetup(options.bambuSetup);
      if(options.capacity)engine.session.setInputCapacity(options.capacity);
      if(options.plateId)engine.session.setPlate(options.plateId);
      if(options.layout)engine.session.setLayout(options.layout);
      if(options.supportInterface)engine.session.setInterface(true,options.interfaceSlot,options.interfaceColor);
    }else {
      await engine.load(file,options);
      if(engine.state.project&&options.layout) {
        engine.state.quantities={...options.layout.quantities};
        for(const [key,id]of Object.entries({copies:'spectrumcopies',spacing:'spectrumgap',width:'spectrumwidth',depth:'spectrumdepth',arrangement:'spectrumarrangement'}))if(options.layout[key]!==undefined)$(id).value=options.layout[key];
        if(options.layout.tower!==undefined)$('spectrumtower').checked=options.layout.tower;
        if(options.u1Nozzle){engine.state.u1Nozzle=options.u1Nozzle;$('spectrumnozzle').value=options.u1Nozzle;}
        engine.renderObjects();engine.renderQuantityFields();engine.layoutChanged();
        $('objects').querySelectorAll('[data-object]').forEach(box=>{box.checked=(engine.state.quantities[box.dataset.object]??1)>0;});
        engine.state.objects=[...$('objects').querySelectorAll('[data-object]:checked')].map(box=>box.dataset.object);
        await engine.refresh();
      }
    }
    setPanel(options.edit?'edit':options.purpose==='reel-changes'?'output':options.fromMode?'colours':'project');
    if(options.purpose==='reel-changes')$('plannercard').open=true;
    return kind==='converter'?Boolean(engine.session.state):Boolean(engine.state.project);
    }finally{loading=false;tick();}
  },
  // One Export button: the shell shows these choices as a menu when there is more than one.
  export(id){if(!exportChoices().some(choice=>choice.id===id&&!choice.disabled))return;if(id==='plate'){setPanel('output');$('converterprimary').click();return;}if(workspaceMode!=='quick')setPanel('layout');projectPlates.save(id);},
  primary(){if(kind==='converter'&&!$('batchpanel').classList.contains('hidden'))return;const sequential=sequentialAction();if(sequential){sequential.click();return;}setPanel(kind==='spectrum'&&$('mainaction').dataset.action==='apply'?'colours':'output');$(kind==='converter'?'converterprimary':'mainaction').click();},
};
installModelDrop(document,{load:file=>api.load(file),show:value=>parentHost?.workbench?.drag(value),delegate:event=>Boolean(event.target.closest?.('#batchdrop')),error:error=>parentHost?.workbench?.dropError?parentHost.workbench.dropError(error):reportError(error instanceof Error?error:Error(error))});
function exportChoices(){
  if(kind!=='converter'||!projectPlates||!engine?.session.state||sequentialAction())return [];
  const session=engine.session,several=session.visiblePlates().length>1,single=$('converterprimary'),text=single.textContent;
  const choices=[{id:'plate',label:text==='Download project'?(several?'This plate · 3MF':'Project · 3MF'):text,hint:several?'Only the plate you are viewing.':'Open it in your slicer.',disabled:single.disabled}];
  if(several)choices.push({id:'project',label:'All plates · one 3MF',hint:session.target==='prusa'?'PrusaSlicer projects hold one plate. Use print jobs instead.':'Keeps every plate together for editing.',disabled:projectPlates.saveDisabled('project')});
  if(workspaceMode==='quick'&&!several)return choices;
  choices.push({id:'zip',label:'Print jobs · ZIP',hint:'A separate printer file and filament list per plate.',disabled:projectPlates.saveDisabled('zip')});
  return choices;
}
function sequentialAction(){const mode=document.querySelector('[data-print-mode]')?.value;if(currentPanel!=='layout'||!mode||mode==='together')return null;const pack=document.querySelector('[data-pack]');return pack&&!pack.hidden?pack:document.querySelector('[data-prepare]');}
function tick() {
  if(!engine)return;
  const s=kind==='converter'?engine.session:engine.state;
  const loaded=kind==='converter'?Boolean(s.state):Boolean(s.project),busy=Boolean(loading||studio?.busy||(kind==='converter'?s.busy:s.loading||s.exporting));
  const ready=String(loaded);if(document.body.dataset.ready!==ready)document.body.dataset.ready=ready;
  const file=api.source();
  if(file&&file!==source){source=file;parentHost?.workbench?.sourceChanged(kind,file);}
  view.empty.hidden=loaded||busy;
  const batch=kind==='converter'&&!$('batchpanel').classList.contains('hidden');
  const button=sequentialAction()||$(kind==='converter'?'converterprimary':'mainaction'),exports=loaded&&!studio?.pending&&!batch?exportChoices():[],menu=exports.length>1;
  let status=kind==='converter'?$('convertstatus').textContent:$('loadstatus').textContent||$('actionstatus').textContent;
  if(studio?.busy)status=document.querySelector('.studio-message')?.textContent||status;
  if(kind==='converter'&&loaded&&!busy&&status.includes('Nothing has been uploaded'))status=`${s.state.displayName}: ${s.capacityStatus().needed} filament${s.capacityStatus().needed===1?'':'s'} used on this plate. Files stay in your browser.`;
  const plateStatus=currentPanel==='layout'?document.querySelector('#printoptimiser [data-status]'):null,plateBusy=plateStatus?.dataset.busy==='true';
  if(plateStatus?.textContent)status=plateStatus.textContent;
  const report={kind,loaded,pending:Boolean(studio?.pending),busy:busy||plateBusy,batch,title:file?.yab3dDisplayName||file?.name||'Untitled project',status:status||'Files stay in your browser.',exports:menu?exports:[],action:batch?'Batch conversion':studio?.pending?'Finish edit to export':loaded?(menu?'Export':button.textContent):'Open a model to start',disabled:studio?.pending||busy||!loaded||(menu?exports.every(choice=>choice.disabled):button.disabled)||batch};
  const serial=JSON.stringify(report);if(serial!==lastReport){lastReport=serial;parentHost?.workbench?.report(report);}
  colourSummary?.sync();toolbox?.sync(currentPanel,studio?.mode,busy);
  let snapshot;try{snapshot=engine.workbenchPreview();}catch{}
  if(snapshot&&!fallbackPending&&snapshot.key!==fallbackKey){
    fallbackPending=true;fallback.hidden=false;document.body.classList.add('software-mode');
    const img=fallback.querySelector('img');img.hidden=true;
    fallback.querySelector('p').dataset.busy='true';
    snapshot.render().then(result=>{
      if(engine.workbenchPreview()?.key!==snapshot.key)return;
      if(fallbackUrl)URL.revokeObjectURL(fallbackUrl);
      fallbackUrl=URL.createObjectURL(new Blob([result.main],{type:'image/png'}));img.src=fallbackUrl;img.hidden=false;fallbackKey=snapshot.key;
    }).catch(error=>{fallbackKey=snapshot.key;fallback.querySelector('p').textContent=`Static preview unavailable: ${error.message}. You can still review objects in Layout.`;})
      .finally(()=>{fallbackPending=false;fallback.querySelector('p').dataset.busy='false';});
  }
  if(!loaded){fallback.hidden=true;document.body.classList.remove('software-mode');fallbackKey='';}
  const previewNote=$('previewnote');
  const preparing=busy||fallbackPending||(kind==='converter'?s.boundsPending||/^Preparing 3D preview/.test(previewNote?.textContent||''):previewNote?.dataset.busy==='true'||Boolean(loaded&&!s.assessed));
  if(preparing)previewSettledAt=0;else if(!previewSettledAt)previewSettledAt=performance.now();
  const showingProgress=Boolean(preparing||busySince&&performance.now()-previewSettledAt<250);
  progress.hidden=!showingProgress;view.stage.dataset.loading=String(showingProgress);view.stage.setAttribute('aria-busy',String(showingProgress));
  if(preparing){
    if(!busySince)busySince=performance.now();
    progress.querySelector('strong').textContent=studio?.busy?'Applying your model edit…':s.exportingPlates?'Saving your plates…':busy?'Reading your model…':fallbackPending?'Drawing the plate preview…':'Preparing the plate preview…';
    progress.querySelector('p').textContent=`${((performance.now()-busySince)/1000).toFixed(1)}s · ${busy?(status||'Reading the file in your browser.'): 'Measuring objects and building the preview. Large models can take longer.'}`;
  }else if(!showingProgress)busySince=0;
  try{objectTools?.sync();}catch{}
  try{filamentTools?.sync();}catch{}
  try{studio?.sync();}catch{}
  try{projectPlates?.sync();}catch{}
  clarifyControls();
}

function clarifyControls(){
  const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
  const groups=document.querySelectorAll('.object-group-tools');
  for(const group of groups){
    text(group.closest('details')?.querySelector('summary'),'Select parts by their original filament');
    const selector=group.querySelector('[data-object-group]');
    text(group.querySelector('[data-group-action="remove"]'),'Remove matching parts');
    text(group.querySelector('[data-group-action="only"]'),'Keep only matching parts');
    text(group.querySelector('[data-group-action="restore"]'),'Restore all parts');
    let explanation=group.querySelector('[data-group-explanation]');
    if(!explanation){explanation=view.make('p',{'data-group-explanation':'',class:'hint'});group.prepend(explanation);}
    let data;try{data=engine.workbenchObjects();}catch{continue;}
    const value=selector?.value||'all',matching=data.objects.filter(o=>value==='all'||(!o.undecodable&&(value==='multi'?o.colours?.length>1:o.colours?.length===1&&`filament:${o.colours[0].extruder}`===value)));
    text(explanation,`Matches ${matching.length} object types: ${matching.map(o=>o.name).join(', ')||'none'}. These buttons change which whole parts are on the plate. They do not repaint or join their geometry.`);
  }
  const seq=document.querySelector('[data-sequential]')?.parentElement;
  if(seq){const label=[...seq.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());if(label)label.textContent=' Print single-colour groups sequentially';}
  for(const b of document.querySelectorAll('button')){
    if(b.textContent==='Fill plate')b.textContent='Fill with whole sets';
    if(b.closest('.plate-tool-row')&&b.textContent==='Fill with whole sets')b.hidden=true;
    if(b.closest('.plate-tool-row')&&b.textContent==='Objects')b.textContent='Object list';
  }
  // Earlier orientations of a turned object are kept for Undo, not offered as removed objects.
  for(const row of document.querySelectorAll('#objectquantities .object-quantity')){const input=row.querySelector('input[data-object]'),hide=Boolean(input&&studio?.superseded?.has(input.dataset.object)&&Number(input.value)===0);if(row.hidden!==hide)row.hidden=hide;}
  text($('mergeapply'),'Replace this colour');text($('mergeundo'),'Undo colour replacement');
}
try {
  engine=await import(kind==='converter'?'./convert-page.js':'./recolour.js');
  if(kind==='converter'){engine.session.selectionAware=true;filamentTools=mountFilamentTools(view.panels.colours.querySelector('[data-requires-model]'),engine.session);}
  if(kind==='converter')projectPlates=mountProjectPlates({view,session:engine.session,editColours:()=>setPanel('colours'),select:async(id,refresh=false)=>{
    if(!refresh&&!engine.session.setPlate(id))return;
    await engine.session.refreshBounds();engine.refreshPreview?.();
  }});
  objectTools=mountWorkbenchObjects($('platecontrols'),()=>engine.workbenchObjects());
  const arrangeButton=document.querySelector('[data-auto-arrange]'),arrangeStatus=document.querySelector('[data-arrange-status]');
  arrangeButton.onclick=async()=>{
    arrangeButton.disabled=true;arrangeStatus.textContent='Finding a layout around the reserved areas…';arrangeButton.setAttribute('aria-busy','true');
    await new Promise(resolve=>setTimeout(resolve,0));
    try{prepared?.close();const plan=objectTools.arrange();arrangeStatus.textContent=`Arranged ${plan.placements.length} object placements. Quantities unchanged; spacing and reserved areas respected. Ctrl/Cmd+Z undoes this arrangement.`;}
    catch(error){arrangeStatus.textContent=error.message;}
    finally{arrangeButton.disabled=false;arrangeButton.setAttribute('aria-busy','false');}
  };
  studio=mountStudio({view,engine,kind,api,objects:objectTools,setPanel});
  toolbox=mountFeatureToolbox({view,choose:feature=>{if(feature==='paint'||feature==='split')studio.show(feature==='paint'?'colour':'split');else setPanel(feature);}});
  colourSummary=mountModelColours({view,read:()=>{const state=kind==='converter'?engine.session.state:engine.state.project;const data=engine.workbenchObjects();return {loaded:Boolean(state),checking:loading||data.busy,palette:kind==='converter'?state?.colours:state?.colors,objects:data.objects,quantities:data.quantities,copies:data.copies};},manage:()=>setPanel('colours')});
  prepared=mountPreparedPreview(view,{edit:()=>studio.show('select'),onSelect:id=>{
    document.querySelectorAll('[data-preview-plate]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.previewPlate===id)));
    const heading=view.panels.layout.querySelector('.task-heading');heading.querySelector('h1').textContent=id?'Prepared plates':kind==='converter'?'Plates & objects':'Arrange your plate';heading.querySelector('p').textContent=id?'Choose a plate to inspect the copies. Edit model returns to your original quantities.':kind==='converter'?'Choose a plate, edit its objects, then save the complete project.':'Click an object in the preview to duplicate or remove it.';
  }});
  connectPlatePreview($('printoptimiser'),prepared);
  document.addEventListener('keydown',e=>{if(engine.workbenchFocus?.key(e)||prepared.key(e)||studio.key(e))e.stopImmediatePropagation();},true);
  document.body.dataset.mounted='true';
  window.workbenchEngine=api;
  parentHost?.workbench?.ready(kind,api);
  tick();setInterval(tick,250);
}catch(error){reportError(error);parentHost?.workbench?.failed(kind,error.message);}
