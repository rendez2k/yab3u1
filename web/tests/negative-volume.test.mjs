import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {snapmakerConfig} from '../shared/targets.js';
import {readZip} from '../zip.js';
import * as p from '../shared/project.js';
const enc=new TextEncoder(), dec=new TextDecoder();
const mesh=(id,z)=>`<object id="${id}" type="model"><mesh><vertices><vertex x="0" y="0" z="${z}"/><vertex x="10" y="0" z="${z}"/><vertex x="0" y="10" z="${z+10}"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;
function fixture(role='negative_part') {
 return new Map([
 ['3D/3dmodel.model',enc.encode(`<model unit="millimeter"><resources><object id="9" type="model"><components><component p:path="/3D/Objects/parts.model" objectid="1"/><component p:path="/3D/Objects/parts.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 2 3 -50"/></components></object></resources><build><item objectid="9"/></build></model>`)],
 ['3D/Objects/parts.model',enc.encode(`<model unit="millimeter"><resources>${mesh(1,0)}${mesh(2,-20)}</resources></model>`)],
 ['Metadata/model_settings.config',enc.encode(`<config><object id="9"><metadata key="name" value="cutout fixture"/><part id="1" subtype="normal_part"><metadata key="name" value="body"/></part><part id="2" subtype="${role}"><metadata key="name" value="cutter"/></part></object></config>`)],
 ['Metadata/project_settings.config',enc.encode(JSON.stringify({filament_colour:['#FFFFFF'],filament_type:['PLA']}))]
 ]);
}
assert.throws(()=>p.readProject(fixture()),/negative cutout/,'recolour workflow stays guarded');
assert.throws(()=>p.readProject(fixture('modifier_part'),{allowNegative:true}),/modifier_part/);
const source=p.readProject(fixture(),{allowNegative:true});
assert.equal(p.selectionBounds(source,1,null).min[2],0,'cutout must not push the printable model above the bed');
assert.equal(p.previewSoup(source,1,null,{},null).triangles,1,'cutting mesh is not shown as a solid');
for(const target of ['snapmaker','bambu','orca']) {
 const out=p.convertProject(source,1,null,{target,layout:{copies:2,spacing:5,width:270,depth:270,tower:false}});
 assert.deepEqual(out.problems,[]);
 assert.ok(out.entries.has('Metadata/project_settings.config'));
 const again=p.readProject(out.entries,{allowNegative:true});
 for(const meta of again.meta.values()) assert.equal(meta.parts.filter(part=>part.subtype==='negative_part').length,1);
 for(const obj of again.objects.values()) if(obj.components.length) assert.equal(obj.components[1].transform,'1 0 0 0 1 0 0 0 1 2 3 -50');
 const roles=dec.decode(out.entries.get('Metadata/model_settings.config')).match(/subtype="negative_part"/g);
 assert.equal(roles.length,2,'each clone keeps a cutout');
 assert.equal(p.selectionInstances(again,again.plates[0].id,null).length,2);
 console.log('PASS negative role, transform, clone and bounds:',target);
}
assert.throws(()=>p.convertProject(source,1,null,{target:'prusa'}),/Prusa multi-volume/);
const path='C:/Users/rende/Desktop/CATS3D.173 - Ghost with heart Final Cats3D STudio.3mf';
if(existsSync(path)) {
 const ghost=p.readProject(await readZip(readFileSync(path)),{allowNegative:true});
 assert.equal(ghost.plates.length,3);
 for(const plate of ghost.plates) for(const target of ['snapmaker','bambu','orca']) {
  const built=p.convertProject(ghost,plate.id,null,{target,removeUnused:true,carrySettings:true,preserveSourceSettings:true});
  assert.deepEqual(built.problems,[]);
  const again=p.readProject(built.entries,{allowNegative:true});
  const selected=p.eligibleObjects(ghost,plate.id);
  const before=selected.flatMap(id=>ghost.meta.get(id).parts).filter(part=>part.subtype==='negative_part');
  const after=[...again.meta.values()].flatMap(meta=>meta.parts).filter(part=>part.subtype==='negative_part');
  assert.equal(after.length,before.length);
  assert.deepEqual(after.map(x=>x.name),before.map(x=>x.name));
  const original=ghost.objects.get(selected[0]);
  const written=[...again.objects.values()].find(obj=>obj.components.length);
  for(let i=0;i<original.components.length;i++) {
   const a=written.components[i].transform.split(/\s+/).map(Number), b=original.components[i].transform.split(/\s+/).map(Number);
   assert.ok(a.every((value,j)=>Math.abs(value-b[j])<1e-8),'part position/scale preserved');
  }
  for(const [name,bytes] of built.entries) if(name.startsWith('3D/Objects/')) {
   const originalBody=dec.decode(ghost.entries.get(name));
   for(const match of dec.decode(bytes).matchAll(/<mesh>[\s\S]*?<\/mesh>/g)) assert.ok(originalBody.includes(match[0]),'mesh copied unchanged');
  }
  console.log('PASS real ghost plate',plate.id,target,'cutout and mesh preserved');
 }
}
for (const count of [1,3,4,5,8]) {
 const cfg={filament_diameter:['1.75','1.75','1.75','1.75']};
 snapmakerConfig(cfg,Array(count).fill('#FFFFFF'),Array(count).fill('PLA'),[]);
 assert.equal(cfg.filament_diameter.length,count,'preset validation sees only actual filaments');
}
if(existsSync(path)) {
 const ghost=p.readProject(await readZip(readFileSync(path)),{allowNegative:true});
 const layout={copies:99,spacing:5,width:270,depth:270,tower:true};
 const built=p.convertProject(ghost,1,null,{target:'snapmaker',removeUnused:true,layout});
 const cfg=JSON.parse(dec.decode(built.entries.get('Metadata/project_settings.config')));
 assert.equal(cfg.filament_colour.length,3);
 assert.equal(cfg.filament_diameter.length,3);
 assert.equal(cfg.filament_settings_id.length,3);
 assert.ok(cfg.filament_settings_id.every(Boolean));
 const again=p.readProject(built.entries,{allowNegative:true});
 const instances=p.selectionInstances(again,1,null);
 for(const [id] of instances) {
  const bounds=p.selectionBounds(again,1,[id]);
  assert.ok(bounds.min[0]>=4.5-1e-6 && bounds.max[0]<=266.5+1e-6);
  assert.ok(bounds.min[1]>=5-1e-6 && bounds.max[1]<=267+1e-6);
 }
 const slotted=p.convertProject(ghost,1,null,{target:'snapmaker',assignmentMode:'slots',mapping:{3:4},removeUnused:true,layout});
 assert.equal(slotted.mapping[3],4);
 const slottedCfg=JSON.parse(dec.decode(slotted.entries.get('Metadata/project_settings.config')));
 assert.equal(slottedCfg.filament_colour[3],'#C12E1FFF');
 assert.equal(slottedCfg.filament_diameter.length,4);
 assert.equal(slottedCfg.filament_settings_id.length,4);
 const slottedProject=p.readProject(slotted.entries,{allowNegative:true});
 for(const meta of slottedProject.meta.values()) {
  assert.equal(Number(meta.parts.find(part=>part.name==='ghost with heart.obj_6').extruder),4);
  assert.ok(meta.parts.every(part=>Number(part.extruder)!==3),'unused slot has no assigned parts');
 }
 console.log('PASS real ghost red stays in slot 4, all clones retain cutouts and slot 3 is unused');
 console.log('PASS real ghost fill:',instances.length,'copies, 4mm edge clearance, three named filament presets');
}
console.log('negative volumes ok');
