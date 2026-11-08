import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cutMesh,connectedParts,signedVolume} from './mesh-cut.js';
import {editProject,sourceParts,inspectShapes} from './model-edit.js';
import {jointSampleFile} from './joint-sample.js';
import {readZip,writeZip} from '../../web/zip.js';
import {interfaceDemoFile} from '../../web/shared/supportInterfaceDemo.js';
import * as project from '../../web/shared/project.js';
const points=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
const indices=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const cube=indices.map(ids=>({points:ids.map(i=>points[i]),attrs:' paint_color="4" support="4"'}));
const edgeCounts=faces=>{const edges=new Map(),key=p=>p.map(n=>n.toFixed(6)).join(',');for(const f of faces)for(let i=0;i<3;i++){const k=[key(f.points[i]),key(f.points[(i+1)%3])].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}return [...edges.values()];};
test('plane cuts preserve volume, opposite cap orientation, and source attributes on all three axes',()=>{
  for(const axis of [0,1,2]){const {halves,caps}=cutMesh(cube,axis,4,' paint_color="8"');assert(caps>0);assert(Math.abs(signedVolume(halves[0])-400)<1e-7);assert(Math.abs(signedVolume(halves[1])-600)<1e-7);assert.equal(halves[0].filter(f=>f.attrs.includes('support')).length,14);}
  assert(Math.abs(signedVolume(cube)-1000)<1e-7);
});
test('disconnected shells separate; invalid or open cuts leave input untouched',()=>{
  const both=[...cube,...cube.map(f=>({...f,points:f.points.map(p=>p.map((n,i)=>n+(i===0?30:0)))}))];
  assert.equal(connectedParts(both).length,2);assert.equal(connectedParts(cube).length,1);
  const before=JSON.stringify(cube);assert.throws(()=>cutMesh(cube,2,20),/does not pass/);assert.throws(()=>cutMesh(cube.slice(2),0,5),/open/);assert.equal(JSON.stringify(cube),before);
});

test('cut caps preserve every shared boundary edge and holes',()=>{
  const inner=cube.map(f=>({...f,points:[...f.points].reverse().map(p=>p.map(n=>3+n*.4))}));
  for(const faces of [cube,[...cube,...inner]])for(const axis of [0,1,2]){
    const {halves}=cutMesh(faces,axis,4);
    for(const half of halves)assert(edgeCounts(half).every(n=>n===2),'closed manifold edges');
    assert(Math.abs(signedVolume(faces)-halves.reduce((sum,h)=>sum+signedVolume(h),0))<1e-7);
  }
});
test('selected-copy colouring clones resources, preserves unrelated painting and print settings, and round trips',async()=>{
  const entries=await readZip(await interfaceDemoFile()),original=entries.get(project.MODEL_FILE).slice();
  const edited=editProject(entries,{objectIds:['10'],operation:'colour',colour:'#11BB66'});
  assert.deepEqual(entries.get(project.MODEL_FILE),original);
  const newId=edited.changes[0].created[0].id,p=project.readProject(edited.entries);
  assert.equal(project.analyse(p,1,['10']).used.length,4);
  assert.deepEqual(project.analyse(p,1,[newId]).used,[5]);
  assert.equal(JSON.parse(new TextDecoder().decode(edited.entries.get(project.SRC_BBL_PROJECT))).enable_support,'1');
  const zip=await writeZip([...edited.entries].map(([name,data])=>({name,data}))),again=project.readProject(await readZip(zip));
  assert.equal(again.colors[4],'#11BB66');assert.equal(again.meta.get(newId).parts.length,5);
});
test('separate and cut produce real exportable meshes, not preview-only geometry',async()=>{
  const entries=await readZip(await interfaceDemoFile());
  const split=editProject(entries,{objectIds:['10'],operation:'separate'});assert.equal(split.changes[0].created.length,5);
  const p=project.readProject(split.entries),ids=split.changes[0].created.map(x=>x.id);
  const n=project.analyse(p,1,ids);assert.equal(n.counts.triangles,60);
  const cut=editProject(entries,{objectIds:['10'],operation:'cut',axis:2,position:50});assert.equal(cut.changes[0].created.length,2);
  const q=project.readProject(cut.entries),chosen=cut.changes[0].created.map(x=>x.id);
  const out=project.convertProject(q,1,chosen,{target:'snapmaker',assignmentMode:'slots',removeUnused:true,selectionAware:true,mapping:{1:1,2:2,3:3,4:4}});
  assert.deepEqual(out.problems,[]);const read=project.readProject(out.entries);assert(project.analyse(read,1,null).counts.triangles>60);
});
test('colour detachment exports a stalk and socket; removing it drops green without losing settings or source',async()=>{
  const entries=await readZip(await jointSampleFile()),original=entries.get(project.MODEL_FILE).slice();
  const detached=editProject(entries,{objectIds:['1'],operation:'separate-colour',from:2,connector:{diameter:3,length:3,clearance:.3}});
  const p=project.readProject(detached.entries),ids=detached.changes[0].created.map(o=>o.id);
  assert.equal(ids.length,2);assert.deepEqual(project.analyse(p,1,[ids[0]]).used,[1]);assert.deepEqual(project.analyse(p,1,[ids[1]]).used,[2]);
  const removed=editProject(entries,{objectIds:['1'],operation:'remove-colour',from:2}),q=project.readProject(removed.entries),remaining=removed.changes[0].created.map(o=>o.id);
  const out=project.convertProject(q,1,remaining,{target:'snapmaker',assignmentMode:'slots',selectionAware:true,removeUnused:true,mapping:{1:1}});
  assert.deepEqual(out.problems,[]);assert.deepEqual(project.readProject(out.entries).colors,['#F58231']);
  assert.deepEqual(entries.get(project.MODEL_FILE),original);assert.equal(q.sourceSettings.layer_height,'0.2');
});

test('dowel separation, shape separation and auto mode keep one printable upright dowel per join through export',async()=>{
  const entries=await readZip(await jointSampleFile()),saved=[...entries].map(([name,data])=>[name,data.slice()]);
  const shapes=inspectShapes(entries,{objectIds:['1']});
  for(const operation of ['separate-colour','auto-separate','cut','shape-separate']){
    const options={objectIds:['1'],operation,shapeIds:[shapes.regions[1].id],from:2,axis:2,position:70,connector:{kind:'dowel',diameter:2,length:2,clearance:.2,offset:[.2,0]},orientPins:false};
    const checked=editProject(entries,{...options,previewOnly:true});
    assert.equal(checked.changes.length,0);assert(checked.joins.length>0);
    assert.deepEqual([...checked.entries],saved);
    const result=editProject(entries,options),p=project.readProject(result.entries),created=result.changes[0].created;
    const dowels=created.filter(n=>/dowel/.test(n.name));assert.equal(dowels.length,result.joins.length);
    for(const d of dowels){const {parts}=sourceParts(p,1,d.id),v=parts.flatMap(p=>p.faces.flatMap(f=>f.points));assert(Math.abs(Math.min(...v.map(p=>p[2])))<1e-6);assert(Math.abs(Math.max(...v.map(p=>p[2]))-4)<1e-6);parts.forEach(p=>assert(edgeCounts(p.faces).every(n=>n===2)));assert.equal(project.analyse(p,1,[d.id]).used.length,1);}
    const out=project.convertProject(p,1,created.map(n=>n.id),{target:'snapmaker',assignmentMode:'slots',selectionAware:true,removeUnused:true,mapping:{1:1,2:2}});
    assert.deepEqual(out.problems,[]);const roundtrip=project.readProject(await readZip(await writeZip([...out.entries].map(([name,data])=>({name,data})))));
    assert.equal(roundtrip.plates[0].objectIds.length,created.length);
  }
  assert.deepEqual([...entries],saved);
});
