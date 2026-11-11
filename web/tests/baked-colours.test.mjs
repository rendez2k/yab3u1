import test from 'node:test';
import assert from 'node:assert/strict';
import {planBlends,setBakedColours,setBlendStrength,setHueFidelity,layerShares,candidateRecipes} from '../shared/mix.js';
import {definitions,layerPattern,patternRow,snapmakerConfig} from '../shared/targets.js';
import {validateRecipe} from '../shared/blendRecipes.js';

const reels=['#00AEEF','#EC008C','#FFF200','#FFFFFF'].map(color=>({color,type:'PLA'}));
const reset=()=>{setBakedColours(false);setBlendStrength('standard');setHueFidelity(false);};

test('baked colours are off unless chosen, leaving the pair planner unchanged',()=>{
  reset();
  assert.ok(candidateRecipes(reels).every(r=>!r.c));
  const plan=planBlends({1:'#F4C2A1',2:'#8B4513'},reels,true);
  assert.ok(plan.recipes.every(r=>!r.c));
});

test('three-reel blends reach a skin tone that pairs of cyan, magenta, yellow and white cannot',()=>{
  reset();setBlendStrength('strong');setHueFidelity(true);
  const sources={1:'#F4C2A1',2:'#8B4513',3:'#7BC043'};
  const pairs=planBlends(sources,reels,true);
  setBakedColours(true);
  const baked=planBlends(sources,reels,true);
  const error=(plan,i)=>plan.rows[i].mixture.error;
  assert.ok(error(baked,0)<error(pairs,0)-5,'skin tone is much closer');
  // Repeats are capped at four layers, so a brown that needs finer shares stays as it was, never worse.
  assert.ok(error(baked,1)<=error(pairs,1),'brown is no worse');
  assert.equal(baked.rows[0].mixture.c!==undefined,true);
  // A colour a pair already reaches keeps the simpler pair.
  assert.equal(baked.rows[2].mixture.c,undefined);
  const recipe=baked.recipes.find(r=>r.c);
  assert.equal(recipe.percent+recipe.percentC<100,true);
  assert.doesNotThrow(()=>validateRecipe(recipe,4,'snapmaker'));
  reset();
});

test('shares are whole layers of a short repeat',()=>{
  assert.deepEqual(layerShares(3).map(s=>s.counts),[[1,1,1]]);
  for(const share of layerShares(6)){
    const n=share.counts.reduce((a,b)=>a+b,0);
    assert.ok(n<=6);assert.equal(share.percent,Math.round(100*share.counts[1]/n));
  }
});

test('a layer pattern matches the shares and spreads each reel through the repeat',()=>{
  const pattern=layerPattern([{slot:2,percent:17},{slot:3,percent:17},{slot:4,percent:66}]);
  assert.equal(pattern.length,6);
  assert.equal(pattern.filter(s=>s===4).length,4);
  const twice=[...pattern,...pattern].join('');
  assert.ok(!twice.includes('444'),'no reel prints three layers in a row');
  assert.deepEqual(layerPattern([{slot:1,percent:34},{slot:2,percent:33},{slot:3,percent:33}]).slice().sort(),[1,2,3]);
  assert.equal(layerPattern([{slot:1,percent:50},{slot:2,percent:25},{slot:3,percent:25}]).join(''),'1213');
});

test('a three-reel blend is written as an explicit layer-cycle row',()=>{
  const row=patternRow({a:2,b:3,percent:17,c:4,percentC:66},7);
  const tokens=row.split(',');
  assert.deepEqual(tokens.slice(0,4),['1','2','1','1']);
  assert.ok(tokens.includes('g234')&&tokens.includes('m0')&&tokens.includes('u7')&&tokens.includes('d0'));
  assert.match(tokens.at(-1),/^[234]{6}$/);
  const rows=definitions(4,[{a:1,b:2,percent:50},{a:1,b:3,percent:33,c:4,percentC:17}]);
  assert.equal(rows[0],'1,2,1,1,50,0,g,w,m2,z0,xa0,xb0,d0,o0,u1');
  assert.match(rows[1],/,u2,cm1,[134]+$/);
  // The remaining rows are the disabled automatic pairs, as before.
  assert.equal(rows.length,2+6);
  const cfg=snapmakerConfig({},reels.map(r=>r.color),reels.map(r=>r.type),[{a:1,b:3,percent:33,c:4,percentC:17}]);
  assert.equal(cfg.mixed_filament_definitions.split(';').length,7);
});

test('keeping hue does not trade a clear colour for grey',()=>{
  reset();setBlendStrength('strong');setHueFidelity(true);setBakedColours(true);
  const plan=planBlends({1:'#6B7044'},reels,true),mixed=plan.rows[0].mixture.color;
  const [r,g,b]=[1,3,5].map(i=>parseInt(mixed.slice(i,i+2),16));
  // An olive stays a muted green: green clearly leads and the three channels are not level.
  assert.ok(g-b>=30&&Math.max(r,g,b)-Math.min(r,g,b)>=40,`${mixed} keeps its green`);
  reset();
});
