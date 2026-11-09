import test from 'node:test';
import assert from 'node:assert/strict';
import {interfaceDemoFile} from '../shared/supportInterfaceDemo.js';
import {readZip} from '../zip.js';
import {readProject, selectionBounds, selectionFootprints, layoutInstances, previewSoup, exportProject, analyse} from '../shared/project.js';
import {fillLayout, targetLayout} from '../shared/layout.js';
import {planningAllowance} from '../shared/printSettings.js';
import {RecolourWorker} from '../shared/workerClient.js';

const entries=await readZip(await interfaceDemoFile());
const dec=new TextDecoder(), enc=new TextEncoder();
let model=dec.decode(entries.get('3D/3dmodel.model'));
const root=model.match(/<object id="10"[\s\S]*?<\/object>/)[0];
model=model.replace('</resources>',root.replace('id="10"','id="20"')+'</resources>')
  .replace('</build>','<item objectid="20" transform="1 0 0 0 1 0 0 0 1 175 120 0"/></build>');
entries.set('3D/3dmodel.model',enc.encode(model));
let meta=dec.decode(entries.get('Metadata/model_settings.config'));
meta=meta.replace('<plate>',meta.match(/<object id="10"[\s\S]*?<\/object>/)[0].replace('id="10"','id="20"')+'<plate>')
  .replace('</plate>','<model_instance><metadata key="object_id" value="20"/><metadata key="instance_id" value="0"/></model_instance></plate>');
entries.set('Metadata/model_settings.config',enc.encode(meta));
const project=readProject(entries), plate=project.plates[0].id;

test('Full Spectrum remove, duplicate and Fill use identical preview and archive placements',()=>{
  const selected=['20'];
  const bounds=selectionBounds(project,plate,selected);
  const options=targetLayout('snapmaker',{arrangement:'objects',copies:1,spacing:5,tower:true,
    quantities:{10:0,20:2},footprints:selectionFootprints(project,plate,selected),
    ...planningAllowance([project.sourceSettings],'snapmaker',true,'auto',false)});
  const filled=fillLayout(bounds,options);
  assert(filled.copies>1);
  const layout={...options,copies:filled.copies};
  const placed=layoutInstances(project,plate,selected,layout);
  assert.equal(placed.instances.length,filled.copies*2);
  assert(placed.instances.every(([id])=>id==='20'));
  const source=previewSoup(project,plate,selected,{},null,Infinity);
  const preview=previewSoup(project,plate,selected,{},null,Infinity,{layout});
  assert.equal(preview.positions.length,source.positions.length*filled.copies*2);
  const output=exportProject(project,plate,selected,{target:'snapmaker',reels:project.colors.map(color=>({color,type:'PLA'})),mapping:{1:1,2:2,3:3,4:4},recipes:[],layout});
  assert.deepEqual(output.problems,[]);
  const reopened=readProject(output.entries);
  assert.equal(layoutInstances(reopened,reopened.plates[0].id,null,null).instances.length,placed.instances.length);
  assert.deepEqual(analyse(reopened,reopened.plates[0].id,null).used,analyse(project,plate,selected).used);
  const restored=layoutInstances(project,plate,selected,options);
  assert.equal(restored.instances.length,2,'Undo restores the pre-fill quantity');
  assert.throws(()=>layoutInstances(project,plate,selected,{...options,quantities:{20:0}}),/nothing is selected/);
});

test('worker bounds retains the object footprints needed by Full Spectrum Fill',async()=>{
  const worker=Object.create(RecolourWorker.prototype);
  const footprints=selectionFootprints(project,plate,null);
  worker.request=async()=>({bounds:selectionBounds(project,plate,null),footprints,supportsPainted:true});
  const result=await worker.bounds(plate,null);
  assert.equal(result.footprints.length,2);
  assert.deepEqual(result.footprints,footprints);
  assert.equal(result.supportsPainted,true);
});
