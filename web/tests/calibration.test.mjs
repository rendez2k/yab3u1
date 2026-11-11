import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCalibration,calibratedPredictor,matchesCalibration,builtInMeasured} from '../shared/blendCalibration.js';
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

// ---- version 3: how a sample was made (slicer blend or built-in colours) ----
const wallInput={version:2,surface:'wall',revision:3,name:'Wall test',setup:'U1, PLA, wall',context:'test',reels,
  samples:[{a:1,b:3,percent:50,color:'#66cc77'},{a:2,b:3,percent:75,color:'#112233'}]};
const v3Input=(over={})=>({...wallInput,version:3,construction:'built-in',samples:[{sequence:[1,3],color:'#66CC77'}],...over});

test('two-reel slicer-blend samples never count as measured for built-in colours',()=>{
  const v2=validateCalibration(wallInput);
  assert.equal(builtInMeasured(reels,v2,[1,3]),null);
  assert.equal(builtInMeasured(reels,v2,[1,2]),null);
});
test('a built-in wall sample is measured only for its exact sequence',()=>{
  const p=validateCalibration(v3Input());
  assert.equal(builtInMeasured(reels,p,[1,3]),'#66CC77');
  assert.equal(builtInMeasured(reels,p,[3,1]),null);
  assert.equal(builtInMeasured(reels,p,[1]),null);
  assert.equal(builtInMeasured(reels,p,[1,3,3]),null);
  assert.equal(builtInMeasured(reels,p,[1,5]),null);
  assert.equal(builtInMeasured(reels,p,'13'),null);
});
test('a built-in sample is measured only on the wall surface, for the same reels, with the built-in construction',()=>{
  assert.equal(builtInMeasured(reels,validateCalibration(v3Input({surface:'top'})),[1,3]),null);
  assert.equal(builtInMeasured(reels,validateCalibration(v3Input({construction:'slicer-blend'})),[1,3]),null);
  const p=validateCalibration(v3Input());
  assert.equal(builtInMeasured(reels.map((r,i)=>i===2?{...r,color:'#EEEEEE'}:r),p,[1,3]),null);
  assert.equal(builtInMeasured(reels.slice(0,3),p,[1,3]),null);
  assert.equal(builtInMeasured(reels,null,[1,3]),null);
});
test('a measured sequence follows its reels when the loaded order differs',()=>{
  const p=validateCalibration(v3Input());
  const swapped=[reels[2],reels[1],reels[0],reels[3]];   // old slot 1 is now slot 3
  assert.equal(builtInMeasured(swapped,p,[3,1]),'#66CC77');
  assert.equal(builtInMeasured(swapped,p,[1,3]),null);
});
test('version 3 is validated strictly and keeps its construction',()=>{
  const p=validateCalibration(v3Input({samples:[{sequence:[1,3],color:'#66cc77'},{sequence:[1,3,1,3],color:'#102030'},{sequence:[2],color:'#0080C0'}]}));
  assert.equal(p.version,3);assert.equal(p.construction,'built-in');assert.equal(p.surface,'wall');assert.equal(p.revision,3);
  assert.deepEqual(p.samples,[{sequence:[1,3],color:'#66CC77'},{sequence:[1,3,1,3],color:'#102030'},{sequence:[2],color:'#0080C0'}]);
  assert.equal(validateCalibration(v3Input({construction:'slicer-blend'})).construction,'slicer-blend');
  const bad=[{construction:'other'},{construction:undefined},{surface:'side'},{surface:undefined},
    {samples:[{sequence:[],color:'#66CC77'}]},{samples:[{sequence:Array(41).fill(1),color:'#66CC77'}]},
    {samples:[{sequence:[0,1],color:'#66CC77'}]},{samples:[{sequence:[1,5],color:'#66CC77'}]},
    {samples:[{sequence:[1.5,2],color:'#66CC77'}]},{samples:[{sequence:'13',color:'#66CC77'}]},
    {samples:[{sequence:[1,3],color:'red'}]},{samples:[{a:1,b:3,percent:50,color:'#66CC77'}]},
    {samples:[{sequence:[1,3],color:'#66CC77'},{sequence:[1,3],color:'#000000'}]},
    {reels:reels.map((r,i)=>i===2?{...r,type:'PETG'}:r),samples:[{sequence:[1,3],color:'#66CC77'}]}];
  for(const change of bad) assert.throws(()=>validateCalibration(v3Input(change)),Error,JSON.stringify(change));
  assert.equal(validateCalibration(v3Input({samples:[{sequence:Array(40).fill(1),color:'#66CC77'}]})).samples[0].sequence.length,40);
  assert.throws(()=>validateCalibration({...wallInput,construction:'built-in',samples:[{sequence:[1,3],color:'#66CC77'}]}),Error,'version 2 cannot carry sequences');
});
test('a version 3 profile never feeds the two-reel blend predictor',()=>{
  const p=validateCalibration(v3Input());
  const {predict,measured}=calibratedPredictor(reels,p);
  assert.equal(measured(1,3,50),null);
  assert.equal(predict(reels[0].color,reels[2].color,50,1,3),mixFdmHex(reels[0].color,reels[2].color,50));
});
test('version 1 and 2 files still load exactly as before',()=>{
  // Captured from validateCalibration before version 3 existed (scratch script run on the unchanged module).
  const BEFORE={"v1":{"version":1,"name":"Measured test","setup":"U1, PLA, same temperature and lighting","context":"test","reels":[{"color":"#FF0000","type":"PLA","name":"Brand reel 1"},{"color":"#0080C0","type":"PLA","name":"Brand reel 2"},{"color":"#FFFFFF","type":"PLA","name":"Brand reel 3"},{"color":"#000000","type":"PLA","name":"Brand reel 4"}],"samples":[{"a":1,"b":2,"percent":25,"color":"#A03050"}]},
    "v2":{"version":2,"name":"Wall test","setup":"U1, PLA, wall","context":"test","reels":[{"color":"#FF0000","type":"PLA","name":"Brand reel 1"},{"color":"#0080C0","type":"PLA","name":"Brand reel 2"},{"color":"#FFFFFF","type":"PLA","name":"Brand reel 3"},{"color":"#000000","type":"PLA","name":"Brand reel 4"}],"samples":[{"a":1,"b":3,"percent":50,"color":"#66CC77"},{"a":2,"b":3,"percent":75,"color":"#112233"}],"surface":"wall","revision":3}};
  const v1Input={version:1,name:'Measured test',setup:'U1, PLA, same temperature and lighting',context:'test',reels,samples:[{a:1,b:2,percent:25,color:'#a03050'}]};
  assert.deepEqual(validateCalibration(v1Input),BEFORE.v1);
  assert.deepEqual(validateCalibration(wallInput),BEFORE.v2);
  assert.equal('construction' in validateCalibration(v1Input),false);
  assert.equal('construction' in validateCalibration(wallInput),false);
});
