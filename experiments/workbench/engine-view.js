import {composeView} from './view-layout.js';
const kind=document.body.dataset.engine,$=id=>document.getElementById(id);
const view=composeView(document,kind);
let engine, currentPanel='project', lastReport='', source=null;
let fallbackKey='',fallbackPending=false,fallbackUrl=null;
const fallback=view.make('div',{class:'software-preview',hidden:''},'<div><img alt="Static preview of the current model and colours"></div><p>Static preview · 3D acceleration is unavailable in this browser. Use Layout to edit objects.</p>');
view.stage.append(fallback);
const parentHost=window.parent!==window ? window.parent : null;
const reportError=error=>{const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=`The workspace could not complete that action: ${error.message}`;view.feedback.append(p);};
function setPanel(panel) {
  if(!view.panels[panel])return;
  currentPanel=panel;
  for(const [key,node]of Object.entries(view.panels))node.hidden=key!==panel;
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
  if(b.matches('[data-open-sample]'))parentHost?.workbench?.sample();
  if(b.matches('[data-close-batch]'))setPanel('project');
  if(['petgfullspectrum','capacityblend','capacityswaps'].includes(b.id)||b.matches('[data-model-workflow]')) {
    event.preventDefault();event.stopImmediatePropagation();parentHost?.workbench?.switchMode('spectrum',b.id==='capacityswaps'?'reel-changes':'blends');return;
  }
  const id=b.dataset.jump||b.dataset.convertJump;
  if(id&&panelFor(id))setPanel(panelFor(id));
  if(b.matches('[data-arrange]')||/^(Objects|Arrange plate)$/.test(b.textContent.trim()))setPanel('layout');
  if(b.id==='advancedlink')setPanel('colours');
  if(b.id==='capacityrepaint')setPanel('colours');
},true);
function context() {
  if(kind==='converter')return {target:engine.session.target,plateId:String(engine.session.state?.plateId??''),supportInterface:engine.session.supportInterface,interfaceSlot:engine.session.interfaceSlot,interfaceColor:engine.session.interfaceColor,layout:{...engine.session.layout},u1Nozzle:engine.session.u1Nozzle};
  const s=engine.state;return {target:s.target,plateId:String(s.plateId??''),supportInterface:s.supportInterface,interfaceSlot:s.interfacePosition+1,interfaceColor:s.reels[s.interfacePosition]?.color,layout:{quantities:{...s.quantities},copies:Number($('spectrumcopies').value),spacing:Number($('spectrumgap').value),width:Number($('spectrumwidth').value),depth:Number($('spectrumdepth').value),tower:$('spectrumtower').checked,arrangement:$('spectrumarrangement').value},u1Nozzle:s.u1Nozzle};
}
const api={kind,setPanel,context,
  source:()=>kind==='converter'?engine.session.sourceFile:engine.workbenchSource(),
  theme:value=>document.documentElement.dataset.theme=value,
  open:()=>{if(kind==='converter')$('mode-single').click();const input=$(kind==='converter'?'convertfile':'file');input.value='';input.click();},
  batch:()=>{if(kind==='converter')$('mode-bulk').click();},
  async load(file,options={}) {
    setPanel('project');
    if(kind==='converter') {
      if(/\.(glb|zip)$/i.test(file.name)){engine.textureImporter.open(file);return;}
      if(options.target)engine.session.setTarget(options.target);
      await engine.session.load(file);
      if(options.u1Nozzle)engine.session.setU1Nozzle(options.u1Nozzle);
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
    setPanel(options.purpose==='reel-changes'?'output':options.fromMode?'colours':'project');
    if(options.purpose==='reel-changes')$('plannercard').open=true;
    tick();
    return kind==='converter'?Boolean(engine.session.state):Boolean(engine.state.project);
  },
  primary(){if(kind==='converter'&&!$('batchpanel').classList.contains('hidden'))return;setPanel(kind==='spectrum'&&$('mainaction').dataset.action==='apply'?'colours':'output');$(kind==='converter'?'converterprimary':'mainaction').click();},
};
function tick() {
  if(!engine)return;
  const s=kind==='converter'?engine.session:engine.state;
  const loaded=kind==='converter'?Boolean(s.state):Boolean(s.project),busy=kind==='converter'?s.busy:Boolean(s.loading||s.exporting);
  const ready=String(loaded);if(document.body.dataset.ready!==ready)document.body.dataset.ready=ready;
  const file=api.source();
  if(file&&file!==source){source=file;parentHost?.workbench?.sourceChanged(kind,file);}
  view.empty.hidden=loaded||busy;
  const batch=kind==='converter'&&!$('batchpanel').classList.contains('hidden');
  const button=$(kind==='converter'?'converterprimary':'mainaction');
  const status=kind==='converter'?$('convertstatus').textContent:$('loadstatus').textContent||$('actionstatus').textContent;
  const report={kind,loaded,busy,batch,title:file?.yab3dDisplayName||file?.name||'Untitled project',status:status||'Files stay in your browser.',action:loaded?button.textContent:'Open a model to start',disabled:!loaded||button.disabled||batch};
  const serial=JSON.stringify(report);if(serial!==lastReport){lastReport=serial;parentHost?.workbench?.report(report);}
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
}
try {
  engine=await import(kind==='converter'?'./convert-page.js':'./recolour.js');
  window.workbenchEngine=api;
  parentHost?.workbench?.ready(kind,api);
  tick();setInterval(tick,250);
}catch(error){reportError(error);parentHost?.workbench?.failed(kind,error.message);}
