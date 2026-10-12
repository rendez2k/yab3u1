import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editCopies,fillObject} from './object-edits.js';
import {planLayout} from '../../web/shared/layout.js';
const box=(w,h,z=10)=>({min:[0,0,0],max:[w,h,z]});
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
