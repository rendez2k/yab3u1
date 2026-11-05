import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editCopies,fillObject,arrangeObjects} from './object-edits.js';
import {planLayout} from '../../web/shared/layout.js';
const box=(w,h,z=10)=>({min:[0,0,0],max:[w,h,z]});

test('auto arrange fits seven 100mm Grinch-sized copies around the U1 tower without changing quantities',()=>{
  const objects=[{objectId:'grinch',bounds:box(56.6,46.3,100)}];
  const state={objects,copies:1,quantities:{grinch:7},bounds:box(500,400,100),layout:{width:270,depth:270,centre:[135,135],spacing:5,padding:2,footprints:objects,tower:true,towerBox:{min:[0,200],max:[60,270]},edgeMargin:4,maxHeight:270}};
  const before=structuredClone(state),{patch,plan}=arrangeObjects(state,planLayout);
  assert.equal(plan.placements.length,7);assert.deepEqual(patch.quantities,{grinch:7});assert.deepEqual(state,before);
  const rectangles=plan.placements.map(p=>({x:p.offset[0],y:p.offset[1],w:56.6,h:46.3}));
  for(const a of rectangles){assert(a.x>=6&&a.y>=6&&a.x+a.w<=264&&a.y+a.h<=264);assert(a.x>=62||a.y+a.h<=198);}
  for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){const a=rectangles[i],b=rectangles[j];assert(a.x+a.w+9<=b.x+1e-6||b.x+b.w+9<=a.x+1e-6||a.y+a.h+9<=b.y+1e-6||b.y+b.h+9<=a.y+1e-6);}
});
test('auto arrange rejects an oversized quantity and keeps the source state intact',()=>{
  const s=fixture();s.quantities={pumpkin:64,stem:1};const before=structuredClone(s);
  assert.throws(()=>arrangeObjects(s,planLayout),/Nothing has been removed/);assert.deepEqual(s,before);
});
function fixture(){const objects=[{objectId:'pumpkin',bounds:box(20,20)},{objectId:'stem',bounds:box(10,10)}];return {objects,copies:1,quantities:{},bounds:box(30,30),layout:{width:65,depth:65,centre:[32.5,32.5],spacing:3,footprints:objects,tower:true,towerBox:{min:[0,40],max:[20,65]},edgeMargin:2,maxHeight:100}};}
test('adding multiple copies flattens prior sets without changing sibling quantities',()=>{
  const state={...fixture(),copies:3,quantities:{pumpkin:2,stem:0}};
  assert.deepEqual(editCopies(state,'pumpkin',4),{copies:1,arrangement:'objects',quantities:{pumpkin:10,stem:0}});
  assert.deepEqual(state.quantities,{pumpkin:2,stem:0});
  assert.equal(editCopies({...state,quantities:{pumpkin:2,stem:1}},'stem',2).quantities.pumpkin,6);
});
test('invalid quantities and unknown objects fail without mutations',()=>{
  const state=fixture();for(const [id,n] of [['missing',1],['stem',.5],['stem',64],['stem',-2]])assert.throws(()=>editCopies(state,id,n));
  assert.deepEqual(state.quantities,{});
});
test('fill keeps sibling quantities, tower clearance and the fit found by the real packer',async()=>{
  const state={...fixture(),copies:2};
  const result=await fillObject(state,'stem',planLayout);
  assert.ok(result.added>0);assert.equal(result.patch.quantities.pumpkin,2);
  assert.equal(result.patch.quantities.stem,2+result.added);
  const plan=planLayout(state.bounds,{...state.layout,...result.patch,capacityLimit:1});
  assert.equal(plan.blocked,false);
  for(let n=result.patch.quantities.stem+1;n<=64;n++)assert.equal(planLayout(state.bounds,{...state.layout,...result.patch,quantities:{...result.patch.quantities,stem:n},capacityLimit:1}).blocked,true);
  assert.deepEqual(state.quantities,{});
});
test('no fit never drops existing objects and oversized height remains blocked',async()=>{
  const state=fixture();state.layout.maxHeight=2;
  assert.deepEqual(await fillObject(state,'stem',planLayout),{patch:null,added:0,limit:false});
  assert.deepEqual(state.quantities,{});
});
test('fill can be cancelled while yielding before a plate change is applied',async()=>{
  let checks=0;await assert.rejects(fillObject(fixture(),'stem',planLayout,async()=>{if(++checks===2)throw Error('Plate changed');}),/Plate changed/);
});
