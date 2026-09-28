import assert from 'node:assert/strict';
import {planLayout,targetLayout} from '../shared/layout.js';
import {conversionPalette,SLOTS,REPAINT} from '../shared/assignment.js';
import {ConvertSession} from '../shared/convertSession.js';
const bounds={min:[0,0,0],max:[180,150,45]};
const footprints=[{objectId:'body',bounds:{min:[0,0,0],max:[70,62,43]}},{objectId:'cap',bounds:{min:[120,0,0],max:[149,29,5]}}];
const options=targetLayout('snapmaker',{arrangement:'objects',footprints,quantities:{body:5,cap:5},copies:1,tower:true,spacing:5,padding:3.1});
const plan=planLayout(bounds,options);
assert.equal(plan.blocked,false);assert.equal(plan.placements.length,10);
const boxes=plan.placements.map(p=>{const f=footprints.find(f=>f.objectId===p.objectId);return {min:f.bounds.min.map((v,i)=>v+p.offset[i]-(i<2?3.1:0)),max:f.bounds.max.map((v,i)=>v+p.offset[i]+(i<2?3.1:0))};});
for(const b of boxes){
 for(let a=0;a<2;a++){assert(b.min[a]>=options.centre[a]-135+4-1e-6);assert(b.max[a]<=options.centre[a]+135-4+1e-6);}
 assert.equal(b.min[2],0);
 const t={min:[.5,201],max:[60.5,271]};
 assert(b.max[0]+5<=t.min[0]+1e-6||b.min[0]>=t.max[0]+5-1e-6||b.max[1]+5<=t.min[1]+1e-6||b.min[1]>=t.max[1]+5-1e-6);
}
for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
 const a=boxes[i],b=boxes[j];assert([0,1].some(k=>a.max[k]+5<=b.min[k]+1e-6||b.max[k]+5<=a.min[k]+1e-6));
}
assert.deepEqual(planLayout(bounds,options),plan);
assert.equal(planLayout(bounds,{...options,quantities:{body:0,cap:0}}).blocked,true);
assert.equal(planLayout(bounds,{...options,quantities:{body:64,cap:64}}).blocked,true);
assert.equal(planLayout(bounds,{...options,maxHeight:10}).blocked,true);
assert.equal(planLayout(bounds,{...options,quantities:{body:0,cap:2}}).placements.length,2);
const project={colors:['#FF8800','#FFFFFF','#000000','#008000','#FF00FF'],types:Array(5).fill('PLA'),filamentUsage:{kept:[1,2,3,4],unused:[5],reservedThrough:0}};
const session=new ConvertSession(()=>{});session.state={colours:project.colors,types:project.types,filamentUsage:project.filamentUsage,includeUnused:[],mixtures:[]};
for(const mode of [SLOTS,REPAINT])for(const mapping of [{1:1,2:2,3:3,4:4,5:5},{1:4,2:2,3:3,4:1,5:5}]){
 session.assignmentMode=mode;session.rules[mode]=mapping;
 const plan=conversionPalette(project,{target:'snapmaker',assignmentMode:mode,mapping,removeUnused:true});
 assert.deepEqual(session.printerPalette().map(r=>r.color),plan.physical.map(r=>r.color));
}
session.assignmentMode=SLOTS;session.rules[SLOTS]={1:4,2:2,3:3,4:1,5:5};session.state.filamentUsage={kept:[1],unused:[2,3,4,5],reservedThrough:0};
assert.deepEqual(session.printerPalette().map(r=>r?.color??null),[null,null,null,'#FF8800']);
session.target='bambu';assert.equal(session.printerPalette(),null);
assert.equal(session.setLayout({quantities:{body:1.5}}),false);
console.log('PASS separate object quantities, tower/edge/spacing, grounding, overflow, deterministic packing and printer/export palette agreement');
