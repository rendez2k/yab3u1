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
    assert.equal(view.inspector.querySelector('[data-split-method]').value,'auto-separate');
    assert(view.inspector.querySelector('[data-region-settings]').hidden);assert(!view.inspector.querySelector('[data-auto-settings]').hidden);
    assert.equal(view.inspector.querySelector('[data-edit-apply]').textContent,'Separate automatically');
    const finish=view.inspector.querySelector('[data-auto-finish]');finish.value='fill';finish.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(view.inspector.querySelector('[data-edit-apply]').textContent,'Separate & fill plate');assert.match(view.inspector.querySelector('[data-auto-fill-help]').textContent,/64 per part/);
    finish.value='sequential';finish.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(view.inspector.querySelector('[data-edit-apply]').textContent,'Separate & prepare plates');
  }finally{if(option===undefined)delete globalThis.Option;else globalThis.Option=option;Object.defineProperty(window.HTMLSelectElement.prototype,'value',descriptor);}
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
    assert.equal(document.querySelectorAll('[data-task]').length,5);
    if(kind==='spectrum')assert.equal(document.getElementById('recommendheading').tagName,'H2');
  });
}
test('test build does not replace the production entry or publish private models',async()=>{
  const shell=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(shell,/2\.6\.34-test/);assert.match(shell,/data-panel="layout"/);
  const builder=await readFile(new URL('./build.mjs',import.meta.url),'utf8');
  assert.match(builder,/dist-workbench/);assert.doesNotMatch(builder,/Desktop|Stabby|Flippin/);
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
