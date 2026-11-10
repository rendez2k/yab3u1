import test from 'node:test';
import assert from 'node:assert/strict';
import {planBlends,setBlendStrength,blendStrength,BLEND_STRENGTHS,RATIOS} from '../shared/mix.js';
import {mixFdmHex} from '../shared/fdmMix.js';
import {recommendWorkflow} from '../shared/recommend.js';
import {distance} from '../shared/colour.js';

const reels=['#00AEEF','#EC008C','#FFF200','#FFFFFF'].map(color=>({color,type:'PLA'}));
// Shades a 25/50/75 planner can only approximate: off-grid mixes of the loaded reels.
const targets={1:mixFdmHex(reels[0].color,reels[2].color,33),2:mixFdmHex(reels[1].color,reels[2].color,17),3:mixFdmHex(reels[0].color,reels[3].color,60),
  4:mixFdmHex(reels[1].color,reels[3].color,83),5:mixFdmHex(reels[0].color,reels[1].color,40),6:mixFdmHex(reels[2].color,reels[3].color,67),7:mixFdmHex(reels[0].color,reels[2].color,67),8:mixFdmHex(reels[1].color,reels[3].color,33)};
const total=plan=>plan.rows.reduce((sum,row)=>sum+distance(row.original,row.choice==='mixture'?row.mixture.color:row.solid.color),0);

test('the default planner is unchanged, and Standard is the reference ratio set',()=>{
  assert.equal(blendStrength().name,'standard');assert.deepEqual(blendStrength().ratios,RATIOS);assert.equal(blendStrength().recipes,6);
  assert.throws(()=>setBlendStrength('maximum'),/Standard, Strong or Finest/);
});
test('stronger detail reaches off-grid shades that Standard can only approximate',()=>{
  setBlendStrength('standard');const standard=planBlends(targets,reels,true);
  setBlendStrength('strong');const strong=planBlends(targets,reels,true);
  setBlendStrength('finest');const finest=planBlends(targets,reels,true);
  setBlendStrength('standard');
  assert(standard.recipes.length<=6);assert(strong.recipes.length<=10);assert(finest.recipes.length<=12);
  assert(strong.recipes.length>standard.recipes.length,'more blends are used');
  // Total colour error falls sharply with either finer level.
  assert(total(strong)<total(standard)*0.5,`${total(strong)} vs ${total(standard)}`);
  assert(total(finest)<total(standard)*0.5);
  assert(strong.recipes.some(r=>!RATIOS.includes(r.percent)),'uses a ratio outside 25/50/75');
  for(const r of [...strong.recipes,...finest.recipes])assert(Number.isInteger(r.percent)&&r.percent>=1&&r.percent<=99);
  for(const r of strong.recipes)assert(BLEND_STRENGTHS.strong.ratios.includes(r.percent));
});
test('the palette search honours the chosen detail',()=>{
  const input={mode:'loaded',sources:targets,loaded:reels,capacity:4,visibleLimit:16,blends:true};
  setBlendStrength('standard');const standard=recommendWorkflow(input);
  setBlendStrength('strong');const strong=recommendWorkflow(input);
  setBlendStrength('standard');
  const blends=result=>new Set((result.outcome?.rows||[]).filter(r=>r.recipe).map(r=>`${r.recipe.a},${r.recipe.b},${r.recipe.percent}`)).size;
  assert(blends(strong)>=blends(standard));assert(blends(strong)<=10);
});

import {setHueFidelity,hueFidelity,huePenalty} from '../shared/mix.js';
test('keeping hues picks a cyan and yellow green for a light green instead of a paler yellow',()=>{
  const cmyw=['#00FFFF','#FF00FF','#FFFF00','#FFFFFF'].map(color=>({color,type:'PLA'}));
  const model={1:'#B5D88A',2:'#A8D8E8',3:'#D2B0A0',4:'#E0403A'};
  assert.equal(hueFidelity(),false);assert.equal(huePenalty('#B5D88A','#F9FBA6'),0);
  setBlendStrength('strong');
  const plain=planBlends(model,cmyw,true);
  setHueFidelity(true);const kept=planBlends(model,cmyw,true);
  const pale=huePenalty('#B5D88A','#F9FBA6'),green=huePenalty('#B5D88A','#9DFA00'),skin=huePenalty('#D2B0A0','#F7CBDE');
  setHueFidelity(false);setBlendStrength('standard');
  const mix=(plan,i)=>[plan.rows[i].mixture.a,plan.rows[i].mixture.b].join('/');
  // Without it the green is matched by yellow and white; with it, by cyan and yellow.
  assert.equal(mix(plain,0),'3/4');assert.equal(mix(kept,0),'1/3');
  // Pastels and skin tones are close to neutral and are not pushed about by hue.
  assert.equal(mix(kept,1),mix(plain,1));assert.equal(kept.rows[1].mixture.percent,plain.rows[1].mixture.percent);
  assert(pale>green+4);assert(skin<pale/2);
  // Red is still magenta and yellow either way.
  assert.equal(mix(kept,3),'2/3');
  // The reported error is the plain distance, not the ranking score.
  assert(kept.rows[0].mixture.error>plain.rows[0].mixture.error);
});
