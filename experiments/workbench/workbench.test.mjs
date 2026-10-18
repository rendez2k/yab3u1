import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {composeView} from './view-layout.js';
import {mountStudio} from './studio-tools.js';
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
  assert.match(shell,/2\.6\.30-test/);assert.match(shell,/data-panel="layout"/);
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
