import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {installModelDrop} from './file-drop.js';

test('anywhere file drop uses one importer, rejects ambiguous input, and ignores internal drags',async()=>{
  const {document,window}=parseHTML('<html><body><main><button>Preview</button></main></body></html>');
  const loaded=[],errors=[],shown=[];
  const stop=installModelDrop(document,{load:file=>loaded.push(file.name),show:value=>shown.push(value),error:e=>errors.push(e)});
  const dispatch=(type,files=[],types=['Files'])=>{
    const event=new window.Event(type,{bubbles:true,cancelable:true});event.dataTransfer={types,files};
    document.querySelector('button').dispatchEvent(event);return event;
  };
  dispatch('dragenter');assert.equal(shown.at(-1),true);
  dispatch('dragenter');dispatch('dragleave');assert.equal(shown.at(-1),true);
  const drop=dispatch('drop',[{name:'Sonic.3mf'}]);assert(drop.defaultPrevented);assert.equal(shown.at(-1),false);
  await new Promise(r=>setImmediate(r));assert.deepEqual(loaded,['Sonic.3mf']);
  assert(!dispatch('drop',[],['text/plain']).defaultPrevented);
  dispatch('drop',[{name:'readme.txt'}]);dispatch('drop',[{name:'one.3mf'},{name:'two.3mf'}]);
  assert.equal(errors.length,2);assert.match(errors[1],/Batch/);assert.equal(loaded.length,1);
  dispatch('dragenter');const escape=new window.Event('keydown');escape.key='Escape';document.dispatchEvent(escape);assert.equal(shown.at(-1),false);
  stop();
});

test('the explicit batch drop zone keeps its multi-file handler',()=>{
  const {document,window}=parseHTML('<html><body><section id="batchdrop"></section></body></html>');
  let count=0;
  installModelDrop(document,{load:()=>assert.fail('single-model import must not run'),delegate:e=>Boolean(e.target.closest('#batchdrop'))});
  document.querySelector('section').addEventListener('drop',e=>{e.preventDefault();count=e.dataTransfer.files.length;});
  const event=new window.Event('drop',{bubbles:true,cancelable:true});event.dataTransfer={types:['Files'],files:[{name:'1.3mf'},{name:'2.3mf'}]};
  document.querySelector('section').dispatchEvent(event);assert.equal(count,2);
});
