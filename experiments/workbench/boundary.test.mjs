import {test} from 'node:test';
import assert from 'node:assert/strict';
import {surfaceGraph,traceBoundary} from './surface-boundary.js';
import {jointSampleFile} from './joint-sample.js';
import {readZip} from '../../web/zip.js';
import {readProject} from '../../web/shared/project.js';
import {sourceParts,editProject} from './model-edit.js';
import {signedVolume} from './mesh-cut.js';
import {explodedPositions,inspectionBounds} from './split-inspection.js';
import {surfaceHit} from './inspection-view.js';
const entries=await readZip(await jointSampleFile()),project=readProject(entries),faces=sourceParts(project,1,'1').parts[0].faces,graph=surfaceGraph(faces);
const points=[[135.175,130,33],[130,135.175,33],[124.825,130,33],[130,124.825,33]];
const options={objectIds:['1'],operation:'boundary-separate',boundary:{part:0,points},connector:{kind:'dowel',diameter:3,length:2,clearance:.3}};
function manifold(faces){const edges=new Map(),key=p=>p.map(n=>n.toFixed(6)).join(',');for(const f of faces)for(let i=0;i<3;i++){const a=key(f.points[i]),b=key(f.points[(i+1)%3]),k=[a,b].sort().join('|'),e=edges.get(k)||{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(k,e);}assert([...edges.values()].every(e=>e.count===2&&e.direction===0));}

test('boundary follows original edges deterministically and reversing side preserves the partition',()=>{
  const a=traceBoundary(graph,points,{closed:true}),b=traceBoundary(graph,points,{closed:true,flip:true});
  assert(a.indices.length>0&&a.indices.length<b.indices.length);assert.equal(a.path.length,65);assert(a.path.every(p=>Math.abs(p[2]-33)<1e-8));assert.equal(new Set([...a.indices,...b.indices]).size,faces.length);assert.equal(a.indices.length+b.indices.length,faces.length);
  assert.deepEqual(traceBoundary(graph,points,{closed:true}),a);assert.equal(traceBoundary(graph,points).indices.length,0);
});
test('invalid, duplicated, crossing and open-mesh boundaries fail without modifying geometry',()=>{
  const before=JSON.stringify(faces);
  assert.throws(()=>traceBoundary(graph,points.slice(0,2),{closed:true}),/three/);
  assert.throws(()=>traceBoundary(graph,[points[0],points[0],points[1]],{closed:true}),/same vertex/);
  assert.throws(()=>traceBoundary(graph,[points[0],points[2],points[1],points[3]],{closed:true}),/crosses|doubles/);
  assert.throws(()=>traceBoundary(graph,[[NaN,0,0]]),/valid/);
  assert.throws(()=>surfaceGraph(faces.slice(1)),/open|overlapping/);assert.equal(JSON.stringify(faces),before);
});
test('checked boundary and dowel export produce closed solids and preserve source members',()=>{
  const before=new Map([...entries].map(([k,v])=>[k,v.slice()]));
  const preview=editProject(entries,{...options,previewOnly:true,includeAssembly:true});
  assert.equal(preview.changes.length,0);assert.equal(preview.assembly.ranges.length,3);assert.equal(preview.joins.length,1);
  for(const [k,v]of before){assert.deepEqual(entries.get(k),v);assert.deepEqual(preview.entries.get(k),v);}
  const result=editProject(entries,options),out=readProject(result.entries);assert.equal(result.changes[0].created.length,3);
  for(const obj of result.changes[0].created)for(const part of sourceParts(out,1,obj.id).parts){manifold(part.faces);assert(signedVolume(part.faces)>0);}
  for(const [k,v]of before)assert.deepEqual(entries.get(k),v);
});
test('failed closure refuses a split while retaining its source',()=>{
  const before=entries.get('3D/3dmodel.model').slice();
  assert.throws(()=>editProject(entries,{...options,connector:{...options.connector,diameter:20}}),/pin|connector|room|edge|fit/i);
  assert.deepEqual(entries.get('3D/3dmodel.model'),before);
});
test('exploding is reversible and uses the checked assembled coordinates',()=>{
  const {assembly}=editProject(entries,{...options,previewOnly:true,includeAssembly:true}),before=assembly.positions.slice();
  const exploded=explodedPositions(assembly,20);assert.notDeepEqual(exploded,before);assert.deepEqual(assembly.positions,before);assert.deepEqual(explodedPositions(assembly,0),before);
  for(const r of assembly.ranges)assert(Math.abs(Math.hypot(...r.direction)-(r.dowel?0:1))<1e-10);
  const dowel=assembly.ranges.find(r=>r.dowel);assert.deepEqual(exploded.slice(dowel.start*3,(dowel.start+dowel.count)*3),before.slice(dowel.start*3,(dowel.start+dowel.count)*3),'loose dowel stays between the exploded halves');
  for(const gap of [0,15,60]){const positions=explodedPositions(assembly,gap),bounds=inspectionBounds(assembly,gap);for(let a=0;a<3;a++){const values=Array.from(positions).filter((_,i)=>i%3===a);assert(Math.abs(bounds.lo[a]-Math.min(...values))<.0001);assert(Math.abs(bounds.hi[a]-Math.max(...values))<.0001);}}
  assert.throws(()=>explodedPositions(assembly,NaN),/separation/);
});
test('surface click returns a point on the picked triangle',()=>{
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],positions=Float32Array.from([0,0,0,1,0,0,0,1,0]);
  assert.deepEqual(surfaceHit(positions,0,matrix,.25,.25),[.25,.25,0]);assert.equal(surfaceHit(positions,-1,matrix,0,0),null);
});
