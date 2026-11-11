import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {composeView} from './view-layout.js';
import {mountStudio} from './studio-tools.js';

test('automatic split controls and finish choices work without a WebGL preview',()=>{
  const {document,window}=parseHTML('<html><body><main></main><aside></aside><section></section></body></html>');
  const option=globalThis.Option,descriptor=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value');
  globalThis.Option=function(text,value){const n=document.createElement('option');n.value=value;n.textContent=text;return n;};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value;},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
  try{
    const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
    const view={stage:document.querySelector('main'),inspector:document.querySelector('aside'),panels:{},make};
    const state={key:'model',objects:[{objectId:'1',name:'Body',colours:[{extruder:1}]}],quantities:{},copies:1,busy:false};
    const studio=mountStudio({view,kind:'converter',engine:{session:{state:{colours:[]}},workbenchObjects:()=>state},api:{source:()=>null},objects:{selected:()=>['1'],element:document.querySelector('section')},setPanel(){}});
    studio.show('split');
    assert.equal(view.inspector.querySelector('[data-split-method]').value,'auto-assembly');
    assert(view.inspector.querySelector('[data-region-settings]').hidden);assert(!view.inspector.querySelector('[data-auto-settings]').hidden);
    assert.equal(view.inspector.querySelector('[data-edit-apply]').textContent,'Separate automatically');
    const finish=view.inspector.querySelector('[data-auto-finish]');finish.value='fill';finish.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(view.inspector.querySelector('[data-edit-apply]').textContent,'Separate & fill plate');assert.match(view.inspector.querySelector('[data-auto-fill-help]').textContent,/64 per part/);
    finish.value='sequential';finish.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(view.inspector.querySelector('[data-edit-apply]').textContent,'Separate & prepare plates');
  }finally{if(option===undefined)delete globalThis.Option;else globalThis.Option=option;Object.defineProperty(window.HTMLSelectElement.prototype,'value',descriptor);}
});
test('an unsuccessful automatic split never reloads, fills or prepares the unchanged model',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');
  const originalOption=globalThis.Option,originalWorker=globalThis.Worker,originalAdd=window.HTMLSelectElement.prototype.add,descriptor=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value');
  globalThis.Option=function(text,value){const n=document.createElement('option');n.value=value;n.textContent=text;return n;};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value;},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
  window.HTMLSelectElement.prototype.add=function(option){this.append(option);};
  globalThis.Worker=class {
    postMessage(){queueMicrotask(()=>this.onmessage({data:{changes:[],reports:[{name:'Snowman',separated:[],retained:[{colour:2,count:1,reason:'The pin is too wide for this join.'}]}]}}));}
    terminate(){}
  };
  try{
    for(const kind of ['converter','spectrum'])for(const finish of ['once','fill','sequential']){
      const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
      const view={stage:make('main'),inspector:make('aside'),panels:{},make},calls=[];
      let file=new File(['source'],'snowman.3mf');const context={plateId:1,layout:{copies:2,quantities:{1:3}}};
      const state={key:'source',objects:[{objectId:'1',name:'Snowman',colours:[{extruder:1},{extruder:2}]}],quantities:{1:3},copies:2,busy:false,apply:()=>calls.push('fill')};
      const engine={session:{state:{colours:['#FFFFFF','#000000']}},state:{project:{colors:['#FFFFFF','#000000']}},workbenchObjects:()=>state};
      const api={source:()=>file,context:()=>context,load:async()=>{calls.push('reload');return true;},preparePlates:async()=>calls.push('prepare')};
      const studio=mountStudio({view,kind,engine,api,objects:{selected:()=>['1'],element:make('section'),history:{canUndo:false,reset:()=>calls.push('reset history')}},setPanel:p=>calls.push(`panel:${p}`)});
      studio.sync();studio.show('split');calls.length=0;
      view.inspector.querySelector('[data-auto-finish]').value=finish;
      view.inspector.querySelector('[data-edit-apply]').click();
      while(studio.busy)await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(calls,[],`${kind}/${finish} must not reload or leave the split workflow`);
      assert.deepEqual(state.quantities,{1:3});assert.equal(state.copies,2);assert.equal(api.source(),file);
      assert.match(view.inspector.querySelector('[data-auto-summary]').textContent,/No safe automatic/);
      assert.match(view.inspector.querySelector('.studio-auto-result').textContent,/quantities are unchanged.*pin is too wide/s);
      assert.equal(view.inspector.querySelector('.studio-auto-result').hidden,false);
      if(finish!=='once')assert.match(view.inspector.querySelector('.studio-message').textContent,/Filling was not started/);
      assert.equal(view.inspector.querySelector('[data-edit-apply]').disabled,false);
      assert.equal(view.stage.querySelector('[data-studio-undo]').disabled,true);
      const outcome=view.inspector.querySelector('.studio-edit-outcome');
      assert(outcome&&!outcome.hidden,'a failed split must leave a visible outcome outside the tool settings');
      assert.match(outcome.textContent,/No split made.*pin is too wide/s);
      studio.show('select');studio.sync();
      assert.equal(outcome.hidden,false,'Select must not erase the split result');
      assert.match(outcome.textContent,/model is unchanged/);
      outcome.querySelector('button').click();assert(outcome.hidden);
      studio.show('split');view.inspector.querySelector('[data-edit-apply]').click();
      while(studio.busy)await new Promise(resolve=>setImmediate(resolve));
      assert(!outcome.hidden);
      file=new File(['different source'],'another.3mf');studio.sync();
      assert(outcome.hidden,'a previous result must not follow a newly opened model');
    }
  }finally{
    if(originalOption===undefined)delete globalThis.Option;else globalThis.Option=originalOption;
    if(originalWorker===undefined)delete globalThis.Worker;else globalThis.Worker=originalWorker;
    if(originalAdd===undefined)delete window.HTMLSelectElement.prototype.add;else window.HTMLSelectElement.prototype.add=originalAdd;
    Object.defineProperty(window.HTMLSelectElement.prototype,'value',descriptor);
  }
});
test('a successful split is announced only after the edited model loads, and Undo clears the result',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');
  const originalOption=globalThis.Option,originalWorker=globalThis.Worker,originalAdd=window.HTMLSelectElement.prototype.add,descriptor=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value');
  globalThis.Option=function(text,value){const n=document.createElement('option');n.value=value;n.textContent=text;return n;};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value;},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
  window.HTMLSelectElement.prototype.add=function(option){this.append(option);};
  const created=[{id:'2',name:'Upper'},{id:'3',name:'Lower'}];
  globalThis.Worker=class {postMessage(){queueMicrotask(()=>this.onmessage({data:{bytes:new Uint8Array(),changes:[{oldId:'1',created}],reports:[{strategy:'assembly',separated:[{}],retained:[]}]}}));}terminate(){}};
  try{
    const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
    const view={stage:make('main'),inspector:make('aside'),panels:{},make},source=new File(['original'],'model.3mf');let file=source,loading=false,release;
    const loaded=new Promise(resolve=>{release=resolve;}),context={plateId:1,layout:{copies:1,quantities:{}}};
    const state={key:'source',objects:[{objectId:'1',name:'Body'}],quantities:{},copies:1,busy:false};
    const engine={session:{state:{colours:[]}},workbenchObjects:()=>state};
    const api={source:()=>file,context:()=>context,async load(next,options){loading=true;await loaded;file=next;state.key=next===source?'source':'edited';state.quantities=options.layout.quantities;state.objects=next===source?[{objectId:'1',name:'Body'}]:created.map(c=>({objectId:c.id,name:c.name}));return true;}};
    const studio=mountStudio({view,kind:'converter',engine,api,objects:{selected:()=>file===source?['1']:['2'],element:make('section'),history:{canUndo:false,reset(){}}},setPanel(){}});
    studio.sync();studio.show('split');view.inspector.querySelector('[data-edit-apply]').click();
    while(!loading)await new Promise(resolve=>setImmediate(resolve));
    const outcome=view.inspector.querySelector('.studio-edit-outcome');assert(outcome.hidden,'do not report success before the new model is committed');
    release();while(studio.busy)await new Promise(resolve=>setImmediate(resolve));
    assert(!outcome.hidden);assert.match(outcome.textContent,/Split complete · 2 new parts/);assert.notEqual(file,source);
    studio.show('select');studio.sync();assert(!outcome.hidden);assert.equal(view.stage.querySelector('[data-studio-undo]').disabled,false);
    studio.key({key:'z',ctrlKey:true,preventDefault(){}});while(studio.busy)await new Promise(resolve=>setImmediate(resolve));
    assert(outcome.hidden);assert.equal(file,source);
  }finally{
    if(originalOption===undefined)delete globalThis.Option;else globalThis.Option=originalOption;
    if(originalWorker===undefined)delete globalThis.Worker;else globalThis.Worker=originalWorker;
    if(originalAdd===undefined)delete window.HTMLSelectElement.prototype.add;else window.HTMLSelectElement.prototype.add=originalAdd;
    Object.defineProperty(window.HTMLSelectElement.prototype,'value',descriptor);
  }
});
test('repair from a failed split targets that model, preserves quantities, and can be undone',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');
  const originalOption=globalThis.Option,originalWorker=globalThis.Worker,originalAdd=window.HTMLSelectElement.prototype.add,descriptor=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value'),sent=[];
  globalThis.Option=function(text,value){const n=document.createElement('option');n.value=value;n.textContent=text;return n;};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value;},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
  window.HTMLSelectElement.prototype.add=function(option){this.append(option);};
  globalThis.Worker=class{postMessage(data){sent.push(data.options);queueMicrotask(()=>this.onmessage({data:data.options.operation==='repair'?{bytes:new Uint8Array(),changes:[{oldId:'1',created:[{id:'2',name:'Repaired'}]}],reports:[{repairs:[{duplicateFaces:1,zeroThicknessFaces:0,degenerateFaces:0,maxMovement:0}]}]}:{changes:[],reports:[{strategy:'assembly',needsRepair:true,retained:[{reason:'This mesh needs repair.',count:1}],separated:[]}]}}));}terminate(){}};
  try{
    for(const count of [1,2]){
    const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
    const view={stage:make('main'),inspector:make('aside'),panels:{},make},source=new File(['original'],'model.3mf');let file=source,selection=['1'];
    const context={plateId:1,layout:{copies:1,quantities:{1:count},arrangement:'group'}},state={key:'source',objects:[{objectId:'1',name:'Body'}],quantities:{1:count},copies:1,busy:false};
    const api={source:()=>file,context:()=>context,async load(next,options){file=next;state.key=next===source?'source':'repaired';state.quantities=options.layout.quantities;state.objects=next===source?[{objectId:'1',name:'Body'}]:[{objectId:'1',name:'Body'},{objectId:'2',name:'Repaired'}];assert.equal(options.layout.arrangement,next===source||count===1?'group':'objects');return true;}};
    const studio=mountStudio({view,kind:'converter',engine:{session:{state:{colours:[]}},workbenchObjects:()=>state},api,objects:{selected:()=>selection,element:make('section'),history:{canUndo:false,reset(){}}},setPanel(){}});
    studio.sync();studio.show('split');view.inspector.querySelector('[data-edit-apply]').click();while(studio.busy)await new Promise(resolve=>setImmediate(resolve));
    const outcome=view.inspector.querySelector('.studio-edit-outcome');assert(!outcome.querySelector('[data-repair-result]').hidden);
    studio.show('select');selection=[];studio.sync();outcome.querySelector('[data-repair-result]').click();while(studio.busy)await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(sent.at(-1),{operation:'repair',objectIds:['1'],plateId:1});assert.match(outcome.textContent,/Mesh repaired.*1 redundant face/s);assert(outcome.querySelector('[data-repair-result]').hidden);assert.deepEqual(state.quantities,{1:count-1,2:1});
    studio.key({key:'z',ctrlKey:true,preventDefault(){}});while(studio.busy)await new Promise(resolve=>setImmediate(resolve));assert.equal(file,source);assert.deepEqual(state.quantities,{1:count});assert(outcome.hidden);
    }
  }finally{
    if(originalOption===undefined)delete globalThis.Option;else globalThis.Option=originalOption;
    if(originalWorker===undefined)delete globalThis.Worker;else globalThis.Worker=originalWorker;
    if(originalAdd===undefined)delete window.HTMLSelectElement.prototype.add;else window.HTMLSelectElement.prototype.add=originalAdd;
    Object.defineProperty(window.HTMLSelectElement.prototype,'value',descriptor);
  }
});
test('an outdated canvas selection cannot edit a replaced object with zero quantity',()=>{
  const {document}=parseHTML('<html><body></body></html>');
  const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
  const view={stage:make('main'),inspector:make('aside'),panels:{},make};
  const state={key:'repaired',objects:[{objectId:'1',name:'Old mesh'},{objectId:'2',name:'Repaired mesh'}],quantities:{1:0,2:1},copies:1,busy:false};
  const studio=mountStudio({view,kind:'converter',engine:{session:{state:{colours:[]}},workbenchObjects:()=>state},api:{source:()=>null},objects:{selected:()=>['1'],element:make('section'),history:{canUndo:false}},setPanel(){}});
  studio.sync();studio.show('split');
  assert(view.inspector.querySelector('.studio-apply').hidden,'a discarded resource must not be editable');
  assert.match(view.inspector.querySelector('[data-selection-title]').textContent,/Click an object/);
  assert.equal(view.inspector.querySelector('[data-scene-object="1"]'),null);
  assert(view.inspector.querySelector('[data-scene-object="2"]'));
});
for(const [kind,file,features]of [
  ['converter','index.html',{project:['convertfile','converttarget','convertplate','bambumodel','printerinputs','importtools'],colours:['convertmap','convertpetg','mergefrom','mergeto','mergeundo','unusedfilaments'],layout:['quantityfields','layoutfill','fillundo','printoptimiser'],output:['settingsbox','printersetup','convertgo','convertout']}],
  ['spectrum','recolour.html',{project:['file','target','plate','spectrumnozzle'],colours:['reels','paletteslots','reservepetg','blendcalibration','spoolimport','mappingdetails','strategy'],layout:['spectrumquantities','spectrumfill','spectrumfillundo','printoptimiser'],output:['export','printersetup','plannercard','subdividemix','spectrumlayermode']}],
]) {
  test(`${kind}: every existing ID survives exactly once and all feature groups are reachable`,async()=>{
    const {document}=parseHTML(await readFile(new URL(`../../web/${file}`,import.meta.url),'utf8'));
    const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
    const result=composeView(document,kind);
    for(const id of ids)assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,`${id} must survive once`);
    for(const [panel,list]of Object.entries(features))for(const id of list)assert.equal(document.getElementById(id).closest('[data-task]')?.dataset.task,panel,id);
    assert.equal(result.panels.project.hidden,false);
    assert.equal(document.getElementById(kind==='converter'?'convertpreview':'preview').closest('#stage')?.id,'stage');
    assert.equal(document.getElementById('chrome-extension').closest('[data-task]').dataset.task,'help');
    assert.equal(document.getElementById('previewwarning').closest('#stage-feedback')?.id,'stage-feedback',
      'preview failures stay visible outside the Project inspector');
    assert.equal(document.querySelectorAll('[data-task]').length,5);
    if(kind==='spectrum')assert.equal(document.getElementById('recommendheading').tagName,'H2');
  });
}
test('production build serves the Workbench without publishing private models',async()=>{
  const shell=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(shell,/2\.6\.90/);assert.doesNotMatch(shell,/Test version|2\.6\.90-test/);assert.match(shell,/data-panel="layout"/);
  const builder=await readFile(new URL('./build.mjs',import.meta.url),'utf8');
  assert.match(builder,/dist-workbench/);assert.doesNotMatch(builder,/Desktop|Stabby|Flippin/);
  const config=await readFile(new URL('../../netlify.toml',import.meta.url),'utf8');
  assert.match(config,/publish = "dist-workbench"/);assert.match(config,/npm run build --prefix experiments\/workbench/);
});

test('undo reload repopulates the scene list when geometry arrives after the revision changes',()=>{
  const {document}=parseHTML('<html><body><main></main><aside></aside><section></section></body></html>');
  const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
  const view={stage:document.querySelector('main'),inspector:document.querySelector('aside'),panels:{},make};
  const state={key:'restored-revision',objects:[],quantities:{},copies:1,busy:true};
  const studio=mountStudio({view,kind:'spectrum',engine:{state:{project:null},workbenchObjects:()=>state},api:{source:()=>null},objects:{selected:()=>[],element:document.querySelector('section')},setPanel(){}});
  studio.sync();assert.equal(view.inspector.querySelector('[data-scene-count]').textContent,'0');
  state.objects=[{objectId:'10',name:'Support arch'}];state.busy=false;
  studio.sync();assert.equal(view.inspector.querySelector('[data-scene-count]').textContent,'1');
  assert.match(view.inspector.querySelector('[data-scene-list]').textContent,/Support arch.*×1/);
});
test('selection arriving during a model load cannot change the inspector panel',()=>{
  const {document}=parseHTML('<html><body><main></main><aside></aside><section></section></body></html>');
  const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
  const view={stage:document.querySelector('main'),inspector:document.querySelector('aside'),panels:{},make},panels=[];
  const state={key:'loading',objects:[{objectId:'1',name:'Body'}],quantities:{},copies:1,busy:true};
  const api={loading:true,source:()=>null},studio=mountStudio({view,kind:'spectrum',engine:{state:{project:null},workbenchObjects:()=>state},api,objects:{selected:()=>['1'],element:document.querySelector('section')},setPanel:p=>panels.push(p)});
  studio.sync();state.busy=false;studio.sync();assert.deepEqual(panels,[]);
  api.loading=false;studio.sync();assert.deepEqual(panels,['edit']);
});
test('quick colour selection follows removal and undo; Delete cannot remove whole objects during a split preview',()=>{
  const {document}=parseHTML('<html><body><main></main><aside></aside><section></section></body></html>');
  const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
  const view={stage:document.querySelector('main'),inspector:document.querySelector('aside'),panels:{},make};
  const state={key:'same-revision',objects:[{objectId:'1',name:'Body',colours:[{extruder:1}]},{objectId:'2',name:'Stalk',colours:[{extruder:2}]}],quantities:{},copies:1,busy:false};
  const studio=mountStudio({view,kind:'spectrum',engine:{state:{project:{colors:['#F58231','#22864C']}},workbenchObjects:()=>state},api:{source:()=>null},objects:{selected:()=>[],element:document.querySelector('section')},setPanel(){}});
  studio.sync();assert(view.inspector.querySelector('[data-find-colour="2"]'));
  state.quantities={2:0};studio.sync();assert.equal(view.inspector.querySelector('[data-find-colour="2"]'),null);
  state.quantities={};studio.sync();assert(view.inspector.querySelector('[data-find-colour="2"]'));
  state.objects[1].undecodable=1;studio.show('select');assert.equal(view.inspector.querySelector('[data-find-colour="2"]'),null);
  studio.show('split');let prevented=false;assert(studio.key({key:'Delete',preventDefault(){prevented=true;}}));assert(prevented);assert.match(view.inspector.querySelector('.studio-message').textContent,/remove only a colour/);
});
