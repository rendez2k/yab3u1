import test from 'node:test';
import assert from 'node:assert/strict';
import {planLayout} from '../../web/shared/layout.js';
import {pinCurrent,moveObject,groundPoint} from './move-tool.js';

const box=(x,y,w,h)=>({min:[x,y,0],max:[x+w,y+h,10]});
const footprints=[{objectId:'1',bounds:box(10,10,40,20)},{objectId:'2',bounds:box(100,60,30,30)}];
const state=(layout={},quantities={})=>({bounds:{min:[10,10,0],max:[130,90,10]},copies:1,quantities,
  layout:{arrangement:'auto',width:200,depth:200,spacing:5,copies:1,centre:[100,100],edgeMargin:4,footprints,quantities,...layout}});

test('a grouped plate is pinned where the group already sits, so nothing jumps on the first drag',()=>{
  const pinned=pinCurrent(state());
  // The 120 x 80 group is centred on a 200 x 200 bed: its corner lands at 40, 60.
  assert.deepEqual(pinned.rects.get('1:0'),{x:40,y:60,w:40,h:20});assert.deepEqual(pinned.rects.get('2:0'),{x:130,y:110,w:30,h:30});
  const plan=planLayout(state().bounds,{...state().layout,arrangement:'objects',manual:pinned.manual});
  assert.deepEqual(plan.placements.map(p=>p.rect),[{x:40,y:60,w:40,h:20},{x:130,y:110,w:30,h:30}]);
});
test('moving one object pins every object and shifts only the one dragged',()=>{
  const {patch,position,moved}=moveObject(state(),'1:0',[20,-30]);
  assert.equal(patch.arrangement,'objects');assert.deepEqual(patch.manual,{'1:0':[80,40],'2:0':[145,125]});assert.deepEqual(position,[80,40]);assert(Math.abs(moved-Math.hypot(20,30))<1e-9);
});
test('objects stay on the bed, clear of each other and of reserved areas',()=>{
  assert.deepEqual(moveObject(state(),'1:0',[-500,-500]).position,[24,14]);
  assert.deepEqual(moveObject(state(),'1:0',[500,-500]).position,[176,14]);
  assert.throws(()=>moveObject(state(),'1:0',[85,45]),/Too close to another object. Leave at least 5 mm/);
  assert.throws(()=>moveObject(state({tower:true,towerBox:{min:[0,0],max:[60,60]}}),'1:0',[0,-30]),/reserved for the prime tower/);
  assert.throws(()=>moveObject(state(),'9:0',[1,1]),/Select the object again/);
});
test('copies made by quantity are pinned by their own ordinal',()=>{
  const s=state({arrangement:'objects',quantities:{1:2,2:1}},{1:2,2:1}),pinned=pinCurrent(s);
  assert.deepEqual([...pinned.order.get('1')].sort(),['1:0','1:1']);assert.equal(pinned.rects.size,3);
  const {patch}=moveObject(s,'1:1',[0,0]);assert.equal(Object.keys(patch.manual).length,3);assert.deepEqual(patch.quantities,{1:2,2:1});
});
test('a pointer ray meets the plate where the camera looks',()=>{
  // Orthographic top-down view of a 200 mm square: clip x,y = world/100, depth = -z/100.
  const m=new Float32Array([.01,0,0,0, 0,.01,0,0, 0,0,-.01,0, 0,0,0,1]);
  const p=groundPoint(m,.5,-.25,0);assert(Math.abs(p[0]-50)<1e-3);assert(Math.abs(p[1]+25)<1e-3);
  assert.equal(groundPoint(new Float32Array(16),0,0,0),null);
});
