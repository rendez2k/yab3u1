import test from 'node:test';
import assert from 'node:assert/strict';
import {repairMesh} from './mesh-repair.js';
import {assemblyMeshHealth} from './assembly-split.js';
import {signedVolume} from './mesh-cut.js';
import {editProject,sourceParts} from './model-edit.js';
import {jointSampleFile} from './joint-sample.js';
import {readZip,writeZip} from '../../web/zip.js';
import {readProject,MODEL_FILE,analyse} from '../../web/shared/project.js';
import {encode} from '../../web/shared/paint.js';

const points=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
const indices=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const cube=indices.map(ids=>({points:ids.map(i=>points[i]),attrs:' paint_color="4" support="4"'}));

test('healthy geometry is left unchanged; duplicate and collapsed faces are removed transactionally',()=>{
  const healthy=repairMesh(cube);assert.equal(healthy.faces,cube);assert(!healthy.changed);
  const damaged=[...cube,cube[0],{points:[points[0],points[0],points[1]],attrs:' paint_color="8"'}],before=JSON.stringify(damaged);
  const repaired=repairMesh(damaged);assert.deepEqual(repaired.faces,cube);assert.equal(repaired.report.duplicateFaces,1);assert.equal(repaired.report.degenerateFaces,1);assert(repaired.report.after.ok);
  assert.equal(JSON.stringify(damaged),before);assert.equal(signedVolume(repaired.faces),signedVolume(cube));
});
test('opposite zero-thickness faces attached to a solid are removed without repainting its surface',()=>{
  const flap={points:[points[0],points[1],[5,-1,0]],attrs:' paint_color="C"'},back={points:[...flap.points].reverse(),attrs:' paint_color="8"'};
  const result=repairMesh([...cube,flap,back]);assert.equal(result.report.zeroThicknessFaces,2);assert.deepEqual(result.faces,cube);assert(result.report.after.ok);
  assert.throws(()=>repairMesh([flap,back]),/no solid surface/);
});
test('pinched solids separate locally while keeping subdivided colour and seam trees on the same triangle corners',()=>{
  const tree=encode({kind:'split',sides:1,specialSide:0,children:[{kind:'leaf',state:1},{kind:'leaf',state:2}]});
  const faces=[...cube,...cube.map(f=>({...f,points:f.points.map(p=>[p[0]+10,p[1]+10,p[2]]),attrs:` paint_color="${tree}" seam="${tree}"`}))],before=JSON.stringify(faces);
  assert.equal(assemblyMeshHealth(faces).nonManifold,1);
  const result=repairMesh(faces);assert(result.changed);assert(result.report.after.ok);assert.equal(result.faces.length,faces.length);assert(result.report.separatedVertices>0);
  for(let i=0;i<faces.length;i++){
    assert.equal(result.faces[i].attrs,faces[i].attrs);
    for(let j=0;j<3;j++)assert(Math.hypot(...result.faces[i].points[j].map((v,k)=>v-faces[i].points[j][k]))<=.001000001);
  }
  assert(Math.abs(signedVolume(result.faces)-signedVolume(faces))<.2);assert.equal(JSON.stringify(faces),before);
  assert.deepEqual(repairMesh(faces),result,'repair is deterministic');assert(!repairMesh(result.faces).changed,'a repaired mesh is stable');
});
test('holes, reversed paint and conflicting duplicate paint are refused without a partial edit',()=>{
  for(const faces of [cube.slice(1),cube.map((f,i)=>i===0?{...f,points:[...f.points].reverse()}:f),[...cube,{...cube[0],attrs:' paint_color="8"'}]]){
    const before=JSON.stringify(faces);assert.throws(()=>repairMesh(faces),/boundaries|directions|painting/);assert.equal(JSON.stringify(faces),before);
  }
});
test('repaired 3MF resources round trip with original paint, settings, source resources and unrelated archive members intact',async()=>{
  const input=await readZip(await jointSampleFile()),enc=new TextEncoder(),xml=new TextDecoder().decode(input.get(MODEL_FILE)),triangle=xml.match(/<triangle\b[^>]*\/>/)[0];
  input.set(MODEL_FILE,enc.encode(xml.replace('</triangles>',triangle+'</triangles>')));input.set('Metadata/private-note.txt',enc.encode('keep this'));
  const source=input.get(MODEL_FILE).slice(),result=editProject(input,{objectIds:['1'],operation:'repair'});
  assert.deepEqual(input.get(MODEL_FILE),source);assert.equal(result.changes.length,1);assert.equal(result.changes[0].created.length,1);assert.equal(result.reports[0].repairs[0].duplicateFaces,1);
  const id=result.changes[0].created[0].id,zip=await writeZip([...result.entries].map(([name,data])=>({name,data}))),output=await readZip(zip),p=readProject(output);
  assert.deepEqual(output.get('Metadata/private-note.txt'),input.get('Metadata/private-note.txt'));assert(p.objects.has('1'));assert.deepEqual(analyse(p,1,[id]).used,[1,2]);
  assert(assemblyMeshHealth(sourceParts(p,1,id).parts[0].faces).ok);assert.equal(p.sourceSettings.layer_height,'0.2');
  assert.equal(editProject(output,{objectIds:[id],operation:'repair'}).changes.length,0);
});
