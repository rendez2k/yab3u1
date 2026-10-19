import test from 'node:test';
import assert from 'node:assert/strict';
import {platePreviewRequest,platePreviewSession} from './prepared-preview.js';
import {preparePlateJobs} from './plate-workflow.js';
import {jointSampleFile} from './joint-sample.js';
import {readZip} from '../../web/zip.js';
import {editProject} from './model-edit.js';
import {readProject,selectionFootprints,previewSoup} from '../../web/shared/project.js';
import {exportComparisonJob} from '../../web/shared/comparisonExport.js';
import {targetLayout} from '../../web/shared/layout.js';
import {FDM_MODEL} from '../../web/shared/fdmMix.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('Full Spectrum previews include the exported virtual colour IDs and calibrated blend shades',()=>{
  const physical=['#FF8000','#008000','#000000','#FFFFFF'].map(color=>({color,type:'PLA'}));
  const context={plateId:1,options:{physical,mapping:{2:5},recipes:[{a:1,b:3,percent:50,model:FDM_MODEL,measuredColor:'#766544'}]}};
  const first=platePreviewRequest(context,{objects:['1'],layout:{copies:4}});assert.equal(first.colors[5],'#766544');assert.deepEqual(first.mapping,{2:5});
});

test('prepared plate navigation drops late replies and restores the editable view without touching quantities',async()=>{
  const pending=[],shown=[],context={quantities:{body:1,stalk:1}},before=JSON.stringify(context);
  const jobs=[{id:'one',sequence:'by object',count:7},{id:'two',sequence:'by layer',count:7}];let cleared=0;
  const session=platePreviewSession({render(ctx,job){assert.equal(ctx,context);const d=deferred();pending.push(d);return d.promise;},show:s=>shown.push(s),clear(){cleared++;}});
  const first=session.present({context,jobs});assert.equal(session.selected,'two');assert(shown.at(-1).loading);
  const second=session.select('one');pending[1].resolve('stalks');await second;assert.equal(shown.at(-1).result,'stalks');
  pending[0].resolve('bodies');await first;assert.equal(shown.at(-1).job.id,'one');
  const third=session.select('two');session.close();pending[2].resolve('late');await third;assert(!session.active);assert.equal(cleared,1);assert.notEqual(shown.at(-1).result,'late');
  const resume=session.resume();pending[3].resolve('bodies');await resume;assert.equal(session.selected,'two');
  session.reset();assert.equal(session.resume(),undefined);assert.equal(JSON.stringify(context),before);
});

test('failed previews show a retryable error without losing the prepared plate',async()=>{
  let fail=true;const shown=[];const session=platePreviewSession({render:async()=>{if(fail)throw Error('preview worker stopped');return 'retry';},show:s=>shown.push(s),clear(){}});
  await session.present({context:{},jobs:[{id:'one'}]});assert.match(shown.at(-1).error.message,/worker stopped/);assert(session.active);
  fail=false;await session.select('one');assert.equal(shown.at(-1).result,'retry');
});

test('preview and exported sequential/colour plates use identical placed geometry and output paint',async()=>{
  const entries=await readZip(await jointSampleFile()),edited=editProject(entries,{objectIds:['1'],operation:'auto-separate',connector:{diameter:3,length:3,clearance:.3}});
  const project=readProject(edited.entries),ids=edited.changes.flatMap(c=>c.created.map(o=>o.id));
  const context={plateId:1,objects:selectionFootprints(project,1,ids),quantities:Object.fromEntries(ids.map(id=>[id,3])),
    layout:targetLayout('snapmaker',{copies:1,spacing:5,tower:true}),options:{target:'snapmaker',convert:true,physical:[{color:'#FF8000',type:'PLA'},{color:'#008000',type:'PLA'}],mapping:{1:1,2:2},recipes:[],carrySettings:true}};
  const replies=[],previous=globalThis.self;globalThis.self={postMessage:r=>replies.push(r)};
  try{
    const {writeZip}=await import('../../web/zip.js');await import('../../web/shared/recolour-worker.js?prepared-plate-test');
    await self.onmessage({data:{type:'load',id:1,bytes:await writeZip([...edited.entries].map(([name,data])=>({name,data}))),light:true,detailedPreview:true}});
    const vertices=(positions,colors)=>Array.from({length:positions.length/3},(_,i)=>[...positions.slice(i*3,i*3+3),...colors.slice(i*3,i*3+3)]);
    function sameVertices(a,b){
      assert.equal(a.length,b.length);const buckets=new Map(),key=v=>v.slice(0,3).map(n=>Math.floor(n/.01)),colour=v=>v.slice(3).map(n=>n.toFixed(3)).join(',');
      for(const v of b){const k=[...key(v),colour(v)].join('|');if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(v);}
      for(const v of a){const xyz=key(v),c=colour(v);let found=false;
        search:for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
          const row=buckets.get([xyz[0]+x,xyz[1]+y,xyz[2]+z,c].join('|'));if(!row)continue;
          const at=row.findIndex(p=>p.slice(0,3).every((n,i)=>Math.abs(n-v[i])<.002));if(at>=0){row.splice(at,1);found=true;break search;}
        }
        assert(found,`Preview vertex ${v} must occur in the export within 0.002 mm serialization tolerance`);
      }
    }
    for(const mode of ['sequential','colours'])for(const job of preparePlateJobs(context,mode)){
      const payload=platePreviewRequest(context,job);await self.onmessage({data:{type:'preview',id:2,...payload}});
      const reply=replies.at(-1);assert.equal(reply.type,'preview',reply.message);assert.equal(reply.preview.pickRanges.length,job.count);
      const built=exportComparisonJob(project,1,job,context.options),output=readProject(built.entries);
      const soup=previewSoup(output,1,null,payload.colors,null,Infinity,{full:true});
      sameVertices(vertices(reply.preview.positions,reply.preview.colors),vertices(soup.positions,soup.colors));
    }
  }finally{globalThis.self=previous;}
});
