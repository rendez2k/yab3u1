import test from 'node:test';
import assert from 'node:assert/strict';
import {autoAssembly,assemblyMeshHealth} from './assembly-split.js';
import {editProject,sourceParts} from './model-edit.js';
import {jointSampleFile} from './joint-sample.js';
import {detectShapeParts} from './shape-parts.js';
import {signedVolume} from './mesh-cut.js';
import {readZip,writeZip} from '../../web/zip.js';
import {readProject,analyse,MODEL_FILE} from '../../web/shared/project.js';
import {encode} from '../../web/shared/paint.js';

test('larger assembly parts follow geometry, preserve mixed paint and close without changing source volume',async()=>{
  const entries=await readZip(await jointSampleFile()),part=sourceParts(readProject(entries),1,'1').parts[0];
  const regions=detectShapeParts(part.faces,{detail:'coarse'}),small=regions[1];
  // Several colours and a subdivided paint tree on one physical stalk.
  const tree=encode({kind:'split',sides:1,specialSide:0,children:[{kind:'leaf',state:1},{kind:'leaf',state:2}]});
  part.faces=part.faces.map((f,i)=>({...f,attrs:small.includes(i)?` paint_color="${i===small[0]?tree:encode({kind:'leaf',state:i%2+1})}"`:f.attrs}));
  const before=JSON.stringify(part),out=autoAssembly([part]);
  assert.equal(out.groups.length,2);assert.equal(out.report.strategy,'assembly');assert.equal(out.report.separated.length,1);
  assert(out.groups.every(g=>assemblyMeshHealth(g[0].faces).ok));
  const original=new Set(part.faces);for(const face of original)assert.equal(out.groups.flatMap(g=>g.flatMap(p=>p.faces)).filter(f=>f===face).length,1);
  assert(out.groups[1][0].faces.some(f=>f.attrs.includes(tree)));assert.equal(JSON.stringify(part),before);
  assert(Math.abs(out.groups.reduce((sum,g)=>sum+signedVolume(g[0].faces),0)-signedVolume(part.faces))<1e-6);
  assert.deepEqual(autoAssembly([part]),out,'same mesh and settings must give the same result');
});
test('damaged geometry is retained with an actionable report, without detaching small scraps',async()=>{
  const entries=await readZip(await jointSampleFile()),part=sourceParts(readProject(entries),1,'1').parts[0];
  for(const faces of [part.faces.slice(1),[...part.faces,part.faces[0]],part.faces.map((f,i)=>i===0?{...f,points:[...f.points].reverse()}:f)]){
    const source={...part,faces},before=JSON.stringify(source),out=autoAssembly([source]);
    assert.equal(out.groups.length,1);assert.deepEqual(out.report.separated,[]);assert.match(out.report.retained[0].reason,/needs repair/);
    assert.equal(JSON.stringify(source),before);assert.deepEqual(out.groups[0][0],source);
  }
});
test('assembly project export preserves original resources, paint, closed joins and connector metadata',async()=>{
  const input=await readZip(await jointSampleFile()),before=input.get(MODEL_FILE).slice();
  const result=editProject(input,{objectIds:['1'],operation:'auto-assembly',connector:{diameter:3,length:3,clearance:.3},includeAssembly:true});
  assert.equal(result.changes[0].created.length,2);assert.equal(result.reports[0].strategy,'assembly');
  const preview=editProject(input,{objectIds:['1'],operation:'auto-assembly',connector:{diameter:3,length:3,clearance:.3},previewOnly:true,includeAssembly:true});
  assert(preview.assembly.positions.length>0);assert.equal(preview.assembly.ranges.length,2);assert.deepEqual(preview.changes,[]);
  assert.deepEqual(input.get(MODEL_FILE),before);
  const bytes=await writeZip([...result.entries].map(([name,data])=>({name,data}))),project=readProject(await readZip(bytes)),ids=result.changes[0].created.map(o=>o.id);
  assert.deepEqual(analyse(project,1,ids).used,[1,2]);
  for(const id of ids)for(const part of sourceParts(project,1,id).parts){assert(assemblyMeshHealth(part.faces).ok);assert(signedVolume(part.faces)>0);}
});
