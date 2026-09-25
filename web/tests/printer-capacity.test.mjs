import test from 'node:test';
import assert from 'node:assert/strict';
import {ConvertSession} from '../shared/convertSession.js';

async function fixture({count=6, usage=null, convert}={}) {
  const calls=[];
  const worker={dispose(){}, load:async()=>({meta:{kind:'bambu',title:'Six colours',
    colors:Array.from({length:count},(_,i)=>'#'+String(i+1).repeat(6)),types:Array(count).fill('PLA'),
    plates:[{id:1,name:'Test'}],filamentUsage:usage},summary:{}}),
    convert:async(...args)=>{calls.push(args);return convert ? convert() : {bytes:new Uint8Array([1])};}};
  const session=new ConvertSession(()=>worker,{}, {create:()=> 'blob:test',revoke(){}});
  const file={name:'model.3mf',arrayBuffer:async()=>new ArrayBuffer(8)};
  await session.load(file);
  return {session,calls,file};
}

test('six project filaments on U1 require a solution; explicit keep-all preserves mapping',async()=>{
  const {session:s,calls,file}=await fixture();
  assert.equal(s.sourceFile,file);
  assert.equal(s.capacityStatus().needed,6);assert.equal(s.capacityStatus().excess,2);
  assert.equal(await s.convert('snapmaker',1),null);assert.equal(calls.length,0);
  s.setKeepAll(true);
  const result=await s.convert('snapmaker',1);
  assert(result.capacity.unresolved);assert(result.capacity.acknowledged);
  assert.deepEqual(calls[0][3],{1:1,2:2,3:3,4:4,5:5,6:6});
  s.setSource(1,2);assert(s.capacityStatus().blocked);assert.equal(s.output,null);
  s.setKeepAll(true);await s.load(file);assert(s.capacityStatus().blocked);
});

test('generic capacity can be unspecified, 8, 16 or custom without discarding colours',async()=>{
  const {session:s}=await fixture();
  for (const target of ['bambu','orca','prusa']) {
    s.setTarget(target);assert.equal(s.inputCapacity(),null);assert(!s.capacityStatus().blocked);
    for (const count of [8,16,6,64]) {s.setInputCapacity(count);assert(!s.capacityStatus().blocked);assert.equal(s.capacityStatus().needed,6);}
    s.setInputCapacity(4);assert(s.capacityStatus().blocked);
    s.setInputCapacity(null);assert(!s.capacityStatus().blocked);
  }
  s.setTarget('snapmaker');assert.equal(s.inputCapacity(),4);assert.equal(s.setInputCapacity(8),false);
});

test('invalid custom capacities block export even after keep-all acknowledgement',async()=>{
  const {session:s,calls}=await fixture();s.setTarget('orca');
  for (const invalid of [0,-1,1.5,65,NaN,Infinity,'']) {
    assert.equal(s.setInputCapacity(invalid),false);s.setKeepAll(true);
    assert.equal(await s.convert('orca',1),null);assert(s.capacityStatus().blocked);
  }
  assert.equal(calls.length,0);s.setInputCapacity(8);assert(!s.capacityStatus().blocked);
});

test('deliberate repaint merges six into four; source palette remains intact',async()=>{
  const {session:s}=await fixture();const original=s.state.colours.slice();
  s.setAssignmentMode('repaint');s.setSource(5,1);s.setSource(6,2);
  assert.equal(s.capacityStatus().needed,4);assert(!s.capacityStatus().blocked);
  assert.deepEqual(s.state.colours,original);
  s.setAssignmentMode('slots');assert(s.capacityStatus().blocked);
});

test('reserved support/infill entries still count after repainting',async()=>{
  const {session:s}=await fixture({usage:{kept:[1,2,3,4,5,6],unused:[],reservedThrough:6}});
  s.setAssignmentMode('repaint');s.setSource(5,1);s.setSource(6,1);
  assert.equal(s.capacityStatus().needed,6);assert(s.capacityStatus().blocked);
});

test('sparse U1 destinations must actually occupy slots 1–4, while unused gaps do not count',async()=>{
  const {session:s}=await fixture({usage:{kept:[1,2,6],unused:[3,4,5],reservedThrough:0}});
  assert.equal(s.capacityStatus().needed,3);assert.equal(s.capacityStatus().excess,0);assert(s.capacityStatus().blocked);
  s.setSource(6,4);assert(!s.capacityStatus().blocked);assert.equal(s.rule[6],4);
  s.setUnused(5,true);assert(s.capacityStatus().blocked);
});

test('capacity changes invalidate an in-flight export and its acknowledgement',async()=>{
  let release;const {session:s}=await fixture({convert:()=>new Promise(r=>release=r)});
  s.setKeepAll(true);const pending=s.convert('snapmaker',1);
  s.setTarget('bambu');s.setInputCapacity(8);release({bytes:new Uint8Array([1])});
  assert.equal(await pending,null);assert.equal(s.output,null);
  s.setTarget('snapmaker');assert(s.capacityStatus().blocked);
});
