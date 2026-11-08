import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountShapeTool} from './shape-tool.js';
test('shape selection, undo, detail changes and cancellation never mutate source or leave a picking hook',async()=>{
  const {document,window}=parseHTML('<html><body><section></section><p></p></body></html>');
  const root=document.querySelector('section'),message=document.querySelector('p'),oldWorker=globalThis.Worker,descriptor=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value');
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value;},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
  const workers=[];globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){this.request=data;queueMicrotask(()=>this.onmessage({data:{regions:[{id:'0:0',size:[10,10,10]},{id:'0:1',size:[4,4,5]}],previewRegions:Int32Array.from([0,1])}}));}terminate(){this.terminated=true;}};
  const make=(tag,attrs={},html='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;};
  const originalPick=()=>false,p={lastPositions:new Float32Array(18),pickRanges:[{objectId:'1',start:0,count:6}],onRegionPick:originalPick},file=new File(['source'],'test.3mf');
  const state={preview:p,busy:false};let working=false;
  const tool=mountShapeTool({root,make,state:()=>state,source:()=>file,context:()=>({plateId:1}),ids:()=>['1'],preview(){},changed(){},message,palette:()=>['#112233'],busy:()=>working});
  try{
    root.querySelector('[data-shape-detect]').click();while(tool.pending)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(tool.ready,false);root.querySelector('[data-shape-region="1"]').click();assert(tool.ready);assert.deepEqual(tool.options().shapeIds,['0:1']);
    p.onRegionPick({triangle:0,event:{shiftKey:true}});assert.deepEqual(tool.options().shapeIds,['0:1','0:0']);tool.undo();assert.deepEqual(tool.options().shapeIds,['0:1']);
    working=true;p.onRegionPick({triangle:0,event:{}});assert.deepEqual(tool.options().shapeIds,['0:1']);working=false;
    root.querySelector('[data-shape-action]').value='shape-colour';assert.equal(tool.options().operation,'shape-colour');
    root.querySelector('[data-shape-detail]').value='balanced';root.querySelector('[data-shape-detail]').dispatchEvent(new window.Event('change',{bubbles:true}));while(tool.pending)await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(tool.options().shapeIds,['0:1'],'selection hint survives a detail rerun');
    tool.destroy();assert.equal(p.onRegionPick,originalPick);assert(workers.every(w=>w.terminated));assert.equal(await file.text(),'source');assert.equal(tool.ready,false);
  }finally{tool.destroy();globalThis.Worker=oldWorker;Object.defineProperty(window.HTMLSelectElement.prototype,'value',descriptor);}
});
