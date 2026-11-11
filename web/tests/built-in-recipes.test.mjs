import test from 'node:test';
import assert from 'node:assert/strict';
import {spreadSequence,builtInCandidates,planBuiltIn,alignPhases,MAX_SEQUENCE,DENOMINATORS} from '../shared/builtInRecipes.js';
import {mixManyHex,mixFdmHex,FDM_MODEL} from '../shared/fdmMix.js';
import {distance} from '../shared/colour.js';
import {MIN_IMPROVEMENT} from '../shared/mix.js';
const CMYW=[{color:'#00AEEF',type:'PLA'},{color:'#EC008C',type:'PLA'},{color:'#FFF200',type:'PLA'},{color:'#FFFFFF',type:'PLA'}];
const maxRun=s=>{let best=1,run=1;for(let i=1;i<s.length*2;i++){run=s[i%s.length]===s[(i-1)%s.length]?run+1:1;best=Math.max(best,Math.min(run,s.length));}return best;};

test('sequences hold the exact shares and spread each reel evenly',()=>{
  assert.deepEqual(spreadSequence([1,0,1,0]),[1,3]);
  const s=spreadSequence([2,0,1,1]);
  assert.equal(s.length,4);assert.deepEqual([1,2,3,4].map(r=>s.filter(x=>x===r).length),[2,0,1,1]);
  assert.equal(maxRun(spreadSequence([5,0,5,0])),1);
  assert.ok(maxRun(spreadSequence([3,0,1,0]))<=3);
});
test('two-reel estimate matches the existing predictor; one reel is itself',()=>{
  assert.equal(mixManyHex(['#00AEEF','#FFF200'],[1,1]),mixFdmHex('#00AEEF','#FFF200',50));
  assert.equal(mixManyHex(['#00AEEF','#FFF200'],[1,0]),'#00AEEF');
});
test("many-reel estimate folds in reel order at each reel's share of the running total",()=>{
  const first=mixFdmHex('#00AEEF','#EC008C',50);
  assert.equal(mixManyHex(['#00AEEF','#EC008C','#FFF200'],[1,1,2]),mixFdmHex(first,'#FFF200',50));
  assert.equal(mixManyHex(['#00AEEF','#EC008C','#FFFFFF'],[3,0,1]),mixFdmHex('#00AEEF','#FFFFFF',25));
  assert.equal(mixManyHex(['#00AEEF','#EC008C'],[0,0]),'');
  assert.equal(mixManyHex(['#00AEEF','nonsense'],[1,1]),'');
});
test('candidates include three- and four-reel recipes and never exceed 40 layers',()=>{
  const all=builtInCandidates(CMYW);
  assert.ok(all.some(c=>c.counts.filter(Boolean).length===3));
  assert.ok(all.some(c=>c.counts.filter(Boolean).length===4));
  assert.ok(all.every(c=>c.sequence.length<=MAX_SEQUENCE));
  assert.equal(new Set(all.map(c=>c.sequence.join())).size,all.length);
});
test('every candidate is a reduced ratio with a matching sequence and estimate',()=>{
  const all=builtInCandidates(CMYW);
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  for(const c of all){
    const total=c.counts.reduce((a,b)=>a+b,0);
    assert.equal(c.sequence.length,total);
    assert.equal(c.counts.reduce(gcd,0),1);
    assert.ok(total===1||DENOMINATORS.includes(total));
    assert.deepEqual([1,2,3,4].map(r=>c.sequence.filter(x=>x===r).length),c.counts);
    assert.equal(c.color,mixManyHex(CMYW.map(r=>r.color),c.counts));
  }
  for(let i=0;i<4;i++)assert.ok(all.some(c=>c.counts.join()===CMYW.map((_,j)=>j===i?1:0).join()),`single reel ${i+1}`);
});
test('a support reel and a foreign material never enter a recipe',()=>{
  const reels=[...CMYW.slice(0,3),{color:'#FFFFFF',type:'PETG',role:'support-interface'}];
  assert.ok(builtInCandidates(reels).every(c=>c.counts[3]===0));
  const foreign=[...CMYW.slice(0,3),{color:'#FFFFFF',type:'petg'}];
  const all=builtInCandidates(foreign);
  assert.ok(all.length>0&&all.every(c=>c.counts[3]===0));
  assert.ok(all.some(c=>c.counts.filter(Boolean).length===3));
});
test('with no usable model reel there are no candidates and planning refuses',()=>{
  const lone=[{color:'#FFFFFF',type:'PLA',role:'support-interface'}];
  assert.deepEqual(builtInCandidates(lone),[]);
  assert.throws(()=>planBuiltIn({1:'#FFFFFF'},lone),/model filament/);
});
test('planning gives every source a recipe, marks it estimated and reuses equal recipes',()=>{
  const plan=planBuiltIn({1:'#00AEEF',2:'#7FD08A',3:'#7FD08A'},CMYW);
  assert.equal(plan.rows.length,3);
  assert.ok(plan.rows.every(r=>r.estimated===true&&r.sequence.length>=1));
  assert.deepEqual(plan.rows[0].sequence,[1]);
  assert.equal(plan.rows[1].sequence.join(),plan.rows[2].sequence.join());
  assert.equal(plan.recipes.length,2);
});
test('each row names its recipe, and recipes are numbered from 1 and carry the model',()=>{
  const plan=planBuiltIn({1:'#00AEEF',2:'#7FD08A',3:'#7FD08A'},CMYW);
  assert.deepEqual(plan.recipes.map(r=>r.id),[1,2]);
  for(const row of plan.rows){
    const recipe=plan.recipes.find(r=>r.id===row.recipe);
    assert.ok(recipe);
    assert.deepEqual(recipe.sequence,row.sequence);
    assert.deepEqual(recipe.counts,row.counts);
    assert.equal(recipe.color,row.shade);
    assert.equal(recipe.model,FDM_MODEL);
    assert.equal(row.original,row.source===1?'#00AEEF':'#7FD08A');
  }
  assert.equal(plan.rows[0].error,0);
  assert.ok(plan.rows[1].error>0);
});
test('the shortest recipe within MIN_IMPROVEMENT of the best is chosen',()=>{
  const original='#7FD08A';
  const row=planBuiltIn({1:original},CMYW).rows[0];
  const all=builtInCandidates(CMYW).map(c=>({...c,error:distance(original,c.color)}));
  const best=Math.min(...all.map(c=>c.error));
  const near=all.filter(c=>c.error<=best+MIN_IMPROVEMENT);
  assert.equal(row.sequence.length,Math.min(...near.map(c=>c.sequence.length)));
  assert.ok(distance(original,row.shade)<=best+MIN_IMPROVEMENT);
});
test('planning rejects a source that is not a colour rather than guessing',()=>{
  assert.throws(()=>planBuiltIn({1:'nonsense'},CMYW),/not a valid colour/);
});
test('phase alignment keeps shares and reduces reels per layer',()=>{
  const out=alignPhases([{id:1,sequence:[1,3]},{id:2,sequence:[3,1]}]);
  assert.deepEqual(out[0].sequence,out[1].sequence);
  assert.deepEqual([...out[1].sequence].sort(),[1,3]);
});
test('phase alignment keeps ids and other fields, leaves the input alone, and only rotates',()=>{
  const input=[{id:7,sequence:[1,1,2],counts:[2,1],color:'#123456',model:'m'},{id:9,sequence:[2,1,1],counts:[2,1],color:'#654321',model:'m'}];
  const copy=JSON.parse(JSON.stringify(input));
  const out=alignPhases(input);
  assert.deepEqual(input,copy);
  assert.deepEqual(out.map(r=>r.id),[7,9]);
  for(const [i,r] of out.entries()){
    assert.deepEqual({...r,sequence:null},{...copy[i],sequence:null});
    const doubled=[...copy[i].sequence,...copy[i].sequence].join();
    assert.ok(doubled.includes(r.sequence.join()),'a rotation of the original');
  }
  assert.deepEqual(out[0].sequence,out[1].sequence);
});
test('phase alignment places the heaviest recipe first and rotates the others to it',()=>{
  const recipes=[{id:1,sequence:[1,3]},{id:2,sequence:[3,1]}];
  const heavy=alignPhases(recipes,{2:5});
  assert.deepEqual(heavy[0].sequence,[3,1]);
  assert.deepEqual(heavy[1].sequence,[3,1]);
  const tied=alignPhases(recipes);
  assert.deepEqual(tied[0].sequence,[1,3]);
  assert.deepEqual(tied[1].sequence,[1,3]);
});
test('phase alignment lowers the distinct reels per layer over a mixed period',()=>{
  const recipes=[{id:1,sequence:[1,1,2]},{id:2,sequence:[3,3,4,4]},{id:3,sequence:[2,1,1]}];
  const cost=rs=>{let t=0;for(let i=0;i<12;i++)t+=new Set(rs.map(r=>r.sequence[i%r.sequence.length])).size;return t;};
  const out=alignPhases(recipes);
  assert.ok(cost(out)<cost(recipes));
  assert.deepEqual(out[2].sequence,out[0].sequence);
});
test('planning 24 colours from CMY and white stays fast',()=>{
  const sources={};
  for(let i=0;i<24;i++)sources[i+1]='#'+[(i*47+30)%256,(i*91+60)%256,(i*131+10)%256].map(v=>v.toString(16).padStart(2,'0')).join('');
  const start=Date.now();
  const plan=planBuiltIn(sources,CMYW);
  const ms=Date.now()-start;
  assert.equal(plan.rows.length,24);
  assert.ok(ms<8000,`took ${ms} ms`);
});
