import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePlateJobs,mountSequential,prepareWorkbenchPlates} from './plate-workflow.js';
import {parseHTML} from 'linkedom';
import {targetLayout} from '../../web/shared/layout.js';
import {exportComparisonJob} from '../../web/shared/comparisonExport.js';
import {readProject,selectionFootprints,SRC_BBL_PROJECT,SRC_BBL_MODEL,analyse} from '../../web/shared/project.js';
import {readZip} from '../../web/zip.js';
import {jointSampleFile} from './joint-sample.js';
import {editProject} from './model-edit.js';
const rows=[{objectId:'green',name:'Stalk',bounds:{min:[0,0,0],max:[10,10,20]},colours:[{extruder:2}]},{objectId:'body',name:'Body',bounds:{min:[20,0,0],max:[60,40,40]},colours:[{extruder:1},{extruder:3}]}];
const context={objects:rows,quantities:{green:3,body:1},mapping:{},recipes:[],layout:targetLayout('snapmaker',{copies:2,spacing:5,tower:true}),options:{target:'snapmaker',physical:[{color:'#F58231'},{color:'#22864C'},{color:'#000000'}]}};

test('automatic sequential fill survives a colour-review retry and produces matching quantities',async()=>{
  const {document,window}=parseHTML('<html><body><main></main></body></html>'),previous=globalThis.document,previousEvent=globalThis.Event;
  globalThis.document=document;globalThis.Event=window.Event;
  try{
    const host=document.querySelector('main');let ready=false;const exported=[];
    mountSequential(host,()=>{if(!ready)throw Error('Apply and review the palette and export settings before comparing.');return {...context,signature:'same',quantities:{},layout:{...context.layout,copies:1},worker:{async request(type,{job}){exported.push(job);return {bytes:new Uint8Array([1])};}}};});
    Object.defineProperty(host.querySelector('[data-print-mode]'),'value',{value:'together',writable:true});
    const first=await prepareWorkbenchPlates(host,{mode:'sequential',fillIds:['green','body']});assert.equal(first.ok,false);assert.match(host.querySelector('[data-status]').textContent,/confirm the colour mapping/);
    ready=true;host.querySelector('[data-prepare]').dispatchEvent(new window.Event('click',{bubbles:true}));
    for(let i=0;i<200&&host.querySelector('[data-status]').dataset.busy==='true';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(host.querySelector('[data-status]').dataset.state,'success');assert.match(host.querySelector('[data-status]').textContent,/complete sets fitted/);
    assert.equal(exported.length,2);assert(exported[0].count>1);assert.equal(exported[0].count,exported[1].count);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;globalThis.Event=previousEvent;}
});
test('colour plates preserve exact counts and mapped physical colours; PETG and unknown paint stay by layer',()=>{
  const jobs=preparePlateJobs(context,'colours');assert.equal(jobs.length,2);assert.deepEqual(jobs.map(j=>j.count),[6,2]);assert(jobs.every(j=>j.sequence==='by layer'&&!j.mergeGroups));assert.equal(jobs[0].filament,2);
  const mapped=preparePlateJobs({...context,mapping:{1:2,3:2}},'colours');assert.equal(mapped.length,1);assert.equal(mapped[0].count,8);
  const petg=preparePlateJobs({...context,options:{...context.options,supportInterface:true}},'colours');assert.equal(petg.length,1);assert(petg[0].extraSupport);assert.equal(petg[0].filament,null);
  const unknown=preparePlateJobs({...context,objects:rows.map(o=>({...o,undecodable:1}))},'colours');assert.equal(unknown.length,1);assert.equal(unknown[0].filament,null);
  const blend=preparePlateJobs({...context,mapping:{2:5},recipes:[{id:5,a:1,b:2}]},'colours');assert.equal(blend.length,1);
  assert.throws(()=>preparePlateJobs({...context,quantities:{green:99}},'colours'),/1–64/);
});
test('colour-plate archives preserve oriented geometry, quantity, painting and by-layer sequence',async()=>{
  const input=await readZip(await jointSampleFile()),edit=editProject(input,{objectIds:['1'],operation:'separate-colour',from:2,connector:{diameter:3,length:3,clearance:.3}}),p=readProject(edit.entries),ids=edit.changes[0].created.map(o=>o.id);
  const objects=selectionFootprints(p,1,ids),options={target:'snapmaker',convert:true,physical:p.colors.map(color=>({color,type:'PLA'})),mapping:{1:1,2:2},recipes:[],preserveSourceSettings:true};
  const jobs=preparePlateJobs({objects,quantities:{[ids[1]]:2},layout:targetLayout('snapmaker',{copies:1,spacing:5}),options},'colours');
  assert.equal(jobs.length,2);
  for(const job of jobs){const out=exportComparisonJob(p,1,job,options),q=readProject(out.entries);assert.deepEqual(out.problems,[]);assert.deepEqual(analyse(q,1,null).used,[job.filament]);assert.equal(q.items.length,job.count);assert.equal(JSON.parse(new TextDecoder().decode(out.entries.get(SRC_BBL_PROJECT))).print_sequence,'by layer');}
  const sequential=preparePlateJobs({objects,quantities:{},layout:targetLayout('snapmaker',{copies:1,spacing:5}),options},'sequential');assert.equal(sequential[0].sequence,'by object');assert.equal(sequential[0].mergeGroups.length,2);
});

test('Prusa ModelPart stalks split and prepare sequential plates, including already edited archives',async()=>{
  const entries=await readZip(await jointSampleFile()),dec=new TextDecoder(),enc=new TextEncoder();
  entries.set(SRC_BBL_MODEL,enc.encode(dec.decode(entries.get(SRC_BBL_MODEL)).replace('</object>','<part id="1" subtype="ModelPart"><metadata key="name" value="Stalk source"/></part></object>')));
  const edited=editProject(entries,{objectIds:['1'],operation:'separate-colour',from:2,connector:{diameter:3,length:3,clearance:.3}});
  const p=readProject(edited.entries),ids=edited.changes[0].created.map(o=>o.id);
  for(const id of ids)assert(p.meta.get(id).parts.every(part=>part.subtype==='normal_part'),'new edits normalise printable Prusa volume roles');
  // Previously split user projects must also work without doing the split again.
  for(const id of ids)p.meta.get(id).parts.forEach(part=>part.subtype='ModelPart');
  const options={target:'snapmaker',convert:true,physical:p.colors.map(color=>({color,type:'PLA'})),mapping:{1:1,2:2},recipes:[],carrySettings:true};
  const jobs=preparePlateJobs({objects:selectionFootprints(p,1,ids),quantities:{[ids[1]]:2},mapping:options.mapping,recipes:[],layout:targetLayout('snapmaker',{copies:1,spacing:5}),options},'sequential');
  assert.equal(jobs.length,1);assert.equal(jobs[0].count,3);
  const result=exportComparisonJob(p,1,jobs[0],options),q=readProject(result.entries);
  assert.deepEqual(result.problems,[]);assert.equal(q.items.length,2);
  assert.deepEqual(analyse(q,1,null).used,[1,2]);
  assert.equal([...q.meta.values()].flatMap(m=>m.parts).length,3);
  assert([...q.meta.values()].flatMap(m=>m.parts).every(part=>part.subtype==='normal_part'));
  assert.equal(JSON.parse(dec.decode(result.entries.get(SRC_BBL_PROJECT))).print_sequence,'by object');
});

test('plate preparation surfaces worker failure beside Prepare, clears busy state and permits retry',async()=>{
  const {document,window}=parseHTML('<html><body><main></main></body></html>'),previous=globalThis.document;
  globalThis.document=document;
  try {
    const host=document.querySelector('main');let settle;
    const worker={request(type,payload,{onProgress}){assert.equal(type,'comparison-export');onProgress({message:'Checking settings'});return new Promise((resolve,reject)=>{settle={resolve,reject};});}};
    mountSequential(host,()=>({...context,signature:'unchanged',objects:[rows[0]],worker}));
    const mode=host.querySelector('[data-print-mode]');Object.defineProperty(mode,'value',{value:'sequential',writable:true});mode.dispatchEvent(new window.Event('change',{bubbles:true}));
    const button=host.querySelector('[data-prepare]'),status=host.querySelector('[data-status]');
    const click=()=>button.dispatchEvent(new window.Event('click',{bubbles:true}));
    const flush=()=>new Promise(resolve=>setImmediate(resolve));
    click();assert.equal(status.dataset.busy,'true');assert(button.disabled);assert.match(status.textContent,/Checking settings/);assert.equal(button.nextElementSibling,status);
    settle.reject(Error('A genuine part override needs review.'));await flush();
    assert.equal(status.dataset.busy,'false');assert.equal(host.querySelector('section').getAttribute('aria-busy'),'false');assert(!button.disabled);
    assert.match(status.textContent,/Could not prepare plates.*genuine part override/);assert.equal(status.dataset.state,'error');assert(host.querySelector('[data-pack]').hidden);
    click();settle.resolve({bytes:new Uint8Array([1,2,3])});await flush();
    assert.equal(status.dataset.state,'success');assert.match(status.textContent,/ready to download/);assert.equal(status.dataset.busy,'false');assert(host.querySelector('[data-download]'));assert(!host.querySelector('[data-pack]').hidden);
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
