import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCalibration,calibratedPredictor,matchesCalibration} from '../shared/blendCalibration.js';
import {planBlends,mappingFromPlan,swapPaletteSlots} from '../shared/mix.js';
import {mixFdmHex} from '../shared/fdmMix.js';
import {recommendWorkflow} from '../shared/recommend.js';
import {palette} from '../shared/targets.js';
import {calibrationSwatches} from '../shared/calibrationSwatches.js';
import {readZip} from '../zip.js';
import {readProject,exportProject} from '../shared/project.js';
import {decode,walkStates} from '../shared/paint.js';

const reels=['#FF0000','#0080C0','#FFFFFF','#000000'].map((color,i)=>({color,type:'PLA',name:`Brand reel ${i+1}`}));
const profile=validateCalibration({version:1,name:'Measured test',setup:'U1, PLA, same temperature and lighting',context:'test',reels,
  samples:[{a:1,b:2,percent:25,color:'#A03050'}]});
assert(matchesCalibration(profile,reels));
const prediction=calibratedPredictor(reels,profile);
assert.equal(prediction.predict(reels[0].color,reels[1].color,25,1,2),'#A03050');
assert.equal(prediction.predict(reels[0].color,reels[1].color,50,1,2),mixFdmHex(reels[0].color,reels[1].color,50));
const reversed=[reels[1],reels[0],...reels.slice(2)];
assert.equal(calibratedPredictor(reversed,profile).predict(reversed[0].color,reversed[1].color,75,1,2),'#A03050');
const different=reels.map((r,i)=>i===2?{...r,color:'#EEEEEE'}:r);
assert(!matchesCalibration(profile,different));
assert.equal(calibratedPredictor(different,profile).measured(1,2,25),null);
assert(!matchesCalibration(profile,reels.map(r=>({...r,type:'PETG'}))));
for(const change of [{version:2},{reels:[]},{context:''},{samples:[{a:0,b:2,percent:25,color:'#A03050'}]},
  {samples:[{a:1,b:2,percent:30,color:'#A03050'}]},{samples:[{a:1,b:2,percent:25,color:'red'}]},
  {samples:[profile.samples[0],profile.samples[0]]}]) assert.throws(()=>validateCalibration({...profile,...change}));

const sources={1:reels[0].color,2:reels[1].color,3:reels[2].color,4:reels[3].color,5:'#A03050'};
const plan=planBlends(sources,reels,false,null,profile);
const measured=plan.recipes.find(r=>r.measuredColor);
assert(measured,'matching measured blend must be selected');
assert.equal(measured.color,'#A03050');
assert.equal(palette(reels.map(r=>r.color),reels.map(r=>r.type),plan.recipes).virtual[0].color,'#A03050');
const result=recommendWorkflow({mode:'loaded',sources,loaded:reels,calibration:profile});
assert(result.found);
assert.equal(result.outcome.rows.find(r=>r.source===5).result,'#A03050');
const swapped=swapPaletteSlots(result,0,1);
const reordered=planBlends(sources,swapped.reels,false,swapped.slotOrder,profile);
assert.equal(reordered.recipes[0].color,'#A03050');
assert.equal(reordered.recipes[0].a,2);
assert.equal(reordered.recipes[0].b,1);

const project=readProject(await readZip(new Uint8Array(readFileSync('web/tests/single-object.3mf'))));
for(const target of ['snapmaker','bambu','prusa']) {
  const out=exportProject(project,1,null,{target,reels,recipes:plan.recipes,mapping:mappingFromPlan(plan)});
  assert.equal(out.table.virtual[0].color,'#A03050',`${target} must retain the measured preview colour`);
}
for(const [a,b] of [[1,2],[2,1]]) {
  const zip=await readZip(await calibrationSwatches({reels,a,b}));
  const text=name=>new TextDecoder().decode(zip.get(name));
  const cfg=JSON.parse(text('Metadata/project_settings.config'));
  assert.equal(cfg.filament_colour.length,4);
  for(const percent of [25,50,75]) assert(cfg.mixed_filament_definitions.includes(`${a},${b},1,1,${percent},`));
  assert.equal(Number(cfg.layer_height),.1);
  assert.equal((text('3D/3dmodel.model').match(/<item /g)||[]).length,5,'all five tiles placed');
  assert(text('Metadata/YAB3D_calibration.txt').includes('Measure the flat upper faces'));
  assert.equal((text('3D/Objects/object_inline.model').match(/<triangle /g)||[]).length,60,'five complete cuboids');
  const paints=[...text('3D/Objects/object_inline.model').matchAll(/paint_color="([^"]+)"/g)].flatMap(m=>walkStates(decode(m[1])));
  const totals=Object.fromEntries([...new Set(paints)].map(id=>[id,paints.filter(p=>p===id).length]));
  assert.deepEqual(totals,{[a]:12,5:12,6:12,7:12,[b]:12},'every tile uses the intended physical reel or native mixture');
}
console.log('Calibration: measured lookup, fallback, material isolation, reorder, validation, ranking, export and native five-tile projects passed.');

// Shares between two readings are interpolated; nothing is carried past the readings.
{
  const full=validateCalibration({version:2,surface:'wall',name:'Strip',setup:'U1',context:'test',reels,
    samples:[{a:1,b:2,percent:25,color:'#A03050'},{a:1,b:2,percent:75,color:'#304090'}],pure:['#E01010',null,null,null]});
  const p=calibratedPredictor(reels,full);
  assert.equal(p.predict(reels[0].color,reels[1].color,25,1,2),'#A03050');
  const mid=p.predict(reels[0].color,reels[1].color,50,1,2);
  assert.notEqual(mid,mixFdmHex(reels[0].color,reels[1].color,50),'50% lies between the 25% and 75% readings');
  const [r,g,b]=[1,3,5].map(i=>parseInt(mid.slice(i,i+2),16));
  assert.ok(r>0x30&&r<0xA0&&b>0x50&&b<0x90,`${mid} lies between the two readings`);
  // 17% lies between the pure tile of reel 1 and the 25% reading.
  assert.notEqual(p.predict(reels[0].color,reels[1].color,17,1,2),mixFdmHex(reels[0].color,reels[1].color,17));
  // 83% is past the last reading and reel 2 has no pure tile: the estimate stands.
  assert.equal(p.predict(reels[0].color,reels[1].color,83,1,2),mixFdmHex(reels[0].color,reels[1].color,83));
  // Another pair has no readings at all.
  assert.equal(p.predict(reels[0].color,reels[2].color,50,1,3),mixFdmHex(reels[0].color,reels[2].color,50));
  // Pure tiles on both reels of a pair with no blend recorded: still an estimate.
  const ends=validateCalibration({...full,samples:[],pure:['#E01010','#1060B0',null,null]});
  assert.equal(calibratedPredictor(reels,ends).predict(reels[0].color,reels[1].color,50,1,2),mixFdmHex(reels[0].color,reels[1].color,50));
  assert.throws(()=>validateCalibration({...full,pure:['#E01010']}),/Pure reel readings/);
  assert.throws(()=>validateCalibration({...full,pure:['red',null,null,null]}),/Pure reel readings/);
}
