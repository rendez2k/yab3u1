import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStrategies,rankStrategies,readTiming,validateReport,outputTools} from '../shared/printOptimiser.js';
import {targetLayout} from '../shared/layout.js';
import {readZip} from '../zip.js';
import {readProject,selectionFootprints,SRC_BBL_PROJECT} from '../shared/project.js';
import {interfaceDemoFile} from '../shared/supportInterfaceDemo.js';
import {exportComparisonJob} from '../shared/comparisonExport.js';
import fs from 'node:fs';
const objects=[
  {objectId:'body',name:'Body',bounds:{min:[0,0,0],max:[80,80,45]},colours:[{extruder:1},{extruder:2}]},
  {objectId:'stem',name:'Stem',bounds:{min:[90,0,0],max:[105,20,18]},colours:[{extruder:3}]},
];
const layout=targetLayout('snapmaker',{width:270,depth:270,spacing:5,tower:true});
const context={objects,quantities:{body:1,stem:2},mapping:{},recipes:[],primary:{target:'snapmaker',layout},secondary:{target:'snapmaker',layout},additionalMaterials:false};
const times=plan=>Object.fromEntries(plan.jobs.map(j=>[j.id,{seconds:3600*j.batch,toolChanges:10,source:'slicer',clearanceChecked:true}]));
test('every fixed-order candidate makes exactly the same object quantities, including partial plates',()=>{
  const plan=buildStrategies(context,{sets:13,parallel:true,sequential:true});
  for(const strategy of plan.strategies.filter(s=>!s.blocked)) {
    const counts={body:0,stem:0};
    for(const run of strategy.runs){const job=plan.jobs.find(j=>j.id===run.jobId);for(const id of job.objects)counts[id]+=job.quantities[id]*job.batch*run.count;}
    assert.deepEqual(counts,{body:13,stem:26},strategy.id);
  }
  assert.ok(plan.jobs.some(j=>j.batch>1));
});
test('missing timing never wins and partial reports cannot claim all alternatives were assessed',()=>{
  const plan=buildStrategies(context,{sets:3});
  assert.ok(rankStrategies(plan,{}).every(r=>r.seconds===null));
  const result=rankStrategies(plan,times(plan));assert.ok(result.every(r=>r.seconds>0));
  assert.equal(result[0].id,'mixed-batch');
});
test('parallel completion is max printer duration; rate includes cycle turnaround',()=>{
  const plan=buildStrategies(context,{sets:1,parallel:true,turnaround:10});
  const ranked=rankStrategies(plan,times(plan));
  const serial=ranked.find(r=>r.id==='split'),parallel=ranked.find(r=>r.id==='parallel');
  assert.equal(serial.seconds,7800);assert.equal(parallel.seconds,3600);
  assert.equal(parallel.cycleSeconds,4200);assert.equal(parallel.outputSets,1);
});
test('rate comparisons produce balanced complete sets and rank by sets per hour',()=>{
  const plan=buildStrategies(context,{objective:'rate'});
  for(const s of plan.strategies)assert.ok(s.outputSets>=1);
  const result=rankStrategies(plan,times(plan));
  for(let i=1;i<result.length;i++)assert.ok(result[i-1].setsPerHour>=result[i].setsPerHour);
});
test('blends are classified by physical output tools; unknown paint remains multicolour',()=>{
  assert.deepEqual(outputTools(objects[1],{3:5},[{id:5,a:1,b:2}]),[1,2]);
  assert.equal(outputTools({...objects[1],undecodable:1}),null);
  const plan=buildStrategies({...context,additionalMaterials:true},{sequential:true});
  assert.match(plan.strategies.find(s=>s.id==='sequential').blocked,/support/);
});
test('sequential plans require explicit clearance evidence and failures cannot rank',()=>{
  const plan=buildStrategies(context,{sequential:true}),timings=times(plan);
  for(const job of plan.jobs.filter(j=>j.sequence==='by object'))timings[job.id].clearanceChecked=false;
  assert.equal(rankStrategies(plan,timings).find(s=>s.id==='sequential').seconds,null);
  timings[plan.jobs[0].id]={error:'Slicer rejected collision'};
  assert.equal(rankStrategies(plan,timings).find(s=>s.id==='mixed-one').seconds,null);
});
test('read total estimate, not model-only time; never invent tool changes',()=>{
  assert.deepEqual(readTiming('; model printing time: 1h; total estimated time: 1h 8m 2s\n'),{seconds:4082,toolChanges:null,source:'slicer'});
  assert.equal(readTiming('; estimated printing time (normal mode) = 2h 5m\n; total filament change = 45').toolChanges,45);
  assert.throws(()=>readTiming('; model printing time: 1h\n'),/No recognised/);
});
test('report identity, file hashes and finite times are mandatory',()=>{
  const pack={packId:'pack',jobs:[{id:'job-1',sha256:'abc'}]};
  const report={schema:'yab3d-timings-v1',packId:'pack',jobs:[{id:'job-1',sha256:'abc',seconds:60}]};
  assert.equal(validateReport(report,pack)['job-1'].seconds,60);
  assert.throws(()=>validateReport({...report,packId:'old'},pack),/different/);
  assert.throws(()=>validateReport({...report,jobs:[{...report.jobs[0],sha256:'wrong'}]},pack),/changed/);
  assert.throws(()=>validateReport({...report,jobs:[{...report.jobs[0],seconds:NaN}]},pack),/invalid/);
});
test('comparison export forces intended sequence without changing paint or quality',async()=>{
  const p=readProject(await readZip(await interfaceDemoFile()));const plate=p.plates[0].id;
  const footprints=selectionFootprints(p,plate,null);
  const options={target:'snapmaker',physical:p.colors.map(color=>({color,type:'PLA'})),mapping:{1:1,2:2,3:3,4:4},recipes:[],layerHeight:{mode:'custom',value:.16}};
  const job={objects:footprints.map(o=>o.objectId),sequence:'by layer',layout:{...layout,arrangement:'objects',copies:1,footprints,quantities:{}}};
  const out=exportComparisonJob(p,plate,job,options);
  const cfg=JSON.parse(new TextDecoder().decode(out.entries.get(SRC_BBL_PROJECT)));
  assert.equal(cfg.print_sequence,'by layer');assert.ok(cfg.different_settings_to_system[0].includes('print_sequence'));
  assert.throws(()=>exportComparisonJob(p,plate,{...job,sequence:'by object'},options),/single-filament/);
  assert.throws(()=>exportComparisonJob(p,plate,job,{...options,target:'bambu'}),/native Bambu/);
});

test('U1 split jobs compact surplus slots without losing selected paint; explicit support references fail closed',async()=>{
  const p=readProject(await readZip(fs.readFileSync(new URL('./five-colours.3mf',import.meta.url))));
  const plate=p.plates[0].id,footprints=selectionFootprints(p,plate,['10']);
  const options={target:'snapmaker',convert:true,assignmentMode:'slots',physical:p.colors.map(color=>({color,type:'PLA'})),mapping:{1:1,2:2,3:3,4:4,5:5,6:6},recipes:[]};
  const job={objects:['10'],sequence:'by layer',layout:{...layout,arrangement:'objects',copies:2,footprints,quantities:{'10':1}}};
  const out=exportComparisonJob(p,plate,job,options);
  const reopened=readProject(out.entries);
  assert.deepEqual(reopened.colors,['#FFFFFF','#000000','#0000FF']);
  const copied=selectionFootprints(reopened,reopened.plates[0].id,null);
  assert.equal(copied.length,2);
  for(const object of copied)assert.deepEqual(object.colours.map(c=>c.color).sort(),['#FFFFFF','#000000','#0000FF'].sort());
  p.sourceSettings.support_interface_filament='5';
  assert.throws(()=>exportComparisonJob(p,plate,job,options),/explicit support/);
});

test('capacity checks apply to split job colours, not the source palette size',()=>{
  const p=buildStrategies({...context,primary:{...context.primary,maxPhysical:2}},{sets:1});
  assert.match(p.strategies.find(s=>s.id==='mixed-one').blocked,/3 physical filaments/);
  assert.equal(p.strategies.find(s=>s.id==='split').blocked,'');
});
