import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountJointTool} from './joint-tool.js';

test('joint checks are read-only, expose actual dimensions and discard stale or cancelled responses',async()=>{
  const {document,window}=parseHTML('<html><body><section></section></body></html>'),root=document.querySelector('section');
  const descriptor=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value'),oldWorker=globalThis.Worker,workers=[];
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value;},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){this.request=data;}terminate(){this.terminated=true;}};
  let file=new File(['original'],'sample.3mf'),position=50,tool;
  const q=s=>root.querySelector(s),change=selector=>q(selector).dispatchEvent(new window.Event('input',{bubbles:true}));
  const join={name:'Sample',kind:'dowel',diameter:3,length:3,socketDiameter:3.3,socketDepth:3.2,face:{rings:[[[0,0],[10,0],[10,10],[0,10]]],centre:[5,5],automatic:[5,5]}};
  try{
    tool=mountJointTool({root,source:()=>file,options:()=>({objectIds:['1'],operation:'cut',position,connector:tool.settings()})});
    q('[data-add-pin]').checked=true;q('[data-pin-kind]').value='dowel';tool.sync();
    assert.equal(q('[data-pin-side-field]').hidden,true);assert.match(q('[data-length-label]').textContent,/Depth per part/);
    q('[data-joint-check]').click();await new Promise(setImmediate);
    assert(tool.pending);assert.equal(workers[0].request.options.previewOnly,true);assert.equal(workers[0].request.options.connector.kind,'dowel');
    workers[0].onmessage({data:{joins:[join]}});assert(!tool.pending);assert(!q('[data-joint-result]').hidden);assert.match(q('[data-joint-face-help]').textContent,/3.30 × 3.20/);assert(q('svg'));
    q('[data-pin-across]').value='1.5';change('[data-pin-across]');assert(q('[data-joint-result]').hidden);
    q('[data-joint-check]').click();await new Promise(setImmediate);assert.deepEqual(workers[1].request.options.connector.offset,[1.5,0]);
    position=60;tool.sync();assert(!tool.pending);assert(workers[1].terminated);workers[1].onmessage({data:{joins:[join]}});assert(q('[data-joint-result]').hidden);
    q('[data-joint-check]').click();await new Promise(setImmediate);q('[data-joint-check]').click();assert(!tool.pending);assert(workers[2].terminated);
    q('[data-joint-check]').click();await new Promise(setImmediate);workers[3].onmessage({data:{error:'Too close to an edge'}});assert.equal(q('[data-joint-status]').dataset.error,'true');assert(q('[data-joint-result]').hidden);
    q('[data-joint-reset]').click();assert.deepEqual(tool.settings().offset,[0,0]);
    q('[data-joint-check]').click();await new Promise(setImmediate);workers[4].onmessage({data:{joins:[join]}});
    const svg=q('svg');svg.getBoundingClientRect=()=>({left:0,top:0,width:200,height:100});
    const move=new window.Event('click',{bubbles:true});Object.defineProperties(move,{clientX:{value:100+100/11.6},clientY:{value:50+100/11.6}});svg.dispatchEvent(move);await new Promise(setImmediate);
    assert.deepEqual(workers[5].request.options.connector.offset,[1,-1]);assert(tool.pending);assert(q('[data-joint-result]').hidden);
    workers[5].onmessage({data:{joins:[{...join,face:{...join.face,centre:[6,4]}}]}});assert.equal(q('.joint-socket').getAttribute('cx'),'6');
    file=new File(['different source'],'other.3mf');tool.sync();assert(q('[data-joint-result]').hidden);
    tool.sync({enabled:false});assert(q('[data-joint-check]').disabled);
  }finally{tool?.destroy();globalThis.Worker=oldWorker;Object.defineProperty(window.HTMLSelectElement.prototype,'value',descriptor);}
  assert(workers.every(w=>w.terminated));
});
