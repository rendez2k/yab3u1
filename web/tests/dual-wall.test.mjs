import test from 'node:test';
import assert from 'node:assert/strict';
import * as paint from '../shared/paint.js';
import {applyDualWall,dualWallProblem,DUAL_WALL_PATH} from '../shared/dualWall.js';

const enc=new TextEncoder(),dec=new TextDecoder();
const leaf=n=>paint.encode({kind:'leaf',state:n});
// A split facet: one child painted in filament 3, the rest left unpainted.
const split=paint.encode({kind:'split',sides:1,specialSide:0,children:[{kind:'leaf',state:3},{kind:'leaf',state:0}]});
function project(){
  const model=`<model><resources>
<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="2" paint_color="${leaf(2)}"/><triangle v1="0" v2="1" v3="2" paint_color="${split}" paint_seam="4"/></triangles></mesh></object>
<object id="2" type="model"><mesh><vertices/><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
<object id="3" type="model"><mesh><vertices/><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
<object id="10" type="model"><components><component objectid="1"/><component objectid="2"/><component objectid="3"/></components></object>
</resources><build><item objectid="10"/></build></model>`;
  const settings=`<config><object id="10"><metadata key="name" value="Figure"/><metadata key="extruder" value="1"/><metadata key="wall_loops" value="1"/>
<part id="1" subtype="normal_part"><metadata key="name" value="Body"/><metadata key="extruder" value="1"/></part>
<part id="2" subtype="normal_part"><metadata key="name" value="Hat"/><metadata key="extruder" value="2"/></part>
<part id="3" subtype="modifier_part"><metadata key="name" value="Strong zone"/><metadata key="extruder" value="2"/></part></object></config>`;
  const cfg={filament_colour:['#00AEEFFF','#EC008CFF','#FFF200FF','#FFFFFFFF'],wall_loops:'1',mmu_segmented_region_max_width:'0',different_settings_to_system:['layer_height','']};
  return new Map([['3D/Objects/figure.model',enc.encode(model)],['Metadata/model_settings.config',enc.encode(settings)],['Metadata/project_settings.config',enc.encode(JSON.stringify(cfg))]]);
}
const paints=text=>[...text.matchAll(/<triangle[^>]*paint_color="([0-9A-F]*)"/gi)].map(m=>paint.walkStates(paint.decode(m[1])));

test('every outside face gets explicit paint in its own colour and the parts print in the inner filament',()=>{
  const entries=project(),before=dec.decode(entries.get('3D/Objects/figure.model'));
  const report=applyDualWall(entries,{target:'snapmaker',innerSlot:4,depth:0.45});
  const model=dec.decode(entries.get('3D/Objects/figure.model')),settings=dec.decode(entries.get('Metadata/model_settings.config'));
  // Body: unpainted -> 1, painted 2 untouched, split keeps 3 and fills its unpainted child with 1. Hat: unpainted -> 2.
  assert.deepEqual(paints(model),[[1],[2],[3,1],[2]]);
  // The modifier's mesh and role are left alone.
  assert(model.includes('<object id="3" type="model"><mesh><vertices/><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>'));
  assert.match(settings,/<part id="1" subtype="normal_part"><metadata key="name" value="Body"\/><metadata key="extruder" value="4"\/>/);
  assert.match(settings,/<part id="2" subtype="normal_part"><metadata key="name" value="Hat"\/><metadata key="extruder" value="4"\/>/);
  assert.match(settings,/<part id="3" subtype="modifier_part"><metadata key="name" value="Strong zone"\/><metadata key="extruder" value="2"\/>/);
  assert.match(settings,/<object id="10"><metadata key="name" value="Figure"\/><metadata key="extruder" value="4"\/><metadata key="wall_loops" value="2"\/>/);assert.equal(report.objectsRaisedToTwoWalls,1);
  // Geometry and other facet attributes are untouched.
  assert.equal(model.replace(/ paint_color="[^"]*"/g,''),before.replace(/ paint_color="[^"]*"/g,''));
  assert(model.includes('paint_seam="4"'));
  assert.deepEqual([report.parts,report.meshes,report.faces,report.facesGivenExplicitPaint],[2,2,4,3]);
});
test('the project limits paint to the outer depth and allows an inner wall',()=>{
  const entries=project();applyDualWall(entries,{target:'bambu',innerSlot:3,depth:0.6});
  const cfg=JSON.parse(dec.decode(entries.get('Metadata/project_settings.config')));
  assert.equal(cfg.mmu_segmented_region_max_width,'0.6');assert.equal(cfg.mmu_segmented_region_interlocking_depth,'0');assert.equal(cfg.wall_loops,'2');
  assert.equal(cfg.different_settings_to_system[0],'layer_height;mmu_segmented_region_interlocking_depth;mmu_segmented_region_max_width;wall_loops');
  const manifest=JSON.parse(dec.decode(entries.get(DUAL_WALL_PATH)));
  assert.equal(manifest.innerColour,'#FFF200');assert.equal(manifest.outerDepth,0.6);assert.deepEqual(manifest.validation,{sliced:false,printed:false});
});
test('more than one wall is left as the user set it, and running twice changes nothing more',()=>{
  const entries=project();const cfg=JSON.parse(dec.decode(entries.get('Metadata/project_settings.config')));cfg.wall_loops='3';entries.set('Metadata/project_settings.config',enc.encode(JSON.stringify(cfg)));
  applyDualWall(entries,{target:'orca',innerSlot:4,depth:0.45});
  const once=dec.decode(entries.get('3D/Objects/figure.model'));
  const again=applyDualWall(entries,{target:'orca',innerSlot:4,depth:0.45});
  assert.equal(JSON.parse(dec.decode(entries.get('Metadata/project_settings.config'))).wall_loops,'3');
  // Second pass: parts now sit on the inner filament, and no face is unpainted any more.
  assert.equal(dec.decode(entries.get('3D/Objects/figure.model')),once);assert.equal(again.facesGivenExplicitPaint,0);
});
test('unsuitable requests are refused before anything is written',()=>{
  assert.match(dualWallProblem({target:'prusa',innerSlot:1,depth:0.45,filaments:4}),/Snapmaker Orca, Bambu Studio or OrcaSlicer/);
  assert.match(dualWallProblem({target:'snapmaker',innerSlot:5,depth:0.45,filaments:4}),/loaded filaments/);
  assert.match(dualWallProblem({target:'snapmaker',innerSlot:1,depth:2,filaments:4}),/0.3 to 1.2 mm/);
  assert.equal(dualWallProblem({target:'snapmaker',innerSlot:1,depth:0.45,filaments:4}),'');
  const entries=project(),before=dec.decode(entries.get('Metadata/model_settings.config'));
  assert.throws(()=>applyDualWall(entries,{target:'snapmaker',innerSlot:9,depth:0.45}),/loaded filaments/);
  assert.equal(dec.decode(entries.get('Metadata/model_settings.config')),before);assert(!entries.has(DUAL_WALL_PATH));
  assert.throws(()=>applyDualWall(new Map(),{target:'snapmaker',innerSlot:1}),/native slicer project/);
});

// The real exporter, then the rewrite, then a fresh read of the result.
import {readFileSync} from 'node:fs';
import {readZip} from '../zip.js';
import {readProject,exportProject,analyse} from '../shared/project.js';
test('a real Full Spectrum export stays a valid project with every face painted and the same colours in use',async()=>{
  const source=readProject(await readZip(new Uint8Array(readFileSync(new URL('./wide-quad.3mf',import.meta.url)))));
  const plate=source.plates[0].id,reels=[...source.colors,'#FFF200','#FFFFFF'].map((color,i)=>({color,type:'PLA',name:`Reel ${i+1}`}));
  assert.equal(reels.length,4);
  const built=exportProject(source,plate,null,{target:'snapmaker',reels,recipes:[],mapping:Object.fromEntries(source.colors.map((_,i)=>[i+1,i+1])),u1Nozzle:'0.4'});
  assert.deepEqual(built.problems,[]);
  const usedBefore=analyse(readProject(new Map(built.entries)),readProject(new Map(built.entries)).plates[0].id,null).used.map(u=>u.id??u.extruder??u).sort();
  const report=applyDualWall(built.entries,{target:'snapmaker',innerSlot:4,depth:0.45});
  assert(report.faces>0);assert(report.meshes>0);
  const again=readProject(new Map(built.entries)),after=analyse(again,again.plates[0].id,null);
  // No face is left to fall back on the inner filament.
  let unpainted=0,total=0;
  for(const [name,data] of built.entries)if(/^3D\/.*\.model$/.test(name))for(const m of new TextDecoder().decode(data).matchAll(/<triangle\b([^>]*)\/>/g)){total++;const p=/paint_color="([0-9A-F]+)"/i.exec(m[1]);if(!p||paint.walkStates(paint.decode(p[1])).includes(0))unpainted++;}
  assert.equal(total,report.faces);assert.equal(unpainted,0);
  // The outside still uses the colours it used before; the inner filament is in use as well.
  const usedAfter=after.used.map(u=>u.id??u.extruder??u).sort();
  for(const id of usedBefore)assert(usedAfter.includes(id),`colour ${id} still used`);
  const cfg=JSON.parse(new TextDecoder().decode(built.entries.get('Metadata/project_settings.config')));
  assert.equal(cfg.mmu_segmented_region_max_width,'0.45');
});
