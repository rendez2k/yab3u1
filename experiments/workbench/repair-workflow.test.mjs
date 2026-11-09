import test from 'node:test';
import assert from 'node:assert/strict';
import {readZip,writeZip} from '../../web/zip.js';
import {readProject,MODEL_FILE,layoutInstances,analyse} from '../../web/shared/project.js';
import {targetLayout} from '../../web/shared/layout.js';
import {editProject,sourceParts} from './model-edit.js';
import {assemblyMeshHealth} from './assembly-split.js';
import {jointSampleFile} from './joint-sample.js';

test('repair replacement is the only drawn, selectable and exported object in every arrangement',async()=>{
  const input=await readZip(await jointSampleFile()),enc=new TextEncoder(),xml=new TextDecoder().decode(input.get(MODEL_FILE)),triangle=xml.match(/<triangle\b[^>]*\/>/)[0];
  input.set(MODEL_FILE,enc.encode(xml.replace('</triangles>',triangle+'</triangles>')));
  const repaired=editProject(input,{objectIds:['1'],operation:'repair'}),newId=repaired.changes[0].created[0].id;
  const project=readProject(repaired.entries),expected=analyse(project,1,[newId]);
  assert(!assemblyMeshHealth(sourceParts(project,1,'1').parts[0].faces).ok,'original resource remains available for Undo');
  const replies=[];globalThis.self={postMessage:message=>replies.push(message)};
  await import('../../web/shared/recolour-worker.js');let requestId=0;
  async function request(data){const id=++requestId;await self.onmessage({data:{...data,id}});return replies.findLast(r=>r.id===id&&r.type!=='progress');}
  const bytes=await writeZip([...repaired.entries].map(([name,data])=>({name,data})));
  assert.equal((await request({type:'load',bytes,light:true})).type,'loaded');
  for(const arrangement of ['auto','group','objects']){
    const layout=targetLayout('snapmaker',{arrangement,copies:1,spacing:5,tower:true,quantities:{1:0,[newId]:1}});
    assert.deepEqual(layoutInstances(project,1,null,layout).instances.map(([id])=>id),[newId],`${arrangement}: the replaced original is excluded`);
    const preview=await request({type:'preview',plateId:1,objects:null,mode:'original',layout});
    assert.equal(preview.type,'preview',preview.message);
    assert.deepEqual(preview.preview.pickRanges.map(r=>r.objectId),[newId],`${arrangement}: canvas clicks select the repaired mesh`);
    const retry=editProject(repaired.entries,{objectIds:preview.preview.pickRanges.map(r=>r.objectId),operation:'auto-assembly'});
    assert(!retry.reports.some(r=>r.needsRepair),'splitting does not recheck the discarded original');
    const converted=await request({type:'convert',plateId:1,objects:null,target:'snapmaker',layout,mapping:{1:1,2:2},removeUnused:true,selectionAware:true,assignmentMode:'slots'});
    assert.equal(converted.type,'converted',converted.message);
    const saved=readProject(await readZip(converted.bytes)),output=analyse(saved,1,null);
    assert.equal(saved.plates[0].objectIds.length,1,`${arrangement}: output contains one model`);
    assert.equal(output.counts.triangles,expected.counts.triangles);
    assert.deepEqual(output.used,expected.used);
    assert(assemblyMeshHealth(sourceParts(saved,1,saved.plates[0].objectIds[0]).parts[0].faces).ok);
    assert.throws(()=>layoutInstances(project,1,null,{...layout,quantities:{1:0,[newId]:0}}),/nothing is selected/);
  }
});
