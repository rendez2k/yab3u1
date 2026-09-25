import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {planBlends,mappingFromPlan,describeColourMapping,swapPaletteSlots} from '../shared/mix.js';
import {palette, snapmakerConfig, bambuConfig, validate} from '../shared/targets.js';
import {readZip} from '../zip.js';
import {readProject,analyse,exportProject} from '../shared/project.js';
const sources={1:'#FFFFFF',2:'#000000',3:'#C12E1F',4:'#0056B8',5:'#F7E6DE',6:'#FEC600'};
const reels=['#000000','#C12E1F','#0056B8','#F7E6DE'].map((color,i)=>({color,type:'PLA',name:'Reel '+i,profile:{id:i,type:"PLA",name:"Test PLA",vendor:"Generic",values:{}}}));
const getOutcome=(sources,p)=>{
 const plan=planBlends(sources,p.reels,true,p.slotOrder);
 return {plan,outcome:describeColourMapping(sources,{physical:p.reels,kept:plan.recipes,mapping:mappingFromPlan(plan)},true)};
};
const original={reels,approximate:true,outcome:getOutcome(sources,{reels}).outcome};
const signature=(outcome,reels)=>outcome.rows.map(row=>({source:row.source,kind:row.kind,result:row.result,
 ingredients:row.recipe ? [[reels[row.recipe.a-1].color,100-row.recipe.percent],[reels[row.recipe.b-1].color,row.recipe.percent]] : reels[row.slot-1].color}));
const expected=signature(original.outcome,reels);
function* permutations(values) {if(!values.length) yield []; else for(const v of values) for(const tail of permutations(values.filter(x=>x!==v))) yield [v,...tail];}
let count=0;
for(const order of permutations([0,1,2,3])) {
 let p=original;
 for(let i=0;i<4;i++) {const current=(p.slotOrder || [0,1,2,3]).indexOf(order[i]);p=swapPaletteSlots(p,i,current);}
 const {plan,outcome}=getOutcome(sources,p);
 assert.deepEqual(signature(outcome,p.reels),expected,'slot order must preserve appearance and recipe ingredients');
 assert.deepEqual(outcome,p.outcome,'card and export summary agree');
 assert.deepEqual(p.reels.map(r=>r.profile.id),order,'filament metadata follows the reel');
 const table=palette(p.reels.map(r=>r.color),p.reels.map(r=>r.type),plan.recipes);
 assert.deepEqual(table.virtual.map(r=>r.color),plan.recipes.map(r=>r.color),'writer keeps predicted shades');
 for(const target of ['snapmaker','bambu']) {
  const colors=p.reels.map(r=>r.color),types=p.reels.map(r=>r.type);
  const cfg=target==='snapmaker'?snapmakerConfig({},colors,types,plan.recipes):bambuConfig(colors,types,plan.recipes);
  assert.deepEqual(validate(target,cfg,4,plan.recipes),[]);
 }
 count++;
}
assert.deepEqual(original.reels,reels,'source palette is immutable');
assert.throws(()=>swapPaletteSlots(original,-1,1),/Invalid/);
assert.throws(()=>planBlends(sources,reels,true,[0,0,2,3]),/exactly once/);
const path='C:/Users/rende/Desktop/CATS3D.174 - SuperMan Final Cats3D Studio.3mf';
if(existsSync(path)) {
 const project=readProject(await readZip(readFileSync(path)),{allowNegative:true});
 const plate=project.plates[0].id, assessed=analyse(project,plate,null);
 let p={reels,approximate:true,outcome:getOutcome(assessed.sourceColors,{reels}).outcome};
 p=swapPaletteSlots(p,1,3); // Red to physical slot 4.
 const {plan}=getOutcome(assessed.sourceColors,p);
 for(const target of ['snapmaker','bambu']) {
  const out=exportProject(project,plate,null,{target,reels:p.reels,recipes:plan.recipes,mapping:mappingFromPlan(plan)});
  assert.deepEqual(out.problems,[]);
  const config=JSON.parse(new TextDecoder().decode(out.entries.get('Metadata/project_settings.config')));
  assert.deepEqual(config.filament_colour.slice(0,4).map(c=>c.slice(0,7)),p.reels.map(r=>r.color));
  assert.equal(config.filament_colour[3].slice(0,7),'#C12E1F');
  assert(plan.recipes.length>0,'fixture exercises virtual blends');
  const expectedConfig=target==='snapmaker' ? snapmakerConfig({},p.reels.map(r=>r.color),p.reels.map(r=>r.type),plan.recipes) : bambuConfig(p.reels.map(r=>r.color),p.reels.map(r=>r.type),plan.recipes);
  const recipeKey=target==='snapmaker' ? 'mixed_filament_definitions' : 'filament_mixed_components';
  assert.deepEqual(config[recipeKey],expectedConfig[recipeKey],'exported recipes refer to the arranged slots');
  if(target==='bambu') assert.deepEqual(config.filament_mixed_sublayer_ratios,expectedConfig.filament_mixed_sublayer_ratios);
  console.log('PASS real Superman export:',target,'red in slot 4 with blends');
 }
}
console.log('PASS',count,'slot permutations: colours, ratios, mapping, metadata, export formats and invalid input');

