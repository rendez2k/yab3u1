import {composeView} from './view-layout.js';
import {mountWorkbenchObjects} from './object-tools.js';
import {mountFilamentTools} from './filament-tools.js';
import {mountStudio} from './studio-tools.js';
import {prepareWorkbenchPlates,connectPlatePreview} from './shared/sequentialPanel.js';
import {mountPreparedPreview} from './prepared-preview.js';
import {mountProjectPlates} from './project-plates.js';
import {installModelDrop} from './file-drop.js';
import {mountModelColours,modelColours} from './model-colours.js';
import {mountFeatureToolbox,STEPS} from './feature-toolbox.js';
import {inspectPlates,trimProject,PICKER_THRESHOLD_BYTES} from './project-trim.js';
import {distance} from './shared/colour.js';
import {colourName} from './shared/assignment.js';
const kind=document.body.dataset.engine,$=id=>document.getElementById(id);
const view=composeView(document,kind);
let engine, currentPanel='project', lastReport='', source=null, workspaceMode='studio', colourSummary, toolbox;
let lastStep='project', readColours=null, currentReport=null, methodOpen=false, interweaveSkipped=false;
let fallbackKey='',fallbackPending=false,fallbackUrl=null;
let objectTools, filamentTools, studio, prepared, projectPlates, loading=false, busySince=0,previewSettledAt=0;
// While the model is read or redrawn, small squares stack up row by row like a print, in the model's own colours.
const BUILD_SHAPE=['..###..','.#####.','.#####.','#######','#######','.#####.','#######'];
const buildPixels=BUILD_SHAPE.flatMap((row,r)=>[...row].map((cell,c)=>cell==='#'?`<i style="--r:${BUILD_SHAPE.length-1-r};--c:${c};grid-row:${r+1};grid-column:${c+1}"></i>`:'')).join('');
const progress=view.make('div',{class:'workbench-progress',hidden:'',role:'status','aria-live':'polite'},`<span class="pixel-build" aria-hidden="true">${buildPixels}</span><div><strong>Preparing your model…</strong><p></p></div>`);
let buildColours='';
function colourBuild(){
  let colours=[];try{colours=modelColours(readColours()).colours.map(c=>c.colour);}catch{}
  if(!colours.length)colours=['#B4E945','#55C3CE','#2F6F57'];
  const key=colours.join();if(key===buildColours)return;buildColours=key;
  // One colour per row, bottom up, so the figure looks printed in the model's filaments.
  for(const pixel of progress.querySelectorAll('.pixel-build i'))pixel.style.backgroundColor=colours[Number(pixel.style.getPropertyValue('--r'))%colours.length];
}
view.stage.append(progress);
const fallback=view.make('div',{class:'software-preview',hidden:''},'<div><img alt="Static preview of the current model and colours"></div><p>Static preview · 3D acceleration is unavailable in this browser. Use Layout to edit objects.</p>');
view.stage.append(fallback);
const parentHost=window.parent!==window ? window.parent : null;
const reportError=error=>{const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=`The workspace could not complete that action: ${error.message}`;view.feedback.append(p);};
// Large multi-plate projects: list the plates first and open only the chosen ones.
let pickerBypass=false;
const megabytes=bytes=>bytes>=10*1048576?Math.round(bytes/1048576):Math.max(.1,Math.round(bytes/104857.6)/10);
async function choosePlates(file){
  if(pickerBypass||!file||file.size<PICKER_THRESHOLD_BYTES||!/\.3mf$/i.test(file.name||''))return file;
  let bytes,found;
  try{bytes=new Uint8Array(await file.arrayBuffer());found=await inspectPlates(bytes);}catch{return file;}
  if(!found)return file;
  const dialog=view.make('dialog',{class:'plate-picker','aria-labelledby':'plate-picker-title'},`<h1 id="plate-picker-title">Choose plates to open</h1><p data-intro></p><div class="plate-picker-tools"><button type="button" data-all>Select all</button><button type="button" data-none>Clear</button><span data-total role="status"></span></div><ul class="plate-picker-list"></ul><p class="plate-picker-status" role="status" aria-live="polite"></p><div class="plate-picker-actions"><button type="button" data-cancel>Cancel</button><button type="button" data-everything>Open everything</button><button type="button" class="primary" data-open>Open selected</button></div>`);
  dialog.querySelector('[data-intro]').textContent=`${file.name} is ${megabytes(file.size)} MB with ${found.plates.length} plates. Opening only the plates you need is faster and uses far less memory. The rest of the file is left out of this session; your original file is not changed.`;
  const list=dialog.querySelector('ul'),urls=[];
  found.plates.forEach((plate,index)=>{
    const item=view.make('li'),label=view.make('label'),box=view.make('input',{type:'checkbox','data-plate':plate.id}),copy=view.make('span',{class:'plate-picker-copy'}),title=view.make('strong'),detail=view.make('span'),names=view.make('span',{class:'plate-picker-names'});
    if(plate.thumbnail){const url=URL.createObjectURL(new Blob([plate.thumbnail],{type:'image/png'}));urls.push(url);label.append(box,view.make('img',{src:url,alt:'',width:'56',height:'56'}));}else label.append(box,view.make('span',{class:'plate-picker-blank','aria-hidden':'true'}));
    title.textContent=plate.name?`Plate ${index+1} · ${plate.name}`:`Plate ${index+1}`;
    detail.textContent=`${plate.objectIds.length} object${plate.objectIds.length===1?'':'s'} · about ${megabytes(plate.bytes)} MB unpacked`;
    names.textContent=plate.objectNames.slice(0,6).join(', ')+(plate.objectNames.length>6?` and ${plate.objectNames.length-6} more`:'');
    copy.append(title,detail,names);label.append(copy);item.append(label);list.append(item);
  });
  const boxes=[...dialog.querySelectorAll('[data-plate]')],status=dialog.querySelector('.plate-picker-status'),open=dialog.querySelector('[data-open]');
  const sync=()=>{
    const chosen=found.plates.filter((_,i)=>boxes[i].checked),total=chosen.reduce((sum,p)=>sum+p.bytes,0);
    dialog.querySelector('[data-total]').textContent=chosen.length?`${chosen.length} of ${found.plates.length} selected · about ${megabytes(total)} MB`:'Nothing selected';
    open.disabled=!chosen.length;open.textContent=chosen.length?`Open ${chosen.length} plate${chosen.length===1?'':'s'}`:'Open selected';
  };
  boxes.forEach(box=>box.addEventListener('change',sync));
  dialog.querySelector('[data-all]').onclick=()=>{boxes.forEach(b=>{b.checked=true;});sync();};
  dialog.querySelector('[data-none]').onclick=()=>{boxes.forEach(b=>{b.checked=false;});sync();};
  sync();document.body.append(dialog);
  try{
    return await new Promise(resolve=>{
      dialog.addEventListener('cancel',event=>{event.preventDefault();resolve(null);});
      dialog.querySelector('[data-cancel]').onclick=()=>resolve(null);
      dialog.querySelector('[data-everything]').onclick=()=>resolve(file);
      open.onclick=async()=>{
        const ids=found.plates.filter((_,i)=>boxes[i].checked).map(p=>p.id);
        for(const b of dialog.querySelectorAll('button,input'))b.disabled=true;status.textContent='Preparing the chosen plates…';
        await new Promise(next=>setTimeout(next,30));
        try{
          const trimmed=await trimProject(bytes,ids),picked=new File([trimmed.bytes],file.name,{type:file.type,lastModified:Date.now()});
          resolve(picked);
        }catch(error){status.textContent=`${error.message} Choose different plates, or Cancel.`;for(const b of dialog.querySelectorAll('button,input'))b.disabled=false;sync();}
      };
      dialog.showModal();
    });
  }finally{dialog.close();dialog.remove();for(const url of urls)URL.revokeObjectURL(url);}
}
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
  currentPanel=panel;if(['project','colours','output'].includes(panel))lastStep=panel;
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
  if(b.dataset.colourWorkflow){
    const purpose=b.dataset.colourPurpose;
    if(b.dataset.colourWorkflow===kind){if(purpose==='reel-changes'){setPanel('output');$('plannercard').open=true;$('plannercard').scrollIntoView?.({block:'start'});}}
    else parentHost?.workbench?.switchMode(b.dataset.colourWorkflow,purpose);
  }
  if(b.matches('[data-close-batch]'))setPanel('project');
  if(b.matches('[data-auto-merge]'))autoMerge();
  if(b.matches('[data-use-interweave]')){const box=$('interweaveon');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));const fold=document.querySelector('.print-options');if(fold)fold.open=true;}
  if(b.matches('[data-skip-interweave]')){interweaveSkipped=true;stepKey='';}
  if(b.matches('[data-see-changes]')){setPanel('colours');$('colouroutcome')?.scrollIntoView?.({block:'start'});}
  // Pack chooser: once a pack is picked the list folds to that pack.
  if(b.matches('[data-card]')){const list=b.closest('[data-cards]');if(list)list.dataset.folded='true';}
  if(b.matches('[data-change-pack]')){const list=document.querySelector('#bundlepanel [data-cards]');if(list){list.dataset.folded='false';list.querySelector('[aria-checked=true]')?.focus();}}
  if(b.matches('[data-change-method]')){methodOpen=true;stepKey='';tick();document.querySelector('.colour-choices button[aria-pressed=true]')?.focus();}
  if(b.matches('[data-other-palettes]')){const list=$('palettechoices'),all=list.toggleAttribute('data-all');b.setAttribute('aria-expanded',String(all));b.textContent=all?'Show only the chosen set':'Compare other reel sets';}
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
  const s=engine.state;return {capacity:s.capacity,bambuSetup:s.bambuSetup,target:s.target,plateId:String(s.plateId??''),supportInterface:s.supportInterface,interfaceSlot:s.interfacePosition+1,interfaceColor:s.reels[s.interfacePosition]?.color,layout:{quantities:{...s.quantities},...(s.manual?{manual:{...s.manual}}:{}),copies:Number($('spectrumcopies').value),spacing:Number($('spectrumgap').value),width:Number($('spectrumwidth').value),depth:Number($('spectrumdepth').value),tower:$('spectrumtower').checked,arrangement:$('spectrumarrangement').value},u1Nozzle:s.u1Nozzle};
}
const api={kind,setPanel,context,
  // Colour and export choices, as already captured for undoing a model edit.
  captureSettings:()=>engine.workbenchCaptureSettings?.(),
  restoreSettings:saved=>engine.workbenchRestoreSettings?.(saved),
  hiddenObjects:()=>[...(studio?.superseded||[])],
  setHiddenObjects:ids=>studio?.hide(ids),
  setWorkspaceMode(value){
    const next=value==='quick'&&kind==='converter'?'quick':'studio',changed=next!==workspaceMode;workspaceMode=next;
    document.body.dataset.workspaceMode=workspaceMode;
    view.panels.project.querySelector('h1').textContent=workspaceMode==='quick'?'Convert a model':'Your model';
    view.panels.project.querySelector('.task-heading p').textContent=workspaceMode==='quick'?'Choose its destination, then export.':'Open a model and choose your printer.';
    if(workspaceMode==='quick'){studio?.leavePanel();currentPanel='project';prepared?.close();}
    for(const [key,node]of Object.entries(view.panels))node.hidden=workspaceMode==='quick'?!['project','output'].includes(key):key!==currentPanel;
    const advanced=document.querySelector('.conversion-settings');if(advanced&&changed)advanced.open=false;
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
    // A fresh file from the user may be opened in part; internal reloads never ask.
    if(!options.edit&&!options.fromMode&&!options.restored){file=await choosePlates(file);if(!file)return false;}
    pickerBypass=true;loading=true;prepared?.reset();if(!options.edit)setPanel('project');tick();
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
        engine.state.quantities={...options.layout.quantities};engine.state.manual=options.layout.manual&&Object.keys(options.layout.manual).length?{...options.layout.manual}:null;
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
    }finally{pickerBypass=false;loading=false;tick();}
  },
  // One Export button: the shell shows these choices as a menu when there is more than one.
  export(id){if(!exportChoices().some(choice=>choice.id===id&&!choice.disabled))return;if(id==='plate'){setPanel('output');$('converterprimary').click();return;}if(workspaceMode!=='quick')setPanel('layout');projectPlates.save(id);},
  primary(){if(kind==='converter'&&!$('batchpanel').classList.contains('hidden'))return;const sequential=sequentialAction();if(sequential){sequential.click();return;}
    // Pressing Download is the confirmation: there is no separate box to tick first.
    if(kind==='spectrum'&&$('mainaction').dataset.action==='review'){const box=$('review');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));setPanel('output');
      let tries=0;const go=()=>{if($('mainaction').dataset.action==='download')$('mainaction').click();else if((tries+=1)<20)setTimeout(go,100);};setTimeout(go,50);return;}setPanel(kind==='spectrum'&&$('mainaction').dataset.action==='apply'?'colours':'output');$(kind==='converter'?'converterprimary':'mainaction').click();},
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
// Guided steps: Model, Colours, Check, Download. One Back/Next bar serves whichever step is open.
const stepBar=view.make('div',{class:'step-footer',hidden:''},'<ul class="step-downloads" hidden></ul><p class="step-note" role="status"></p><div class="step-buttons"><button type="button" data-step-back>Back</button><button type="button" class="primary" data-step-next>Next</button></div>');
view.inspector.append(stepBar);
const stepNames=Object.fromEntries(STEPS.map(([id,label])=>[id,label])),stepPanels=['project','colours','output'];
const applying=()=>kind==='spectrum'&&$('mainaction')?.dataset.action==='apply';
function nextStep(){
  if(!stepPanels.includes(currentPanel))return {label:`Back to ${stepNames[lastStep]}`,run:()=>setPanel(lastStep)};
  if(currentPanel==='project')return {label:'Next: Colours',run:()=>setPanel('colours')};
  if(currentPanel==='colours'){
    const button=$('mainaction');
    if(applying())return {label:button.textContent,disabled:button.disabled,run:()=>api.primary(),note:'Apply the suggested colours to carry on.'};
    let open=0;if(kind==='converter'){try{const check=engine.session.capacityStatus();open=check.unresolved?check.excess||1:0;}catch{}}
    return {label:'Next: Check',run:()=>setPanel('output'),note:open?`${open} colour${open===1?'':'s'} still need${open===1?'s':''} a decision. Pick one of the choices above.`:''};
  }
  const report=currentReport||{},several=(report.exports||[]).length>1;
  let open=0;if(kind==='converter'){try{const check=engine.session.capacityStatus();open=check.unresolved?check.excess||1:0;}catch{}}
  return {label:several?'Download…':report.action||'Download',disabled:Boolean(report.disabled),note:open?`Step 2 is not finished: ${open} colour${open===1?'':'s'} still need${open===1?'s':''} a decision.`:report.disabled?report.status:'',
    run:()=>{if(!several){api.primary();return;}const list=stepBar.querySelector('.step-downloads');list.hidden=!list.hidden;}};
}
stepBar.querySelector('[data-step-next]').onclick=()=>{try{nextStep().run();}catch(error){reportError(error);}};
stepBar.querySelector('[data-step-back]').onclick=()=>setPanel(stepPanels[Math.max(0,stepPanels.indexOf(currentPanel)-1)]);
stepBar.querySelector('.step-downloads').addEventListener('click',event=>{const b=event.target.closest('[data-export]');if(!b)return;stepBar.querySelector('.step-downloads').hidden=true;api.export(b.dataset.export);});
// Merge similar colours, done for the user: the two closest colours share a filament, until the model fits the printer.
async function autoMerge(){
  const say=text=>{document.querySelector('[data-auto-merge-status]').textContent=text;},session=engine.session,pause=()=>new Promise(resolve=>setTimeout(resolve,60));
  try{
    const repaint=document.querySelector('.repaint .modes input[value=repaint]');if(!repaint.checked){repaint.click();await pause();}
    const done=[];
    for(let guard=0;guard<32&&session.capacityStatus().unresolved;guard+=1){
      const selects=[...document.querySelectorAll('#convertmap select[data-source]')],colours=session.state.colours;
      const used=[...new Set(selects.map(s=>Number(s.value)))].filter(slot=>/^#[0-9a-f]{6}$/i.test(colours[slot-1]||''));
      let best=null;
      for(const a of used)for(const b of used)if(a<b){const d=distance(colours[a-1],colours[b-1]);if(!best||d<best.d)best={a,b,d};}
      if(!best)break;
      for(const select of selects)if(Number(select.value)===best.b){select.value=String(best.a);select.dispatchEvent(new Event('change',{bubbles:true}));await pause();}
      done.push(`${colourName(colours[best.b-1])} ${colours[best.b-1]} now prints as ${colourName(colours[best.a-1])} ${colours[best.a-1]}`);
    }
    say(done.length?`${done.join('. ')}. Check the preview; Reset assignments undoes this.`:'Nothing needed merging.');
    if(session.capacityStatus().unresolved)say(`${done.join('. ')}${done.length?'. ':''}Some colours still need a decision: choose their filament below.`);
  }catch(error){say(`Could not merge automatically: ${error.message}`);}
  stepKey='';tick();
}
// Says which reel set the 3D view is showing, so Applied and Suggested cannot be mistaken for each other.
let captionKey='';
function syncViewCaption(loaded){
  if(kind!=='spectrum')return;
  let caption=document.querySelector('.view-caption');
  if(!caption){caption=view.make('div',{class:'view-caption',role:'status','aria-live':'polite'},'<strong></strong><span class="view-caption-reels" aria-hidden="true"></span><span data-caption-detail></span>');$('platecontrols').prepend(caption);}
  const s=engine.state,suggested=s.reelView==='recommended'&&Boolean(s.recommendation);
  const mode=!loaded?'':s.strategy==='source'||s.previewMode==='original'?'original':suggested?'suggested':s.workflow==='model'&&!s.modelApplied?'none':'applied';
  const reels=mode==='suggested'?s.recommendation.reels:mode==='applied'?s.reels:[],blends=mode==='suggested'||mode==='applied'?(s.recipes||[]).length:0;
  const key=JSON.stringify([mode,reels.map(r=>r.color),blends]);if(key===captionKey)return;captionKey=key;
  caption.hidden=!mode;caption.dataset.mode=mode;
  const mix=blends?` + ${blends} blend${blends===1?'':'s'}`:'';
  caption.querySelector('strong').textContent={original:'Original',suggested:'Suggested · not applied yet',applied:'Applied',none:'Nothing applied yet'}[mode]||'';
  caption.querySelector('[data-caption-detail]').textContent={original:'The colours in your file.',suggested:`${reels.length} reels${mix}. Press Apply palette to use this set.`,applied:`${reels.length} reels${mix}. This is what will be downloaded.`,none:'Choose a suggested set, then apply it.'}[mode]||'';
  const chips=caption.querySelector('.view-caption-reels');chips.replaceChildren(...reels.map(r=>{const i=view.make('i');i.style.backgroundColor=r.color;return i;}));
  caption.setAttribute('aria-label',`${caption.querySelector('strong').textContent}. ${caption.querySelector('[data-caption-detail]').textContent}`);
}
let stepKey='';
function syncSteps(loaded,busy,batch,report){
  if(kind==='spectrum'){
    // A model with large flat tops in blended colours bands there; offer the setting made for it.
    let tip=document.querySelector('[data-flat-tip]');
    if(!tip){tip=view.make('div',{'data-flat-tip':'',hidden:'',role:'status'},'<strong>This model has flat tops in blended colours</strong><p></p><div><button type="button" class="primary" data-use-interweave>Turn on Top surface interweave</button><button type="button" data-skip-interweave>Not now</button></div>');view.panels.output.querySelector('.task-heading').after(tip);}
    let flat=null;try{flat=loaded?engine.workbenchFlatTops():null;}catch{}
    const offered=Boolean(flat&&flat.blends&&flat.share>=0.1&&!$('interweaveoptions').hidden&&!$('interweaveon').checked&&!interweaveSkipped);
    if(tip.hidden===offered){tip.hidden=!offered;if(offered)tip.querySelector('p').textContent=`About ${Math.round(flat.share*100)}% of the blended surface is flat or nearly flat. Blends are made layer by layer, so those tops would print as bands of single colours. Top surface interweave paints them as narrow stripes of the two reels instead. It is experimental and the stripes have not been printed yet: try it on one small part first, and check the top layers in the slicer preview.`;}
  }
  if(kind==='spectrum'){
    let note=document.querySelector('[data-change-note]');
    if(!note){note=view.make('div',{'data-change-note':''},'<p role="status"></p><button type="button" data-see-changes>See what each colour becomes</button>');$('review').closest('label').after(note);}
    const text=/approximate/i.test($('reviewtext').textContent)?'Some colours are approximate and will look different from the original. Downloading accepts those changes.':'';
    if(note.firstChild.textContent!==text)note.firstChild.textContent=text;
  }
  try{syncViewCaption(loaded);}catch{}
  let coloursDone=false;
  if(loaded){try{coloursDone=kind==='converter'?!engine.session.capacityStatus().unresolved:!applying();}catch{}}
  const done={project:loaded,colours:loaded&&coloursDone,output:loaded&&coloursDone&&!report.disabled&&!report.pending,download:false};
  toolbox?.sync(currentPanel,studio?.mode,busy,{loaded,done,download:{disabled:!loaded}});
  const show=loaded&&!batch&&workspaceMode!=='quick'&&currentPanel!=='help';
  const next=show?nextStep():{},several=currentPanel==='output'&&(report.exports||[]).length>1;
  // How many colours the model has against how many the printer holds: the one question of step 2.
  let need='',recommend=false,cap=null,count=0,target='';
  if(loaded){try{const c=context();cap=Number(c.capacity)||null;target=c.target;count=modelColours(readColours()).count;}catch{}
    need=!count?'':cap==null?`Your model uses ${count} colour${count===1?'':'s'}.`
      :count<=cap?`Your model uses ${count} colour${count===1?'':'s'} and your printer holds ${cap}, so they all fit. Carry on to Check, or change how they print below.`
      :`Your model uses ${count} colours. Your printer holds ${cap} at once. Choose how to print the other ${count-cap}.`;
    recommend=cap!=null&&count>cap;}
  let keepShown=false,plain='';
  if(kind==='converter'&&loaded){try{
    const check=engine.session.capacityStatus();keepShown=check.unresolved||$('capacitykeep').checked;
    plain=check.problem||engine.session.capacityError||(check.capacity==null?`This file lists ${check.needed} filament${check.needed===1?'':'s'}. Your printer's size is not set.`
      :check.excess?`This file lists ${check.needed} filaments and your printer holds ${check.capacity}. Step 2 sorts out the other ${check.excess}.`
      :check.outsideSlots?'Some colours sit outside slots 1–4. Step 2 moves them.':`All ${check.needed} filament${check.needed===1?'':'s'} fit your printer.`);
  }catch{}}
  const key=JSON.stringify([show,currentPanel,next.label,next.disabled,next.note,several&&report.exports,need,recommend,target,keepShown,plain,methodOpen]);
  if(key===stepKey)return;stepKey=key;
  stepBar.hidden=!show;document.body.dataset.steps=show?'on':'off';
  const needNode=document.querySelector('[data-colour-need]');if(needNode)needNode.textContent=need;
  for(const b of document.querySelectorAll('[data-recommended]'))b.hidden=!recommend;
  for(const b of document.querySelectorAll('[data-colour-purpose="reel-changes"]'))b.hidden=target!=='snapmaker';
  const keep=document.querySelector('.keep-all-colours');if(keep)keep.hidden=!keepShown;
  // Once a method is in use the three cards shrink to one line; Change brings them back.
  const merge=document.querySelector('.auto-merge');if(merge){merge.hidden=false;merge.querySelector('button').hidden=!keepShown||$('capacitykeep').checked;}
  const flow=document.querySelector('.colour-workflow');
  if(flow){const settled=kind==='spectrum'||(loaded&&!keepShown),folded=settled&&!methodOpen;flow.dataset.folded=String(folded);
    flow.querySelector('.colour-method').hidden=!folded;flow.querySelector('[data-method-name]').textContent=kind==='converter'&&!recommend?'Solid colours, as painted':flow.querySelector('.colour-choices button[aria-pressed=true] strong')?.textContent||'';}
  if(kind==='converter'){let line=document.querySelector('[data-capacity-plain]');if(!line){line=view.make('p',{'data-capacity-plain':'',role:'status'});$('capacitystatus').after(line);}line.textContent=plain;}
  // A warning inside the folded print options must not stay out of sight.
  const warned=$('subdividewarning'),folded=document.querySelector('.print-options');if(folded&&warned&&!warned.hidden&&!folded.dataset.warned){folded.open=true;folded.dataset.warned='true';}
  const packs=document.querySelector('#bundlepanel [data-cards]');
  if(packs&&!packs.nextElementSibling?.matches('[data-change-pack]')){packs.after(view.make('button',{type:'button','data-change-pack':''},'Choose a different pack'));if(!packs.dataset.folded)packs.dataset.folded=String(Boolean(packs.querySelector('[aria-checked=true]')));}
  if(!show)return;
  const back=stepBar.querySelector('[data-step-back]'),forward=stepBar.querySelector('[data-step-next]'),list=stepBar.querySelector('.step-downloads');
  back.hidden=!stepPanels.includes(currentPanel)||currentPanel==='project';
  forward.textContent=next.label;forward.disabled=Boolean(next.disabled)||busy;
  stepBar.querySelector('.step-note').textContent=next.note||'';
  if(!several)list.hidden=true;
  list.replaceChildren(...(several?report.exports:[]).map(choice=>{const li=view.make('li'),b=view.make('button',{type:'button','data-export':choice.id});const strong=view.make('strong'),hint=view.make('span');strong.textContent=choice.label;hint.textContent=choice.hint;b.append(strong,hint);b.disabled=Boolean(choice.disabled);li.append(b);return li;}));
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
  const report={kind,loaded,pending:Boolean(studio?.pending),busy:busy||plateBusy,batch,title:file?.yab3dDisplayName||file?.name||'Untitled project',status:status||'Files stay in your browser.',exports:menu?exports:[],action:batch?'Batch conversion':studio?.pending?'Finish edit to export':loaded?(menu?'Export':button.textContent==='Review & download'?'Download project':button.textContent):'Open a model to start',disabled:studio?.pending||busy||!loaded||(menu?exports.every(choice=>choice.disabled):button.disabled)||batch};
  const serial=JSON.stringify(report);if(serial!==lastReport){lastReport=serial;parentHost?.workbench?.report(report);}
  currentReport=report;colourSummary?.sync();syncSteps(loaded,busy,batch,report);
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
    colourBuild();
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
  if(kind==='converter'){
    // The page's own file picker goes straight to the session, so ask there too.
    const loadSession=engine.session.load.bind(engine.session);
    engine.session.load=async(file,...rest)=>{const picked=await choosePlates(file);return picked?loadSession(picked,...rest):undefined;};
    engine.session.selectionAware=true;filamentTools=mountFilamentTools(view.panels.colours.querySelector('[data-requires-model]'),engine.session);
    const tools=view.panels.colours.querySelector('.filament-tools'),fold=view.panels.colours.querySelector('[data-remove-colour]');if(tools&&fold)fold.append(tools);}
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
  toolbox=mountFeatureToolbox({view,choose:feature=>{if(feature==='paint'||feature==='split')studio.show(feature==='paint'?'colour':'split');else if(feature==='download'){setPanel('output');stepBar.querySelector('[data-step-next]').focus();}else setPanel(feature);}});
  readColours=()=>{const state=kind==='converter'?engine.session.state:engine.state.project;const data=engine.workbenchObjects();return {loaded:Boolean(state),checking:loading||data.busy,palette:kind==='converter'?state?.colours:state?.colors,objects:data.objects,quantities:data.quantities,copies:data.copies};};
  colourSummary=mountModelColours({view,read:readColours,manage:()=>setPanel('colours')});
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
