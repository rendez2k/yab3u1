import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readZip,writeZip} from '../zip.js';
import * as p from '../shared/project.js';
import {PlateCollection} from '../shared/plateCollection.js';
import {ConvertSession,identityRule} from '../shared/convertSession.js';
import {SLOTS,REPAINT} from '../shared/assignment.js';
import {encodePng} from '../shared/png.js';
import {planProjectPlates,projectPalette,buildProjectPlate,mergeNativePlates} from '../shared/multiPlateProject.js';
const enc=new TextEncoder(),dec=new TextDecoder();
const source=p.readProject(await readZip(new Uint8Array(readFileSync('web/tests/five-colours.3mf'))));
const jobs=source.plates.map(plate=>({plateId:plate.id,name:plate.name,assignmentMode:SLOTS,autoSlots:true,layout:{copies:1,tower:false,spacing:5}}));
const options={target:'snapmaker',capacity:4,carrySettings:false,supportMode:'off'};
const read=entries=>p.readProject(entries,{allowNegative:true,allowModifiers:true});

test('plate deletion is reversible, preserves independent edits, and keeps a final plate',()=>{
  const c=new PlateCollection(),plates=[{id:1},{id:2},{id:3}],layout={copies:3,quantities:{a:2}};
  c.save(1,{layout});layout.quantities.a=0;assert.equal(c.get(1).layout.quantities.a,2);
  assert.equal(c.remove(1,plates),2);assert.deepEqual(c.visible(plates).map(p=>p.id),[2,3]);
  c.remove(3,plates);assert.throws(()=>c.remove(2,plates),/at least one/);
  assert.equal(c.restore(),'3');assert.equal(c.restore(),'1');assert.equal(c.get(1).layout.copies,3);
});

function session(){
  const s=new ConvertSession(()=>{},{});s.state={title:'Test',colours:['#FF0000','#00FF00'],plates:[{id:1,name:'One'},{id:2,name:'Two'}],plateId:1,includeUnused:[]};
  s.rules={[SLOTS]:identityRule(2),[REPAINT]:identityRule(2)};return s;
}
test('navigation restores quantities and colour edits without leaking to another plate',()=>{
  const s=session();s.layout.copies=3;s.layout.quantities={a:2};s.rules[SLOTS]={1:2,2:1};
  s.setPlate(2);assert.equal(s.layout.copies,1);assert.deepEqual(s.layout.quantities,{});assert.deepEqual(s.rule,identityRule(2));
  s.layout.quantities={b:0};s.setPlate(1);assert.equal(s.layout.copies,3);assert.deepEqual(s.layout.quantities,{a:2});assert.deepEqual(s.rule,{1:2,2:1});
  s.deletePlate();assert.equal(s.plateJobs().length,1);s.restorePlate();assert.equal(s.layout.copies,3);assert.equal(s.visiblePlates().length,2);
});
test('a stale whole-project export cannot publish after a plate edit',async()=>{
  const s=session();let resolve;s.worker={request:()=>new Promise(r=>{resolve=r;})};
  const pending=s.exportPlates();assert(s.busy);s.invalidate();resolve({bytes:new Uint8Array([1]),plates:2});assert.equal(await pending,null);assert(!s.busy);
});

test('selection compacts model slots above reserved support inputs without changing repaint',()=>{
  const s=session();s.selectionAware=true;
  s.state.colours=['#FFFFFF','#FF0000','#00FF00','#0000FF','#000000'];
  s.state.filamentUsage={kept:[1,2,3,4,5],unused:[],reservedThrough:1};
  s.state.footprints=[{objectId:'a',colours:[{extruder:4},{extruder:5}]}];
  s.rules[SLOTS]=identityRule(5);s.rules[REPAINT]={1:1,2:1,3:1,4:4,5:5};
  const repaint={...s.rules[REPAINT]};s.syncSelectionSlots();
  assert.deepEqual(s.rule,{1:1,2:4,3:5,4:2,5:3});
  assert.deepEqual(s.rules[REPAINT],repaint);
  assert.equal(s.capacityStatus().blocked,false);
});

test('per-plate plans detect painted fifth colour and independently compact other plates',()=>{
  const planned=planProjectPlates(source,jobs,options);
  assert.equal(planned[0].blocked,true);assert.equal(planned[0].activeSlots.length,5);
  assert.equal(planned[1].blocked,false);assert.deepEqual(planned[1].activeSlots,[1,2]);
  assert.deepEqual(planned[1].plan.physical.map(r=>r.color),source.colors.slice(2,4));
  const out=buildProjectPlate(source,planned[1],planned[1].plan.physical,planned[1].plan.mapping);
  assert.deepEqual(out.problems,[]);assert.deepEqual(p.analyse(read(out.entries),1,null).used,[1,2]);
});

test('a saved individual job starts at native plate 1, regardless of source plate number',async()=>{
  const planned=planProjectPlates(source,jobs,options)[1];
  const thumbnails={main:await encodePng(new Uint8Array(512*512*4),512,512),small:await encodePng(new Uint8Array(128*128*4),128,128)};
  const built=buildProjectPlate(source,planned,planned.plan.physical,planned.plan.mapping,thumbnails);
  assert.match(dec.decode(built.entries.get(p.SRC_BBL_MODEL)),/<metadata key="plater_id" value="1"\/>/);
  assert.equal(read(built.entries).plates[0].id,1);
  const regular=p.convertProject(source,2,null,{...planned.settings,thumbnails});
  assert.match(dec.decode(regular.entries.get(p.SRC_BBL_MODEL)),/<metadata key="plater_id" value="1"\/>/);
});

test('one edited project retains plates, copies, painting, names and disjoint mesh resources',async()=>{
  const altered=structuredClone(jobs);altered[1].layout.copies=3;altered[0].name='Faces $& <paint>';
  const planned=planProjectPlates(source,altered,options),palette=projectPalette(source,planned,'snapmaker');
  const outputs=planned.map((job,i)=>({plateId:job.plateId,name:job.name,built:buildProjectPlate(source,job,palette.physical,palette.mappings[i])}));
  const merged=mergeNativePlates(outputs,{title:'My $& <project>'});assert.deepEqual(merged.problems,[]);
  const again=read(await readZip(await writeZip([...merged.entries].map(([name,data])=>({name,data})))));
  assert.equal(again.plates.length,2);assert.equal(again.title,'My $& <project>');assert.equal(again.plates[0].name,altered[0].name);
  for(let i=0;i<2;i++){
    const count=p.selectionInstances(again,i+1,null).length;
    assert.equal(count,p.selectionInstances(source,i+1,null).length*(i===1?3:1));
    const expected=p.analyse(source,i+1,null).used.map(id=>source.colors[id-1]).sort();
    const actual=p.analyse(again,i+1,null).used.map(id=>again.colors[id-1]).sort();assert.deepEqual(actual,expected);
  }
  const uuids=[...dec.decode(merged.entries.get(p.MODEL_FILE)).matchAll(/p:UUID="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(uuids).size,uuids.length);
  const kept=mergeNativePlates([outputs[1]]);assert.equal(read(kept.entries).plates.length,1);assert.equal(read(kept.entries).plates[0].name,outputs[1].name);
  // Native settings reserve filament 1. Reopening must still compact the
  // remaining plate colours into the other printer inputs, not leave gaps.
  assert.equal(p.conversionUsage(again).reservedThrough,1);
  const reopened=planProjectPlates(again,again.plates.map(plate=>({...jobs[0],plateId:plate.id})),options);
  assert.equal(reopened[1].blocked,false);assert.deepEqual(reopened[1].activeSlots,[1,2,3]);
  assert.equal(reopened[1].plan.physical[0].color,again.colors[0]);
  assert.deepEqual(reopened[1].plan.physical.slice(1).map(r=>r.color).sort(),source.colors.slice(2,4).sort());
});

test('multipart and modifier roles survive joining two plates with shared source mesh IDs',()=>{
  const triangle='<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="10"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
  const entries=new Map([
    [p.MODEL_FILE,enc.encode(`<model unit="millimeter"><resources><object id="1" type="model">${triangle}</object><object id="2" type="model">${triangle}</object><object id="9" type="model"><components><component objectid="1"/><component objectid="2"/></components></object></resources><build><item objectid="9"/><item objectid="9" transform="1 0 0 0 1 0 0 0 1 324 0 0"/></build></model>`)],
    [p.SRC_BBL_PROJECT,enc.encode(JSON.stringify({filament_colour:['#FFFFFF','#00AACC'],filament_type:['PLA','PLA']}))],
    [p.SRC_BBL_MODEL,enc.encode(`<config><object id="9"><metadata key="name" value="Hand"/><metadata key="extruder" value="2"/><part id="1" subtype="normal_part"><metadata key="name" value="Body"/></part><part id="2" subtype="modifier_part"><metadata key="sparse_infill_density" value="25%"/></part></object>${[0,1].map(i=>`<plate><metadata key="plater_id" value="${i+1}"/><model_instance><metadata key="object_id" value="9"/><metadata key="instance_id" value="${i}"/></model_instance></plate>`).join('')}</config>`)]
  ]);
  const input=read(entries),planned=planProjectPlates(input,input.plates.map(plate=>({...jobs[0],plateId:plate.id})),options);
  const palette=projectPalette(input,planned,'snapmaker');
  const output=mergeNativePlates(planned.map((job,i)=>({name:`Hand ${i+1}`,built:buildProjectPlate(input,job,palette.physical,palette.mappings[i])})));
  const again=read(output.entries);assert.equal(again.plates.length,2);
  for(const plate of again.plates){assert.equal(p.selectionInstances(again,plate.id,null).length,1);const meta=again.meta.get(plate.objectIds[0]);assert.equal(meta.parts.find(v=>v.subtype==='modifier_part').settings.sparse_infill_density,'25%');}
});

test('a repaint affects only its edited plate in the combined palette',()=>{
  const altered=structuredClone(jobs);altered[0].assignmentMode=REPAINT;altered[0].autoSlots=false;
  altered[0].mapping={1:1,2:1,3:1,4:1,5:1,6:1};
  const planned=planProjectPlates(source,altered,options),palette=projectPalette(source,planned,'snapmaker');
  assert.equal(planned[0].blocked,false);
  const again=read(mergeNativePlates(planned.map((job,i)=>({name:job.name,built:buildProjectPlate(source,job,palette.physical,palette.mappings[i])}))).entries);
  assert.deepEqual(p.analyse(again,1,null).used.map(id=>again.colors[id-1]),[source.colors[0]]);
  assert.deepEqual(p.analyse(again,2,null).used.map(id=>again.colors[id-1]).sort(),source.colors.slice(2,4).sort());
});
