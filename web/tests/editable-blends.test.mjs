import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readZip} from '../zip.js';
import {readProject,exportProject} from '../shared/project.js';
import {applyManualRecipes,validateRecipe,recipeColour,recipeParts,gradientShare} from '../shared/blendRecipes.js';
import {readColourExportPlan,EXPORT_PLAN_PATH} from '../shared/exportPlan.js';
import {outputTools} from '../shared/printOptimiser.js';
import {FDM_MODEL} from '../shared/fdmMix.js';
const reels=['#009BC3','#C9378C','#F6B921','#FFFFFF'].map(color=>({color,type:'PLA'}));
const project=readProject(await readZip(new Uint8Array(readFileSync('web/tests/single-object.3mf'))));
const two={a:1,b:3,percent:63,model:FDM_MODEL};
const three={a:1,b:2,c:3,percent:25,percentC:40,model:FDM_MODEL};
const gradient={a:1,b:3,percent:50,model:FDM_MODEL,gradient:{start:90,end:10,curve:'smooth',perPart:true}};
const cfg=output=>JSON.parse(new TextDecoder().decode(output.entries.get('Metadata/project_settings.config')));
test('manual recipes compact virtual IDs without changing physical slots or unrelated colours',()=>{
  const base={physical:reels,kept:[{...two,color:'#123456'}],mapping:{1:1,2:5,3:3,4:5}};
  const plan=applyManualRecipes(base,{2:three,4:three},reels,'orca',16);
  assert.deepEqual(plan.mapping,{1:1,2:5,3:3,4:5});assert.equal(plan.recipes.length,1);
  assert.deepEqual(recipeParts(plan.recipes[0]),[{slot:1,percent:35},{slot:2,percent:25},{slot:3,percent:40}]);
  assert.deepEqual(base.mapping,{1:1,2:5,3:3,4:5});assert.equal(plan.kept[0].measuredColor,undefined);
  assert.throws(()=>applyManualRecipes(base,{1:three},reels,'orca',5),/exceed/);
});
test('invalid ingredients, percentages, materials and unsupported formats stop export',()=>{
  for(const r of [{...two,b:1},{...two,b:5},{...three,percentC:75},{...three,percentC:NaN},{...two,percent:12.5}])
    assert.throws(()=>validateRecipe(r,4,'orca'));
  assert.throws(()=>exportProject(project,1,null,{target:'prusa',reels,mapping:{1:5},recipes:[three]}),/Three-filament/);
  // Snapmaker writes a three-filament blend as an explicit run of layers.
  const baked=cfg(exportProject(project,1,null,{target:'snapmaker',reels,mapping:{1:5},recipes:[three]}));
  assert.match(baked.mixed_filament_definitions.split(';')[0],/^1,2,1,1,\d+,0,g123,w[\d/]+,m0,.*,cm1,[123]+$/);
  assert.throws(()=>exportProject(project,1,null,{target:'bambu',reels,mapping:{1:5},recipes:[gradient],subdivideMixLayer:true}),/Gradients need OrcaSlicer/);
  assert.throws(()=>exportProject(project,1,null,{target:'orca',reels:[reels[0],{...reels[1],type:'PETG'},...reels.slice(2)],mapping:{1:5},recipes:[three]}),/same material/);
  assert.throws(()=>applyManualRecipes({kept:[],mapping:{1:1}},{1:two},reels.map((r,i)=>i===2?{...r,role:'support-interface'}:r),'orca',16),/Reserved support/);
});
test('two and three ingredients export native arrays and retain exact provenance',()=>{
  for(const target of ['bambu','orca']){
    const result=exportProject(project,1,null,{target,reels,mapping:{1:5},recipes:[two,three],subdivideMixLayer:true});
    const c=cfg(result);
    assert.deepEqual(c.filament_is_mixed,['0','0','0','0','1','1']);
    assert.deepEqual(c.filament_mixed_components,['','','','','1,3','1,2,3']);
    assert.deepEqual(c.filament_mixed_sublayer_ratios,['','','','','0.37,0.63','0.35,0.25,0.4']);
    assert.equal(c.enable_mixed_color_sublayer,'1');assert.equal(c.nozzle_diameter,undefined);
    assert.deepEqual(readColourExportPlan(result.entries.get(EXPORT_PLAN_PATH)).recipes,[two,three]);
    assert.equal(c.filament_colour[5],recipeColour(three,reels.map(r=>r.color))+'FF');
  }
});
test('gradients preserve direction, smooth endpoints and per-part scope, and require sublayers',()=>{
  assert.throws(()=>exportProject(project,1,null,{target:'orca',reels,mapping:{1:5},recipes:[gradient]}),/require Mixed Colour Sublayer/);
  const result=exportProject(project,1,null,{target:'orca',reels,mapping:{1:5},recipes:[gradient],subdivideMixLayer:true});
  const c=cfg(result);assert.equal(c.filament_mixed_gradient.at(-1),'1');assert.equal(c.filament_mixed_gradient_per_part.at(-1),'1');
  assert.equal(c.filament_mixed_gradient_range.at(-1),'0.9,0.1');assert.equal(c.filament_mixed_gradient_curve.at(-1),'0,0.9,0,0|1,0.1,0,0');
  assert.equal(gradientShare(gradient,0),90);assert.equal(gradientShare(gradient,1),10);assert.equal(gradientShare(gradient,.5),50);
  assert.deepEqual(readColourExportPlan(result.entries.get(EXPORT_PLAN_PATH)).recipes,[gradient]);
  const reverse={...gradient,gradient:{start:10,end:90,curve:'linear',perPart:false}};
  const r=cfg(exportProject(project,1,null,{target:'orca',reels,mapping:{1:5},recipes:[reverse],subdivideMixLayer:true}));
  assert.equal(r.filament_mixed_gradient_range.at(-1),'0.1,0.9');assert.equal(r.filament_mixed_gradient_curve.at(-1),'');assert.equal(r.filament_mixed_gradient_per_part.at(-1),'0');
});
test('Snapmaker pair schema stays unchanged and three-material parts cannot enter a single-colour group',()=>{
  const c=cfg(exportProject(project,1,null,{target:'snapmaker',reels,mapping:{1:5},recipes:[two],subdivideMixLayer:true}));
  assert(c.mixed_filament_definitions.startsWith('1,3,1,1,63,'));assert.equal(c.filament_colour.length,4);assert.equal(c.dithering_local_z_mode,'1');
  assert.deepEqual(outputTools({colours:[{extruder:1}]},{1:5},[{...three,id:5}]),[1,2,3]);
});
