import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectShapeParts} from './shape-parts.js';
import {mapShapePreview} from './shape-preview.js';
import {shapeRegions,inspectShapes,sourceParts,editProject} from './model-edit.js';
import {jointSampleFile} from './joint-sample.js';
import {readZip,writeZip} from '../../web/zip.js';
import {readProject,MODEL_FILE,analyse,convertProject} from '../../web/shared/project.js';
import {signedVolume} from './mesh-cut.js';
import {colourBoundary,separateShape} from './mesh-joint.js';

async function sample(){const entries=await readZip(await jointSampleFile()),project=readProject(entries);return {entries,parts:sourceParts(project,1,'1').parts};}
test('geometry finds a neck without paint, remains deterministic, and covers every original face once',async()=>{
  const {parts}=await sample(),original=JSON.stringify(parts),faces=parts[0].faces;
  const first=detectShapeParts(faces),unpainted=faces.map(f=>({...f,attrs:''}));
  assert.equal(first.length,2);assert.deepEqual(first,detectShapeParts(unpainted));assert.deepEqual(first,detectShapeParts(faces));
  assert.equal(new Set(first.flat()).size,faces.length);assert.equal(first.flat().length,faces.length);assert.equal(JSON.stringify(parts),original);
  assert.throws(()=>detectShapeParts(faces,{detail:'invalid'}),/valid detection/);
  assert.throws(()=>detectShapeParts(new Array(750001)),/750,000/);
});
test('original surface selections recolour only requested regions and preserve other plates/source resources',async()=>{
  const {entries,parts}=await sample(),regions=shapeRegions(parts,'coarse'),original=entries.get(MODEL_FILE).slice();
  const result=editProject(entries,{objectIds:['1'],operation:'shape-colour',detail:'coarse',shapeIds:[regions[1].id],colour:'#246BA0'});
  const p=readProject(result.entries),id=result.changes[0].created[0].id,after=sourceParts(p,1,id).parts[0];
  assert.equal(after.faces.length,parts[0].faces.length);assert.deepEqual(analyse(p,1,[id]).used,[1,3]);
  assert.equal(signedVolume(after.faces).toFixed(4),signedVolume(parts[0].faces).toFixed(4));assert.deepEqual(entries.get(MODEL_FILE),original);
  assert.throws(()=>editProject(entries,{objectIds:['1'],operation:'shape-colour',shapeIds:['0:999'],colour:'#246BA0'}),/selection|regions/);
});
test('shape separation produces closed parts with matching joints and a valid export round trip',async()=>{
  const {entries,parts}=await sample(),regions=shapeRegions(parts,'coarse');
  const result=editProject(entries,{objectIds:['1'],operation:'shape-separate',detail:'coarse',shapeIds:[regions[1].id],connector:{diameter:3,length:3,clearance:.3}});
  const p=readProject(result.entries),ids=result.changes[0].created.map(o=>o.id);assert.equal(ids.length,2);
  assert.deepEqual(analyse(p,1,[ids[1]]).used,[2],'green stalk and its new pin remain a single-colour part');
  for(const id of ids)for(const part of sourceParts(p,1,id).parts){assert.equal(colourBoundary(part.faces).loops.length,0);assert(signedVolume(part.faces)>.01);}
  const out=convertProject(p,1,ids,{target:'snapmaker',assignmentMode:'slots',removeUnused:true,selectionAware:true,mapping:{1:1,2:2}});assert.deepEqual(out.problems,[]);
  const bytes=await writeZip([...out.entries].map(([name,data])=>({name,data})));assert(readProject(await readZip(bytes)).objects.size>0);
});
test('shape highlights track regions after preview translation; edits do not use approximate view labels',async()=>{
  const {entries,parts}=await sample(),regions=shapeRegions(parts,'coarse');
  const positions=Float32Array.from(parts[0].faces.flatMap(f=>f.points.flatMap(p=>p.map((v,a)=>v+[31,-9,0][a]))));
  const labels=mapShapePreview(parts,regions,positions);
  regions.forEach((r,label)=>r.faces.forEach(i=>assert.equal(labels[i],label)));
  const inspected=inspectShapes(entries,{objectIds:['1'],previewPositions:positions});assert.equal(inspected.regions.length,2);assert(!('faces' in inspected.regions[0]));assert.equal(inspected.previewRegions.length,parts[0].faces.length);
});
test('unsafe or stale selections fail without modifying the model; flat surfaces cannot become parts',async()=>{
  const {entries,parts}=await sample(),before=JSON.stringify(parts);
  assert.throws(()=>separateShape(parts[0].faces,[0]),/surface patch|boundary|thin/);
  assert.throws(()=>editProject(entries,{objectIds:['1'],operation:'shape-separate',shapeIds:['0:0','0:1']}),/entire object/);
  assert.equal(JSON.stringify(parts),before);
});
