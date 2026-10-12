import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {composeView} from './view-layout.js';
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
  assert.match(shell,/2\.6\.29-test/);assert.match(shell,/data-panel="layout"/);
  const builder=await readFile(new URL('./build.mjs',import.meta.url),'utf8');
  assert.match(builder,/dist-workbench/);assert.doesNotMatch(builder,/Desktop|Stabby|Flippin/);
});
