import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePlateJobs} from './plate-workflow.js';
import {targetLayout} from '../../web/shared/layout.js';
import {exportComparisonJob} from '../../web/shared/comparisonExport.js';
import {readProject,selectionFootprints,SRC_BBL_PROJECT,analyse} from '../../web/shared/project.js';
import {readZip} from '../../web/zip.js';
import {jointSampleFile} from './joint-sample.js';
import {editProject} from './model-edit.js';
const rows=[{objectId:'green',name:'Stalk',bounds:{min:[0,0,0],max:[10,10,20]},colours:[{extruder:2}]},{objectId:'body',name:'Body',bounds:{min:[20,0,0],max:[60,40,40]},colours:[{extruder:1},{extruder:3}]}];
const context={objects:rows,quantities:{green:3,body:1},mapping:{},recipes:[],layout:targetLayout('snapmaker',{copies:2,spacing:5,tower:true}),options:{target:'snapmaker',physical:[{color:'#F58231'},{color:'#22864C'},{color:'#000000'}]}};
test('colour plates preserve exact counts and mapped physical colours; PETG and unknown paint stay by layer',()=>{
  const jobs=preparePlateJobs(context,'colours');assert.equal(jobs.length,2);assert.deepEqual(jobs.map(j=>j.count),[6,2]);assert(jobs.every(j=>j.sequence==='by layer'&&!j.mergeGroups));assert.equal(jobs[0].filament,2);
  const mapped=preparePlateJobs({...context,mapping:{1:2,3:2}},'colours');assert.equal(mapped.length,1);assert.equal(mapped[0].count,8);
  const petg=preparePlateJobs({...context,options:{...context.options,supportInterface:true}},'colours');assert.equal(petg.length,1);assert(petg[0].extraSupport);assert.equal(petg[0].filament,null);
  const unknown=preparePlateJobs({...context,objects:rows.map(o=>({...o,undecodable:1}))},'colours');assert.equal(unknown.length,1);assert.equal(unknown[0].filament,null);
  const blend=preparePlateJobs({...context,mapping:{2:5},recipes:[{id:5,a:1,b:2}]},'colours');assert.equal(blend.length,1);
  assert.throws(()=>preparePlateJobs({...context,quantities:{green:99}},'colours'),/1–64/);
});
test('colour-plate archives preserve oriented geometry, quantity, painting and by-layer sequence',async()=>{
  const input=await readZip(await jointSampleFile()),edit=editProject(input,{objectIds:['1'],operation:'separate-colour',from:2,connector:{diameter:3,length:3,clearance:.3}}),p=readProject(edit.entries),ids=edit.changes[0].created.map(o=>o.id);
  const objects=selectionFootprints(p,1,ids),options={target:'snapmaker',convert:true,physical:p.colors.map(color=>({color,type:'PLA'})),mapping:{1:1,2:2},recipes:[],preserveSourceSettings:true};
  const jobs=preparePlateJobs({objects,quantities:{[ids[1]]:2},layout:targetLayout('snapmaker',{copies:1,spacing:5}),options},'colours');
  assert.equal(jobs.length,2);
  for(const job of jobs){const out=exportComparisonJob(p,1,job,options),q=readProject(out.entries);assert.deepEqual(out.problems,[]);assert.deepEqual(analyse(q,1,null).used,[job.filament]);assert.equal(q.items.length,job.count);assert.equal(JSON.parse(new TextDecoder().decode(out.entries.get(SRC_BBL_PROJECT))).print_sequence,'by layer');}
  const sequential=preparePlateJobs({objects,quantities:{},layout:targetLayout('snapmaker',{copies:1,spacing:5}),options},'sequential');assert.equal(sequential[0].sequence,'by object');assert.equal(sequential[0].mergeGroups.length,2);
});
