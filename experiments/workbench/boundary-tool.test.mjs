import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountBoundaryTool} from './boundary-tool.js';
import {mountSplitPreview} from './split-preview-tool.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('boundary points can be moved, removed and undone; late worker replies cannot restore a cancelled edit',async()=>{
  const {document}=parseHTML('<html><body><section></section></body></html>'),root=document.querySelector('section'),previous=globalThis.Worker,workers=[],file=new File(['original'],'test.3mf');
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){this.sent=data;queueMicrotask(()=>this.onmessage({data:data.action==='start'?{request:data.request,soup:{positions:[],colors:[],ranges:[]}}:{request:data.request,result:{anchors:data.points,path:data.points,closed:data.closed,perimeter:10,mask:new Uint8Array(),selectedFaces:3}}}));}terminate(){this.terminated=true;}};
  let pick=null;const inspection={owner:null,show(owner,soup,label,fn){this.owner=owner;pick=fn;},hide(owner){if(this.owner===owner)this.owner=null;},boundary(){}};
  const make=(tag,attrs={},html='')=>{const el=document.createElement(tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);el.innerHTML=html;return el;};
  const tool=mountBoundaryTool({root,make,source:()=>file,context:()=>({plateId:1}),ids:()=>['1'],inspection});
  try{root.querySelector('[data-boundary-start]').click();await tick();await tick();assert.equal(inspection.owner,'boundary');
    for(const p of [[0,0,0],[10,0,0],[0,10,0]]){pick({point:p,part:0});await tick();}
    assert(!tool.ready);root.querySelector('[data-boundary-close]').click();await tick();assert(tool.ready);
    root.querySelector('[data-boundary-point="1"]').click();pick({point:[11,0,0],part:0});await tick();assert.deepEqual(tool.options().boundary.points[1],[11,0,0]);
    tool.undo();await tick();assert.deepEqual(tool.options().boundary.points[1],[10,0,0]);
    root.querySelector('[data-boundary-remove]').click();await tick();assert(!tool.ready);tool.undo();await tick();assert(tool.ready);
    const late=workers[0].onmessage;tool.destroy();late({data:{request:workers[0].sent.request,result:{anchors:[],path:[]}}});assert.equal(inspection.owner,null);assert(workers[0].terminated);assert.equal(await file.text(),'original');
  }finally{tool.destroy();globalThis.Worker=previous;}
});
test('assembly checks are cancelled and invalidated by changed split settings without replacing the source',async()=>{
  const {document}=parseHTML('<html><body><section></section></body></html>'),root=document.querySelector('section'),previous=globalThis.Worker,workers=[],file=new File(['original'],'test.3mf');
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}};
  let position=50;const inspection={owner:null,hide(owner){if(this.owner===owner)this.owner=null;},show(owner){this.owner=owner;},explode(){},fitExplosion(){}};
  const tool=mountSplitPreview({root,source:()=>file,options:()=>({operation:'cut',position}),inspection});
  try{tool.sync({enabled:true});root.querySelector('[data-split-preview]').click();await tick();assert(tool.pending);assert(workers[0].sent.options.includeAssembly);
    position=60;tool.sync();assert(!tool.pending);assert(workers[0].terminated);workers[0].onmessage({data:{assembly:{positions:[1],ranges:[{}]}}});assert.equal(inspection.owner,null);
    root.querySelector('[data-split-preview]').click();await tick();workers[1].onmessage({data:{assembly:{positions:[1],ranges:[{},{}]}}});assert.equal(inspection.owner,'assembly');tool.destroy();assert.equal(inspection.owner,null);assert.equal(await file.text(),'original');
  }finally{tool.destroy();globalThis.Worker=previous;}
});
