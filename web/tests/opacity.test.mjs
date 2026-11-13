import test from 'node:test';
import assert from 'node:assert/strict';
import {opacity,effectiveShares,candidateRecipes,planBlends,RATIOS,setBakedColours,setBlendStrength,setHueFidelity} from '../shared/mix.js';
import {calibratedPredictor} from '../shared/blendCalibration.js';

const reset=()=>{setBakedColours(false);setBlendStrength('standard');setHueFidelity(false);};
const near=(a,b,t=1e-9)=>Math.abs(a-b)<=t;

test('opacity rises as transmission distance falls, and is unknown without one',()=>{
  assert.equal(opacity(undefined),null);assert.equal(opacity(''),null);assert.equal(opacity(0),null);assert.equal(opacity(-2),null);assert.equal(opacity('abc'),null);
  assert.ok(opacity(0.6)>opacity(0.9)&&opacity(0.9)>opacity(3.5)&&opacity(3.5)>opacity(8));
  assert.ok(opacity(0.3)>0.98&&opacity(50)<0.03);
});

test('shares are left alone unless every reel of the blend has a transmission distance',()=>{
  assert.deepEqual(effectiveShares([83,17],[8,undefined]),[0.83,0.17]);
  assert.deepEqual(effectiveShares([1,1,2],[null,1,1]),[0.25,0.25,0.5]);
  // Equal opacity changes nothing.
  const same=effectiveShares([83,17],[2,2]);assert.ok(near(same[0],0.83)&&near(same[1],0.17));
  // A little of an opaque reel in a translucent one counts for more than its layers.
  const seen=effectiveShares([83,17],[8,0.9]);
  assert.ok(seen[1]>0.4,`17% of an opaque reel is seen as ${seen[1]}`);assert.ok(near(seen[0]+seen[1],1));
});

test('the planner predicts a different colour for the same recipe once opacity is known',()=>{
  reset();
  const plain=['#F7E400','#D9308A'].map(color=>({color,type:'PLA'}));
  const known=[{color:'#F7E400',type:'PLA',td:8},{color:'#D9308A',type:'PLA',td:1}];
  // The interactive planner's predictor; the reference pair planner does not use opacity.
  const pick=reels=>candidateRecipes(reels,RATIOS,calibratedPredictor(reels,null).predict).find(r=>r.percent===25);
  assert.equal(pick(plain).percent,25);assert.equal(pick(known).percent,25,'the recipe keeps its layer share');
  assert.notEqual(pick(known).color,pick(plain).color);
  // Only one TD given: nothing changes.
  assert.equal(pick([known[0],plain[1]]).color,pick(plain).color);
  // Three-reel blends are adjusted the same way.
  setBakedColours(true);setBlendStrength('strong');
  const three=[...known,{color:'#FFFFFF',type:'PLA',td:4}],bare=three.map(({td,...r})=>r);
  const triple=reels=>candidateRecipes(reels,RATIOS,calibratedPredictor(reels,null).predict).find(r=>r.c&&r.percent===25&&r.percentC===50);
  assert.notEqual(triple(three).color,triple(bare).color);
  reset();
});

test('a plan made without any transmission distance is exactly as before',()=>{
  reset();setBlendStrength('strong');setHueFidelity(true);
  const reels=['#0086D6','#D9308A','#F7E400','#FFFFFF'].map(color=>({color,type:'PLA'}));
  const sources={1:'#C68642',2:'#7BC043',3:'#5B2C83'};
  const a=planBlends(sources,reels,true),b=planBlends(sources,reels.map(r=>({...r,td:undefined})),true);
  assert.deepEqual(a.recipes,b.recipes);
  reset();
});
