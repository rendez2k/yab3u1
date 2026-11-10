import test from 'node:test';
import assert from 'node:assert/strict';
import {planLayout,layoutSignature} from '../shared/layout.js';

const box=(x,y,w,h)=>({min:[x,y,0],max:[x+w,y+h,10]});
const footprints=[{objectId:'1',bounds:box(0,0,40,20)},{objectId:'2',bounds:box(100,50,30,30)}];
const bounds={min:[0,0,0],max:[130,80,10]};
const options={arrangement:'objects',width:200,depth:200,spacing:5,copies:1,centre:[100,100],footprints,quantities:{1:2,2:1}};
const rects=plan=>plan.placements.map(p=>[p.objectId,p.ordinal,p.rect.x,p.rect.y,p.rect.w,p.rect.h]);
const apart=(a,b,gap)=>a.x+a.w+gap<=b.x+1e-6||b.x+b.w+gap<=a.x+1e-6||a.y+a.h+gap<=b.y+1e-6||b.y+b.h+gap<=a.y+1e-6;

test('without hand placement a plan is exactly what it was',()=>{
  const plain=planLayout(bounds,options),empty=planLayout(bounds,{...options,manual:{}});
  assert.equal(JSON.stringify(plain.placements),JSON.stringify(empty.placements));
  assert.equal(layoutSignature(plain),layoutSignature(empty));
  // The editing aids never appear in serialised plans.
  assert.deepEqual(Object.keys(plain.placements[0]),['objectId','copy','offset']);
  assert.equal(typeof plain.placements[0].ordinal,'number');
});
test('a hand-placed object sits where it was put and the rest pack around it',()=>{
  const plan=planLayout(bounds,{...options,manual:{'2:0':[100,100]}});
  assert.equal(plan.blocked,false);assert.equal(plan.placements.length,3);
  const placed=plan.placements.find(p=>p.objectId==='2');
  assert.deepEqual(placed.rect,{x:85,y:85,w:30,h:30});
  // World offset moves the footprint's own corner (100,50) to bed corner 85,85 with the bed centred on 100,100.
  assert.deepEqual(placed.offset.slice(0,2),[-15,35]);
  for(const other of plan.placements.filter(p=>p!==placed))assert(apart(other.rect,placed.rect,5),JSON.stringify(rects(plan)));
});
test('each copy keeps its own position by ordinal, and positions are kept on the bed',()=>{
  const plan=planLayout(bounds,{...options,manual:{'1:1':[150,30],'1:0':[-500,9999]}});
  const copies=plan.placements.filter(p=>p.objectId==='1');
  assert.deepEqual(copies.map(p=>p.ordinal),[0,1]);
  assert.deepEqual(copies[1].rect,{x:130,y:20,w:40,h:20});
  assert.deepEqual(copies[0].rect,{x:0,y:180,w:40,h:20});
});
test('positions for copies that no longer exist are ignored',()=>{
  const plan=planLayout(bounds,{...options,quantities:{1:1,2:1},manual:{'1:5':[50,50],'9:0':[10,10]}});
  assert.equal(plan.placements.length,2);assert.equal(plan.blocked,false);
});
