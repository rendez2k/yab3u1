// Optional local-only check. The source path is an argument; nothing is uploaded.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {readZip} from '../../web/zip.js';
import * as P from '../../web/shared/project.js';
import {ConvertSession,identityRule} from '../../web/shared/convertSession.js';
const bytes=fs.readFileSync(process.argv[2]);const p=P.readProject(await readZip(bytes)),plate=p.plates[0].id;
const footprints=P.selectionFootprints(p,plate,null),stem=footprints.find(o=>/stem/i.test(o.name));assert.ok(stem);
const s=new ConvertSession(()=>{});s.selectionAware=true;s.state={colours:p.colors,types:p.types,filamentUsage:P.conversionUsage(p),includeUnused:[],footprints};s.rules={slots:identityRule(p.colors.length),repaint:identityRule(p.colors.length)};
s.setLayout({quantities:{[stem.objectId]:0}});
const built=P.convertProject(p,plate,null,{selectionAware:true,removeUnused:true,target:'snapmaker',mapping:s.rule,assignmentMode:'slots',layout:{...s.layout,tower:false}});
assert.deepEqual(built.problems,[]);const back=P.readProject(built.entries),report=P.analyse(back,back.plates[0].id,null);
assert.equal(back.colors.length,4);assert.equal(report.objects.length,footprints.length-1);
console.log(JSON.stringify({exportObjects:report.objects.length,exportFilaments:back.colors.length,triangles:report.counts.triangles}));
const replies=[];globalThis.self={postMessage:message=>replies.push(message)};await import('../../web/shared/recolour-worker.js');
for(const detailedPreview of [false,true]){
 const start=Date.now();await self.onmessage({data:{type:'load',id:1,bytes,light:true,detailedPreview}});
 await self.onmessage({data:{type:'preview',id:2,plateId:plate,objects:null,mode:'original',layout:{...s.layout,quantities:{}}}});
 const result=replies.findLast(r=>r.id===2);assert.equal(result.type,'preview',result.message);assert.ok(result.preview.positions.length/9<=(detailedPreview?600000:120000));assert.equal(result.preview.pickRanges.length,footprints.length);
 console.log(JSON.stringify({detailedPreview,triangles:result.preview.positions.length/9,seconds:(Date.now()-start)/1000}));replies.length=0;
}
