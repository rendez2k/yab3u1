import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FILAMENT_BUNDLES,bundleFit,bundleReels,validateBundle} from '../shared/filamentBundles.js';
import {substituteReel,reelIdentity} from '../shared/filamentIdentity.js';
import {recommendWorkflow} from '../shared/recommend.js';
import {describeColourMapping,planBlends,mappingFromPlan} from '../shared/mix.js';
import {validateCalibration,matchesCalibration} from '../shared/blendCalibration.js';
import {calibrationSwatches} from '../shared/calibrationSwatches.js';
import {readColourExportPlan,EXPORT_PLAN_PATH} from '../shared/exportPlan.js';
import {readProject,exportProject} from '../shared/project.js';
import {readZip} from '../zip.js';
import {FDM_MODEL} from '../shared/fdmMix.js';
const reels=['#FF0000','#0080C0','#FFFFFF','#000000','#00FF00'].map((color,i)=>({color,type:'PLA',productId:'test/'+i,name:'Test '+i}));
const sources=Object.fromEntries(reels.map((r,i)=>[i+1,r.color]));

test('purchased CMYK lithophane packs contain white, keep brand identity and respect PETG capacity',()=>{
  for(const id of ['elegoo-rilievo','esun-pla-plus-cmyk']){
    const b=FILAMENT_BUNDLES.find(b=>b.id===id);assert.equal(b.kind,'retail');assert.equal(b.application,'backlit');assert.equal(b.calibration,'unmeasured');
    assert.deepEqual(b.reels.map(r=>r.name.replace(b.brand+' ','')),['Cyan','Magenta','Yellow','White']);
    assert(b.reels.every(r=>r.swatchSource==='nominal display colour'));assert.equal(bundleFit(b,4).fits,true);assert.equal(bundleFit(b,4,true).fits,false);
    const sample={1:'#000000',2:'#F72323',3:'#FFF144',4:'#FFFFFF',5:'#61C680'};
    const excluded=recommendWorkflow({sources:sample,capacity:4,bundles:[b]});assert.equal(excluded.found,false);assert.equal(excluded.approximateOptions.length,0);
    const explicit=recommendWorkflow({sources:sample,capacity:4,bundles:[{...b,allowModelPreview:true}]});assert(explicit.found||explicit.approximateOptions.length>0,'explicit uncalibrated preview must be usable');
  }
});
const machine={name:'Bambu Lab Test 0.4 nozzle',printer_model:'Bambu Lab Test',printer_variant:'0.4',nozzle_diameter:['0.4','0.4'],min_layer_height:['0.08'],max_layer_height:['0.28']};
const setup={machine,process:{name:'Test process',layer_height:'0.2'},materials:{PLA:{name:'Generic PLA',filament_type:['PLA'],compatible_printers:[machine.name],filament_extruder_variant:['Standard','High Flow'],nozzle_temperature:['220','225']}},bed:{width:256,depth:256,maxHeight:256}};
const project=readProject(await readZip(new Uint8Array(readFileSync('web/tests/single-object.3mf'))));
test('bundle editions retain different identities even with identical display colours',()=>{
 const a=FILAMENT_BUNDLES.find(b=>b.id==='snapmaker-white'),b=FILAMENT_BUNDLES.find(b=>b.id==='snapmaker-gray');
 assert.notEqual(reelIdentity(a.reels[0]),reelIdentity(b.reels[0]));
 assert.equal(bundleFit(a,4,true).fits,false);
 assert.throws(()=>bundleReels(a,4,{role:'support-interface',type:'PETG',color:'#FFFFFF'}),/3 available/);
 assert.equal(substituteReel(a.reels[0],{color:'#123456'}).productId,undefined);
 assert.equal(validateBundle({name:'Own pack',reels:a.reels,script:'bad'}).script,undefined);
});
test('five physical colours stay exact; recipe IDs start after the fifth reel',()=>{
 const r=recommendWorkflow({mode:'loaded',sources,loaded:reels,capacity:5,visibleLimit:24});
 assert.equal(r.outcome.counts.preserved,5);assert.equal(r.outcome.blendCount,0);
 const mixed=planBlends({...sources,6:'#AA7777'},reels,true);
 const mapping=mappingFromPlan(mixed);
 const outcome=describeColourMapping({...sources,6:'#AA7777'},{mapping,physical:reels,kept:mixed.recipes},true);
 assert.equal(outcome.rows[4].kind,'preserved');assert(mixed.recipes.every(r=>r.id>5));
});
test('bundle comparisons honour capacity, exact products and explicit recipe budget',()=>{
 const b={id:'test',name:'Five colour set',reels,application:'model'};
 assert.equal(recommendWorkflow({sources,capacity:4,bundles:[b]}).found,false);
 const r=recommendWorkflow({sources,capacity:5,bundles:[b],visibleLimit:24});assert.equal(r.bundleId,'test');assert.deepEqual(r.reels,reels);
 const fixed=recommendWorkflow({mode:'loaded',sources:{...sources,6:'#A03050'},loaded:reels,capacity:5,visibleLimit:5});assert.equal(fixed.found,false);
});
test('measured surface, edition and same-hex substitutions cannot cross-calibrate',()=>{
 const p=validateCalibration({version:2,surface:'wall',name:'Wall test',setup:'Same temperatures and light',context:'printer .4 .1 subdivide on',reels,revision:3,samples:[{a:1,b:2,percent:25,color:'#A03050'}]});
 assert(matchesCalibration(p,reels,'wall'));assert(!matchesCalibration(p,reels,'top'));
 assert(!matchesCalibration(p,reels.map((r,i)=>i? r:{...r,productId:'other-red'}),'wall'));
 assert.equal(p.revision,3);assert.equal(p.reels[0].productId,'test/0');
});
test('native Bambu blends preserve both extruder variants, explicit layer and provenance',()=>{
 const recipes=[{a:1,b:2,percent:25,model:FDM_MODEL}];
 const out=exportProject(project,1,null,{target:'bambu',bambuSetup:setup,reels,recipes,mapping:{1:6},subdivideMixLayer:true,preserveSourceSettings:true,layerHeight:{mode:'custom',value:'0.16'}});
 assert.deepEqual(out.problems,[]);
 const cfg=JSON.parse(new TextDecoder().decode(out.entries.get('Metadata/project_settings.config')));
 assert.equal(cfg.filament_colour.length,6);assert.equal(cfg.filament_mixed_components[5],'1,2');
 assert.equal(cfg.nozzle_temperature.length,12);assert.deepEqual(cfg.nozzle_temperature.slice(-2),['220','225']);
 assert.deepEqual(cfg.filament_self_index.slice(-2),['6','6']);assert.equal(cfg.nozzle_diameter.length,2);
 assert.equal(cfg.layer_height,'0.16');assert.equal(cfg.enable_mixed_color_sublayer,'1');
 const saved=readColourExportPlan(out.entries.get(EXPORT_PLAN_PATH));assert.equal(saved.reels[0].productId,'test/0');assert.equal(saved.layerHeight.value,'0.16');
 assert.equal(readProject(out.entries).colourPlan.reels.length,5);
 const fresh=exportProject(project,1,null,{target:'bambu',bambuSetup:setup,reels,recipes,mapping:{1:6},subdivideMixLayer:true,preserveSourceSettings:false,layerHeight:{mode:'custom',value:'0.16'}});
 const freshCfg=JSON.parse(new TextDecoder().decode(fresh.entries.get('Metadata/project_settings.config')));
 assert.equal(freshCfg.layer_height,'0.16','explicit layer height survives disabling source settings');
 assert(freshCfg.different_settings_to_system[0].includes('layer_height'));
 assert(freshCfg.different_settings_to_system[0].includes('enable_mixed_color_sublayer'));
});
test('wall calibration generates tall coupons and records subdivision separately from top faces',async()=>{
 const zip=await readZip(await calibrationSwatches({target:'bambu',bambuSetup:{...setup,bed:{width:180,depth:180,maxHeight:180}},reels,a:1,b:2,surface:'wall',height:.16,subdivideMixLayer:true}));
 const xml=new TextDecoder().decode(zip.get('3D/Objects/object_inline.model'));
 assert(xml.includes('z="20"'));
 for(const point of xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)"/g))assert(Number(point[1])>0&&Number(point[1])<180&&Number(point[2])>0&&Number(point[2])<180,'coupons fit the A1 mini bed');
 const note=new TextDecoder().decode(zip.get('Metadata/YAB3D_calibration.txt'));
 assert(note.includes('vertical front faces'));assert(note.includes('Subdivision: on'));
});
test('untrusted colour plan is bounded data and does not enable its calibration',()=>{
 assert.equal(readColourExportPlan(new TextEncoder().encode('{"version":1,"target":"javascript:bad"}')),null);
 assert.equal(readColourExportPlan(new Uint8Array(131073)),null);
});
