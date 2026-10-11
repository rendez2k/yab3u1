import test from 'node:test';
import assert from 'node:assert/strict';
import {editObjectCopy,groupQuantities} from '../shared/objectQuantities.js';
import {pickTriangle} from '../shared/preview.js';
import {sequentialPlates} from '../shared/printOptimiser.js';
import {planLayout,targetLayout} from '../shared/layout.js';
const objects=[{objectId:'body',name:'Body',colours:[{extruder:1},{extruder:2}],bounds:{min:[0,0,0],max:[40,40,40]}},
  {objectId:'cap',name:'Cap',colours:[{extruder:1}],bounds:{min:[50,0,0],max:[70,20,5]}},
  {objectId:'stem',name:'Stem',colours:[{extruder:3}],bounds:{min:[80,0,0],max:[90,15,15]}}];
test('editing one filled copy preserves unrelated totals; removing a colour preserves set multiplier',()=>{
  assert.deepEqual(editObjectCopy(objects,{},3,'stem','remove').quantities,{body:3,cap:3,stem:2});
  assert.deepEqual(editObjectCopy(objects,{},3,'body','duplicate').quantities,{body:4,cap:3,stem:3});
  assert.deepEqual(groupQuantities(objects,{},'filament:3','remove'),{body:1,cap:1,stem:0});
  assert.throws(()=>editObjectCopy(objects,{},65,'body','duplicate'),/64/);
});
test('picking selects nearest visible triangle independent of colour, and ignores misses',()=>{
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const positions=new Float32Array([-1,-1,.5,1,-1,.5,0,1,.5,-1,-1,-.5,1,-1,-.5,0,1,-.5]);
  assert.equal(pickTriangle(positions,identity,0,0),1);
  assert.equal(pickTriangle(positions,identity,.95,.95),-1);
  assert.equal(pickTriangle(positions,identity.map((x,i)=>i===15?-1:x),0,0),-1);
});
test('sequential preparation merges singles on ONE plate and preserves visible counts',()=>{
  const layout=targetLayout('snapmaker',{copies:3,spacing:5,tower:true});
  const jobs=sequentialPlates({objects,quantities:{},layout,mapping:{},recipes:[],options:{}});
  assert.equal(jobs.length,2);assert.equal(jobs[0].mergeGroups.length,2);
  assert.deepEqual(jobs[0].quantities,{cap:3,stem:3});assert.deepEqual(jobs[1].quantities,{body:3});
  const plan=planLayout({min:[0,0,0],max:[90,40,40]},jobs[0].layout);
  assert.equal(plan.placements.length,6);assert.equal(plan.blocked,false);
  const bounds=id=>{const f=objects.find(o=>o.objectId===id),p=plan.placements.filter(p=>p.objectId===id);
    return {min:[0,1].map(a=>Math.min(...p.map(p=>f.bounds.min[a]+p.offset[a]))),max:[0,1].map(a=>Math.max(...p.map(p=>f.bounds.max[a]+p.offset[a])))};};
  const a=bounds('cap'),b=bounds('stem');
  assert.ok([0,1].some(i=>a.max[i]+25<=b.min[i]+1e-6||b.max[i]+25<=a.min[i]+1e-6));
  assert.equal(sequentialPlates({objects,quantities:{},layout,mapping:{},recipes:[],options:{supportInterface:true}})[0].sequence,'by layer');
});
