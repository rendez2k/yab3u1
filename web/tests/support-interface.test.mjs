import {ConvertSession} from '../shared/convertSession.js';
import {conversionPalette} from '../shared/assignment.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {interfaceDemoFile} from '../shared/supportInterfaceDemo.js';
import {interfacePalette,INTERFACE_SETTINGS,interfaceSlot,validateInterfaceExport} from '../shared/supportInterface.js';
import {recommendWorkflow} from '../shared/recommend.js';
import {planBlends,mappingFromPlan,swapPaletteSlots,describeColourMapping} from '../shared/mix.js';
import {readProject,analyse,exportProject,convertProject} from '../shared/project.js';
import {readZip} from '../zip.js';

const project=readProject(await readZip(await interfaceDemoFile()));
const plate=project.plates[0].id;
const sources=analyse(project,plate,null).sourceColors;
const all=r=>[...(r.found?[r,...r.alternatives]:[]),...r.approximateOptions];
const result=recommendWorkflow({sources,loaded:[],supportInterface:true});
const options=all(result), chosen=options[0];
const plan=planBlends(sources,chosen.reels,chosen.approximate);
const exportOptions={target:'snapmaker',reels:chosen.reels,mapping:mappingFromPlan(plan),recipes:plan.recipes,supportInterface:true};
const decode=b=>new TextDecoder().decode(b);

test('generated arch searches four choose three model palettes, reserving PETG',()=>{
  assert.equal(Object.keys(sources).length,4);
  assert.equal(result.search.evaluated,4);
  assert.ok(options.length);
  for(const p of options) {
    assert.deepEqual(p.reels.map(r=>r.type),['PLA','PLA','PLA','PETG']);
    assert.equal(p.reels[3].role,'support-interface');
    assert.equal(p.outcome.counts.preserved,3);
    assert.equal(p.outcome.counts.blended,1);
    assert(p.outcome.rows.every(r=>r.slot!==4 && (!r.recipe || r.recipe.a!==4&&r.recipe.b!==4)));
  }
});
test('white PETG can never match a white model region; keep-exact excludes PETG',()=>{
  const reels=interfacePalette(['#000000','#FF0000','#0000FF','#FFFFFF'].map(color=>({color,type:'PLA'})),true);
  const p=planBlends({1:'#FFFFFF'},reels,true);
  assert.notEqual(p.rows[0].solid.slot,4);
  assert(p.recipes.every(r=>r.a<4&&r.b<4));
  assert.equal(all(recommendWorkflow({mode:'loaded',sources:{1:'#FFFFFF'},loaded:reels,supportInterface:true,keepExact:['#FFFFFF']})).length,0);
  assert.throws(()=>recommendWorkflow({sources,loaded:[],supportInterface:true,keepExact:Object.values(sources)}),/at most 3/);
});
test('swapping model slots preserves blends',()=>{
  const p=swapPaletteSlots(chosen,0,2);
  const shifted=planBlends(sources,p.reels,p.approximate,p.slotOrder);
  const outcome=describeColourMapping(sources,{physical:p.reels,mapping:mappingFromPlan(shifted),kept:shifted.recipes},true);
  assert.deepEqual(outcome.rows.map(r=>r.result),chosen.outcome.rows.map(r=>r.result));

});
test('native U1 config and object overrides retain interface settings and PETG profile',()=>{
  // Conflicting object overrides must not silently disable the new mode.
  const meta=project.meta.get('10');
  meta.settings={...meta.settings,enable_support:'0',support_top_z_distance:'0.3',support_interface_top_layers:'0'};
  const out=exportProject(project,plate,null,exportOptions);
  assert.deepEqual(out.problems,[]);
  const cfg=JSON.parse(decode(out.entries.get('Metadata/project_settings.config')));
  for(const [k,v] of Object.entries(INTERFACE_SETTINGS)) {
    assert.equal(cfg[k],v,k);
    assert(cfg.different_settings_to_system[0].split(';').includes(k),k+' override');
    assert(decode(out.entries.get('Metadata/model_settings.config')).includes(`key="${k}" value="${v}"`),k+' object');
  }
  assert.equal(cfg.wipe_tower_filament,'1');
  assert.equal(cfg.enable_prime_tower,'1');
  assert.equal(cfg.filament_type[3],'PETG');
  assert.match(cfg.filament_settings_id[3],/PETG/);
  assert.notEqual(cfg.nozzle_temperature[3],cfg.nozzle_temperature[0]);
  assert.equal(cfg.filament_colour.length,4);
  assert.equal(cfg.filament_soluble[3],'0');
  assert.equal(out.settings.supportInterface,true);
});
test('export refuses PETG paint, PETG blends, wrong materials, wrong target and implicit PETG paint',()=>{
  for(const bad of [
    {mapping:{...exportOptions.mapping,1:4}},
    {recipes:[{a:1,b:4,percent:50}]},
    {reels:chosen.reels.map((r,i)=>i===0?{...r,type:'PETG'}:r)},
    {target:'bambu'}, {supportMode:'off'}, {mapping:{}},
  ]) assert.throws(()=>exportProject(project,plate,null,{...exportOptions,...bad}));
});
test('ordinary four-colour mode keeps all four model colours',()=>{
  const normal=recommendWorkflow({sources,loaded:[]});
  assert.equal(normal.outcome.counts.preserved,4);
  assert.equal(normal.outcome.counts.blended,0);
  assert(normal.reels.every(r=>!r.role));
});
test('loaded PETG keeps its real colour and profile while the model slots stay fixed',()=>{
  const loaded=[{color:'#FFFFFF',type:'PLA'},{color:'#000000',type:'PLA'},{color:'#B50020',type:'PLA'},
    {color:'#0000FF',type:'PETG',name:'My blue PETG',profile:{name:'PETG preset'}}];
  const r=recommendWorkflow({sources,loaded,supportInterface:true,mode:'loaded'});
  assert.equal(r.search.evaluated,1);
  for(const p of all(r)) {
    assert.deepEqual(p.reels.slice(0,3),loaded.slice(0,3).map(r=>({...r,role:undefined})));
    assert.deepEqual(p.reels[3],{...loaded[3],role:'support-interface'});
  }
  assert.deepEqual(loaded[3].profile,{name:'PETG preset'});
});

for(let index=0;index<4;index++) test(`PETG in slot ${index+1}: blends, suggestions and exported support selectors follow`,()=>{
  const palette=swapPaletteSlots(chosen,3,index);
  assert.equal(interfaceSlot(interfacePalette(palette.reels,true)),index+1);
  const plan=planBlends(sources,palette.reels,palette.approximate,palette.slotOrder);
  const mapping=mappingFromPlan(plan);
  const outcome=describeColourMapping(sources,{physical:palette.reels,mapping,kept:plan.recipes},true);
  assert.deepEqual(outcome.rows.map(r=>r.result),chosen.outcome.rows.map(r=>r.result));
  assert(!Object.values(mapping).includes(index+1));
  assert(plan.recipes.every(r=>r.a!==index+1&&r.b!==index+1));
  for(const mode of ['model','loaded']) {
    const suggestions=all(recommendWorkflow({mode,sources,loaded:palette.reels,supportInterface:true}));
    assert(suggestions.length);
    assert(suggestions.every(p=>interfaceSlot(p.reels)===index+1 && p.type==='PLA'));
  }
  const settings={...exportOptions,physical:palette.reels,mapping,recipes:plan.recipes};
  const out=exportProject(project,plate,null,settings);
  assert.deepEqual(out.problems,[]);
  const cfg=JSON.parse(decode(out.entries.get('Metadata/project_settings.config')));
  const base=index===0?'2':'1';
  assert.equal(cfg.support_interface_filament,String(index+1));
  assert.equal(cfg.support_filament,base);
  assert.equal(cfg.wipe_tower_filament,base);
  assert.equal(cfg.filament_type[index],'PETG');
  assert.match(cfg.filament_settings_id[index],/PETG/);
  const objects=decode(out.entries.get('Metadata/model_settings.config'));
  assert(objects.includes(`key="support_interface_filament" value="${index+1}"`));
  assert(objects.includes(`key="support_filament" value="${base}"`));
  assert.throws(()=>validateInterfaceExport({target:'snapmaker',reels:palette.reels,mapping:{1:index+1}}),/reserved/);
  assert.throws(()=>validateInterfaceExport({target:'snapmaker',reels:palette.reels,recipes:[{a:index+1,b:index===0?2:1}]}),/reserved/);
  const white=planBlends({1:palette.reels[index].color},palette.reels,true);
  assert.notEqual(white.rows[0].solid.slot,index+1);
});

test('main converter requires an explicit merge; writes three PLA colours and PETG in slot two',()=>{
  assert.throws(()=>convertProject(project,plate,null,{target:'snapmaker',assignmentMode:'repaint',removeUnused:true,supportInterface:true}),/Merge/);
  const out=convertProject(project,plate,null,{target:'snapmaker',assignmentMode:'repaint',removeUnused:true,
    mapping:{1:1,2:2,3:3,4:2},supportInterface:true,interfaceSlot:2,interfaceColor:'#ABCDEF'});
  assert.deepEqual(out.problems,[]);
  const cfg=JSON.parse(decode(out.entries.get('Metadata/project_settings.config')));
  assert.equal(cfg.support_interface_filament,'2');
  assert.deepEqual(cfg.filament_type,['PLA','PETG','PLA','PLA']);
  assert.equal(cfg.filament_colour[1],'#ABCDEFFF');
  assert.equal(out.mapping[4],out.mapping[2]);
  assert(!Object.values(out.mapping).includes(2));
  assert.equal(out.settings.supportInterface,true);
});
test('one or two model colours need no merge and never use PETG for model geometry',()=>{
  for(const count of [1,2,3]) {
    const plan=conversionPalette({colors:Array(count).fill('#123456'),types:Array(count).fill('PLA')},
      {target:'snapmaker',supportInterface:true,interfaceSlot:1,assignmentMode:'repaint'});
    assert.equal(plan.physical.length,4);assert.equal(plan.physical[0].type,'PETG');
    assert(!Object.values(plan.mapping).includes(1));
    assert.equal(plan.occupiedSlots.length,count+1);
  }
});
test('choosing 0.16 mm overrides the 0.10 mm mixing profile globally and on objects',()=>{
  const out=exportProject(project,plate,null,{...exportOptions,layerHeight:{mode:'custom',value:'0.16'}});
  const cfg=JSON.parse(decode(out.entries.get('Metadata/project_settings.config')));
  assert.match(cfg.print_settings_id,/0.10mm Color Mixing/);
  assert.equal(cfg.layer_height,'0.16');
  assert(decode(out.entries.get('Metadata/model_settings.config')).includes('key="layer_height" value="0.16"'));
  assert(cfg.different_settings_to_system[0].split(';').includes('layer_height'));
});
test('subdividing a U1 blend is explicit and preserves PETG, layer height and recipes',()=>{
  const readCfg=out=>JSON.parse(decode(out.entries.get('Metadata/project_settings.config')));
  const base={...exportOptions,layerHeight:{mode:'custom',value:'0.16'}};
  const off=exportProject(project,plate,null,base),on=exportProject(project,plate,null,{...base,subdivideMixLayer:true});
  const a=readCfg(off),b=readCfg(on);
  assert.equal(a.dithering_local_z_mode,'0');assert.equal(b.dithering_local_z_mode,'1');
  assert(b.different_settings_to_system[0].split(';').includes('dithering_local_z_mode'));
  assert.equal(b.layer_height,'0.16');assert.equal(b.mixed_filament_definitions,a.mixed_filament_definitions);
  assert.equal(b.support_interface_filament,a.support_interface_filament);
  assert.deepEqual(b.filament_type,a.filament_type);
  assert.equal(on.settings.subdivideMixLayer,true);
  assert.throws(()=>exportProject(project,plate,null,{...base,target:'bambu',subdivideMixLayer:true}),/PETG support interface requires/);
  assert.throws(()=>exportProject(project,plate,null,{...base,recipes:[],subdivideMixLayer:true}),/Subdivide Mix Layer requires/);
});
test('session blocks unresolved PETG exports, snapshots the role and clears it on new files',async()=>{
  const calls=[],errors=[];
  const worker={dispose(){},load:async()=>({meta:{kind:'bambu',title:'Four',colors:['#FFFFFF','#000000','#FF0000','#00FF00'],types:Array(4).fill('PLA'),plates:[{id:1}]},summary:{}}),
    convert:async(...args)=>{calls.push(args);return {bytes:new Uint8Array([1]),settings:{supportInterface:true}};}};
  const s=new ConvertSession(()=>worker,{error:m=>errors.push(m)},{create:()=> 'blob:test',revoke(){}});
  const file={name:'test.3mf',arrayBuffer:async()=>new ArrayBuffer(8)};await s.load(file);
  s.setInterface(true,2);s.setKeepAll(true);assert(s.capacityStatus().blocked);
  assert.equal(await s.convert('snapmaker',1),null);
  assert(s.mergeColours(4,2));assert(!s.capacityStatus().blocked);
  assert.equal(s.printerPalette()[1].type,'PETG');
  assert(await s.convert('snapmaker',1));assert.equal(calls[0][5].interfaceSlot,2);assert.equal(calls[0][5].supportInterface,true);
  // Experimenting must restore the original colours and discard the old export.
  assert(s.canUndoMerge()); assert(s.undoMerge()); assert.equal(s.output,null);
  assert.equal(s.rule[4],4); assert(s.capacityStatus().blocked); assert(!s.canUndoMerge());
  assert.equal(s.interfaceSlot,2); assert(s.supportInterface);
  assert(s.mergeColours(1,3)); assert.equal(s.rule[4],4); assert.equal(s.rule[1],3);
  assert(!s.capacityStatus().blocked);
  assert(s.mergeColours(4,2)); assert(s.undoMerge()); assert.equal(s.rule[1],3);
  assert(s.undoMerge()); assert.deepEqual(s.rule,{1:1,2:2,3:3,4:4});
  assert(s.mergeColours(4,2)); s.setSource(1,3);
  assert(!s.canUndoMerge()); assert(!s.undoMerge()); assert.equal(s.rule[1],3);
  s.reset(); assert(!s.canUndoMerge());
  assert(s.mergeColours(4,2));
  s.setInterface(true,3);assert.equal(s.output,null);
  s.setTarget('bambu');assert(!s.supportInterface);
  s.setTarget('snapmaker');s.setInterface(true);await s.load(file);assert(!s.supportInterface);assert(!s.canUndoMerge());assert.deepEqual(errors,[]);
});
