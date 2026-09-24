import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mixFdmHex,FDM_MODEL} from '../shared/fdmMix.js';
import {planBlends,mappingFromPlan} from '../shared/mix.js';
import {palette} from '../shared/targets.js';
import {readZip} from '../zip.js';
import {readProject,exportProject} from '../shared/project.js';

// Independent known answers published in the upstream model's test suite.
for(const [a,b,expected] of [
  ['#009bc3','#f6b921','#519E5F'],
  ['#009bc3','#c9378c','#4A5E94'],
  ['#c9378c','#f6b921','#CC6545'],
]) {
  assert.equal(mixFdmHex(a,b,50),expected);
  assert.equal(mixFdmHex(b,a,50),expected);
  assert.equal(mixFdmHex(a,b,25),mixFdmHex(b,a,75));
}
assert.equal(mixFdmHex('#000000','#FFFFFF',50),'#3C3C3C');
assert.equal(mixFdmHex('#FF0000','#0080C0',0),'#FF0000');
assert.equal(mixFdmHex('#FF0000','#0080C0',100),'#0080C0');
assert.equal(mixFdmHex('#123456','#123456',50),'#123456');
assert.equal(mixFdmHex('bad','#FFFFFF',50),'');
const reels=['#009BC3','#F6B921','#FFFFFF','#000000'].map(color=>({color,type:'PLA'}));
const sources={1:'#009BC3',2:'#F6B921',3:'#FFFFFF',4:'#000000',5:'#519E5F'};
const plan=planBlends(sources,reels);
assert.equal(plan.recipes.length,1);
assert.equal(plan.recipes[0].model,FDM_MODEL);
assert.equal(plan.recipes[0].color,'#519E5F');
assert.equal(palette(reels.map(r=>r.color),reels.map(r=>r.type),plan.recipes).virtual[0].color,'#519E5F');
// Export and read back real native mixture settings, retaining the new predictor
// through the UI's recipe payload shape. No native slicing is implied.
const entries=await readZip(new Uint8Array(readFileSync('web/tests/single-object.3mf')));
const project=readProject(entries);
for(const target of ['snapmaker','bambu','prusa']) {
  const output=exportProject(project,1,null,{target,reels,mapping:mappingFromPlan(plan),
    recipes:plan.recipes.map(({a,b,percent,model})=>({a,b,percent,model}))});
  const text=name=>new TextDecoder().decode(output.entries.get(name));
  if(target==='snapmaker') {
    const cfg=JSON.parse(text('Metadata/project_settings.config'));
    assert(cfg.mixed_filament_definitions.includes('1,2,1,1,50,'));
    assert.equal(cfg.filament_colour.length,4);
  } else if(target==='bambu') {
    const cfg=JSON.parse(text('Metadata/project_settings.config'));
    assert(cfg.filament_colour.some(c=>c.startsWith('#519E5F')));
    assert(cfg.filament_mixed_sublayer_ratios.includes('0.5,0.5'));
  } else assert(text('Metadata/Prusa_Slicer_full_spectrum.json').includes('#519E5F'));
}
console.log('FDM model: upstream known answers, symmetry, neutral/endpoint checks and all three native export schemas passed.');
