import test from 'node:test';
import assert from 'node:assert/strict';
import {orientPinUp} from './orientation.js';
import {editProject,sourceParts,inspectRegions} from './model-edit.js';
import {jointSampleFile} from './joint-sample.js';
import {readZip} from '../../web/zip.js';
import {readProject} from '../../web/shared/project.js';
import {signedVolume} from './mesh-cut.js';

test('pin direction rotates to positive Z without a reflection, scale change or source mutation',()=>{
  for(const n of [[0,0,-1],[0,0,1],[1,0,0],[0,-1,0],[.6,0,-.8]]){
    const part={faces:[{points:[[0,0,0],n,[1,2,3]],attrs:'paint remains'}]},before=JSON.stringify(part);
    const result=orientPinUp([part],[n])[0].faces[0],d=result.points[1].map((v,i)=>v-result.points[0][i]);
    assert(Math.hypot(d[0],d[1])<1e-8);assert(Math.abs(d[2]-1)<1e-8);assert.equal(result.attrs,'paint remains');
    assert(Math.abs(Math.hypot(...result.points[2].map((v,i)=>v-result.points[0][i]))-Math.sqrt(14))<1e-8);assert.equal(JSON.stringify(part),before);
  }
  assert.throws(()=>orientPinUp([],[ [0,0,1],[0,0,-1] ]),/opposite/);
});
test('exported stalk stands on its top with pin tip highest; opt-out preserves original pin-down orientation',async()=>{
  const entries=await readZip(await jointSampleFile()),options={objectIds:['1'],operation:'separate-colour',from:2,connector:{diameter:3,length:3,clearance:.3}};
  const region=inspectRegions(entries,{objectIds:['1'],from:2});assert.equal(region.length,1);assert.equal(region[0].error,'');
  const results=[true,false].map(orientPins=>{
    const edit=editProject(entries,{...options,region:region[0].id,orientPins}),p=readProject(edit.entries),id=edit.changes[0].created[1].id;
    return sourceParts(p,1,id).parts[0].faces;
  });
  for(const [i,faces] of results.entries()){
    const z=faces.flatMap(f=>f.points.map(p=>p[2])),tip=faces.slice(-40).flatMap(f=>f.points.map(p=>p[2]));
    assert(Math.abs(Math.min(...z))<1e-6);assert(tip.every(v=>Math.abs(v-(i===0?Math.max(...z):0))<1e-6));
  }
  assert(Math.abs(signedVolume(results[0])-signedVolume(results[1]))<1e-4);
});
