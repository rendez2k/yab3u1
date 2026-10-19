import test from 'node:test';
import assert from 'node:assert/strict';
import {autoSeparate} from './auto-split.js';
import {editProject,sourceParts} from './model-edit.js';
import {fitCompleteSets,fitOnOnePlate,waitForMeasuredState} from './auto-layout.js';
import {preparePlateJobs} from './plate-workflow.js';
import {jointSampleFile} from './joint-sample.js';
import {readZip} from '../../web/zip.js';
import {encode} from '../../web/shared/paint.js';
import {readProject,analyse,selectionFootprints,MODEL_FILE} from '../../web/shared/project.js';
import {targetLayout} from '../../web/shared/layout.js';
import {exportComparisonJob} from '../../web/shared/comparisonExport.js';
import {signedVolume} from './mesh-cut.js';

test('automatic filling waits for the current revision measurements and rejects stale or failed measurement',async()=>{
  let state={key:'edited',bounds:null,busy:true,layout:{footprints:[]}},turns=0;
  const measured=await waitForMeasuredState(()=>state,{yieldTurn:async()=>{turns++;state={...state,busy:false,bounds:{min:[0,0,0],max:[10,10,10]},layout:{footprints:[{objectId:'1'}]}};}});
  assert.equal(turns,1);assert.equal(measured,state);
  state={key:'edited',bounds:null,busy:true};await assert.rejects(waitForMeasuredState(()=>state,{yieldTurn:async()=>{state={...state,key:'other'};}}),/model changed/);
  await assert.rejects(waitForMeasuredState(()=>state,{timeout:0}),/could not be measured/);
});

function stalks(sameColour=false){
  const cells=new Map();for(let x=0;x<4;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++)cells.set([x,y,z].join(','),1);
  for(const [x,y,c]of [[0,0,2],[3,1,sameColour?2:3]])for(let z=2;z<4;z++)cells.set([x,y,z].join(','),c);
  const faces=[],corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],sides=[[[0,0,-1],[0,3,2,1]],[[0,0,1],[4,5,6,7]],[[0,-1,0],[0,1,5,4]],[[1,0,0],[1,2,6,5]],[[0,1,0],[2,3,7,6]],[[-1,0,0],[3,0,4,7]]];
  for(const [key,colour]of cells){const p=key.split(',').map(Number);for(const [d,ids]of sides){if(cells.has(p.map((v,i)=>v+d[i]).join(',')))continue;const c=colour===1&&p[0]===1&&p[1]===0&&p[2]===0&&d[1]===-1?4:colour;for(const tri of [[ids[0],ids[1],ids[2]],[ids[0],ids[2],ids[3]]])faces.push({points:tri.map(n=>corners[n].map((v,i)=>(v+p[i])*10)),colour:c,attrs:` paint_color="${encode({kind:'leaf',state:c})}"`});}}
  return {name:'Two stalks and a flat paint patch',base:1,subtype:'normal_part',settings:{layer_height:'0.16'},faces};
}
function manifold(faces){const edges=new Map(),key=p=>p.map(n=>n.toFixed(5)).join(',');for(const f of faces)for(let i=0;i<3;i++){const a=key(f.points[i]),b=key(f.points[(i+1)%3]),k=[a,b].sort().join('|'),e=edges.get(k)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(k,e);}return [...edges.values()].every(([n,s])=>n===2&&s===0);}

test('automatic scan detaches multiple colours or same-colour regions, keeps flat paint, and closes every part',()=>{
  for(const same of [false,true]){const part=stalks(same),original=JSON.stringify(part),result=autoSeparate([part]);
    assert.equal(result.groups.length,3);assert.equal(result.report.separated.length,2);assert(result.report.retained.some(r=>r.colour===4));
    assert(result.groups.every(g=>manifold(g[0].faces)));assert(Math.abs(result.groups.reduce((s,g)=>s+signedVolume(g[0].faces),0)-signedVolume(part.faces))<1e-6);
    assert.equal(JSON.stringify(part),original);assert(result.groups.every(g=>g[0].settings.layer_height==='0.16'));
    assert(result.groups[0][0].faces.some(f=>f.colour===4));
  }
});
test('automatic connectors are closed; oversized pins retain the affected regions',()=>{
  const part=stalks(),good=autoSeparate([part],{connector:{diameter:3,length:3,clearance:.3}});
  assert.equal(good.report.separated.length,2);assert(good.report.separated.every(r=>r.pin));assert(good.groups.every(g=>manifold(g[0].faces)));assert(good.groups.slice(1).every(g=>g[0].pinDirections.length===1));
  const bad=autoSeparate([part],{connector:{diameter:20,length:3,clearance:.3}});assert.equal(bad.groups.length,1);assert(bad.report.retained.some(r=>/too wide/.test(r.reason)));assert.deepEqual(bad.groups[0][0].faces,part.faces);
});
test('inner cavity shells are kept with the body, not converted into solid separate pieces',()=>{
  const outer=stalks().faces.map(f=>({...f,colour:1})),inner=outer.map(f=>({...f,points:[...f.points].reverse().map(p=>p.map((v,i)=>v*.1+[10,5,5][i]))}));
  const part={base:1,faces:[...outer,...inner]},result=autoSeparate([part]);assert.equal(result.groups.length,1);assert.equal(result.groups[0][0].faces.length,part.faces.length);
});
test('auto project edit preserves original bytes, exports oriented pins and retains original paint/settings',async()=>{
  const input=await readZip(await jointSampleFile()),before=input.get(MODEL_FILE).slice(),out=editProject(input,{objectIds:['1'],operation:'auto-separate',connector:{diameter:3,length:3,clearance:.3}});
  assert.equal(out.changes[0].created.length,2);assert.equal(out.reports[0].separated[0].colour,2);assert.deepEqual(input.get(MODEL_FILE),before);
  const p=readProject(out.entries),ids=out.changes[0].created.map(o=>o.id);assert.deepEqual(analyse(p,1,ids).used,[1,2]);assert.equal(p.sourceSettings.layer_height,'0.2');
  const faces=sourceParts(p,1,ids[1]).parts[0].faces,z=faces.flatMap(f=>f.points.map(p=>p[2]));assert(Math.abs(Math.min(...z))<1e-6);assert(faces.slice(-40).every(f=>f.points.every(p=>Math.abs(p[2]-Math.max(...z))<1e-6)));
  const options={target:'snapmaker',convert:true,physical:p.colors.map(color=>({color,type:'PLA'})),mapping:{1:1,2:2},recipes:[],preserveSourceSettings:true};
  const context={objects:selectionFootprints(p,1,ids),quantities:{},layout:targetLayout('snapmaker',{copies:1,spacing:5}),options};
  const fitted=await fitCompleteSets(context,ids,ctx=>preparePlateJobs(ctx,'sequential'));assert(fitted.sets>1);assert.equal(fitted.quantities[ids[0]],fitted.quantities[ids[1]]);
  for(const job of fitted.result){const exported=exportComparisonJob(p,1,job,options);assert.deepEqual(exported.problems,[]);assert.deepEqual(analyse(readProject(exported.entries),1,null).used,[1,2]);}
});
test('complete-set filling keeps sibling counts and excluded objects; sequential and multicolour jobs stay balanced',async()=>{
  const objects=[{objectId:'stalk',bounds:{min:[0,0,0],max:[10,10,20]},colours:[{extruder:2}]},{objectId:'body',bounds:{min:[0,0,0],max:[40,40,30]},colours:[{extruder:1},{extruder:3}]},{objectId:'other',bounds:{min:[0,0,0],max:[20,20,10]},colours:[{extruder:1}]}],layout=targetLayout('snapmaker',{copies:1,spacing:5}),context={objects,quantities:{other:2},bounds:{min:[0,0,0],max:[40,40,30]},layout,options:{target:'snapmaker'}};
  const one=await fitCompleteSets(context,['body','stalk'],fitOnOnePlate);assert(one.sets>1);assert.equal(one.quantities.other,2);assert.equal(one.quantities.body,one.quantities.stalk);
  const seq=await fitCompleteSets({...context,quantities:{other:0}},['body','stalk'],ctx=>preparePlateJobs(ctx,'sequential'));assert.equal(seq.result.length,2);assert.equal(seq.result[0].count,seq.result[1].count);assert.equal(seq.quantities.other,0);
  await assert.rejects(fitCompleteSets({...context,layout:{...layout,width:5,depth:5}},['body'],fitOnOnePlate),/does not fit/);
});
