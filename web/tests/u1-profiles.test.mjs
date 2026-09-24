import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {buildU1Profile,matchU1Profile,detectNozzle,conservativeSpeeds} from '../shared/u1Profiles.js';
import {readFilamentProfiles,parseFilamentPreset,applyFilamentProfiles} from '../shared/filamentProfiles.js';
import {readProject,convertProject,SRC_BBL_PROJECT} from '../shared/project.js';
import {readZip,writeZip} from '../zip.js';
import {unpackBundle} from '../shared/bundle.js';
import {ConvertSession} from '../shared/convertSession.js';
const enc=new TextEncoder(),dec=new TextDecoder();
assert.equal(detectNozzle({nozzle_diameter:['0.2','0.2']}),'0.2');
assert.equal(detectNozzle({nozzle_diameter:'0.6;0.6'}),'0.6');
assert.equal(detectNozzle({nozzle_diameter:['0.2','0.4']}),null);
assert.equal(matchU1Profile({nozzle_diameter:['0.6'],layer_height:'0.24'}).process.layer_height,'0.24');
assert.equal(matchU1Profile({},'auto').nozzle,'0.4');
assert.ok(matchU1Profile({},'auto').notes[0].includes('missing'));
assert.throws(()=>buildU1Profile({},['TPU'],'0.2'),/No verified/);
assert.throws(()=>buildU1Profile({},['Mystery'],'0.4'),/No verified/);
assert.throws(()=>buildU1Profile({},['PLA'],'0.6',{blends:true}),/requires a 0.4/);
const mixed=buildU1Profile({},['PLA','PETG','ABS','TPU'],'0.4');
assert.deepEqual(mixed.cfg.nozzle_temperature,['220','255','270','240']);
assert.deepEqual(mixed.cfg.textured_plate_temp,['65','80','90','35']);
assert.deepEqual(mixed.cfg.filament_settings_id,['Generic PLA','Generic PETG','Generic ABS','Generic TPU']);
for(const [key,value,limit] of [['hot_plate_temp','110','100'],['nozzle_temperature','320','300']]) {
  const cfg=buildU1Profile({},['PLA'],'0.4').cfg;
  assert.throws(()=>applyFilamentProfiles(cfg,[{type:'PLA',profile:{name:'Custom',type:'PLA',vendor:'Custom',values:{[key]:value}}}],{u1:true}),new RegExp(limit));
}
const speeds=conservativeSpeeds({outer_wall_speed:'30',inner_wall_speed:'9999',travel_speed:'0',support_speed:'50%'},mixed.cfg);
assert.equal(speeds.values.outer_wall_speed,'30');
assert.equal(speeds.values.inner_wall_speed,String(mixed.cfg.inner_wall_speed));
assert.equal(speeds.values.travel_speed,undefined);
assert.equal(speeds.values.support_speed,undefined);
assert.equal(conservativeSpeeds({external_perimeter_speed:'21'},mixed.cfg).values.outer_wall_speed,'21');

function source(settings={}) {
 return readProject(new Map([
 ['3D/3dmodel.model',enc.encode('<model unit="millimeter"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>')],
 ['Metadata/model_settings.config',enc.encode('<config><object id="1"><metadata key="extruder" value="2"/><metadata key="outer_wall_speed" value="12"/><metadata key="inner_wall_speed" value="9000"/></object></config>')],
 [SRC_BBL_PROJECT,enc.encode(JSON.stringify({filament_colour:['#FFFFFF','#FF0000'],filament_type:['PLA','PETG'],nozzle_diameter:['0.4'],filament_settings_id:['eSUN PLA','Bambu PETG'],nozzle_temperature:['215','250'],hot_plate_temp:['60','80'],...settings}))]
 ]));
}
const project=source({outer_wall_speed:'30',inner_wall_speed:'9999',layer_height:'0.28',machine_start_gcode:'EVIL'});
const built=convertProject(project,1,null,{target:'snapmaker',u1Nozzle:'0.2',assignmentMode:'slots',mapping:{1:1,2:4},filamentProfiles:project.filamentProfiles});
const cfg=JSON.parse(dec.decode(built.entries.get(SRC_BBL_PROJECT)));
assert.deepEqual(cfg.nozzle_diameter,['0.2','0.2','0.2','0.2']);
assert.equal(cfg.nozzle_temperature[3],'250');
assert.equal(cfg.filament_settings_id[3],'Bambu PETG - YAB3D');
assert.equal(cfg.filament_type[3],'PETG');
assert.equal(cfg.filament_type[2],'PLA');
assert.equal(cfg.layer_height,'0.12');
assert.equal(cfg.outer_wall_speed,'30');
assert.notEqual(cfg.machine_start_gcode,'EVIL');
const xml=dec.decode(built.entries.get('Metadata/model_settings.config'));
assert.match(xml,/key="outer_wall_speed" value="12"/);
assert.doesNotMatch(xml,/value="9000"/);
assert.doesNotMatch(xml,/key="layer_height" value="0.28"/);
assert.ok(cfg.different_settings_to_system[0].includes('outer_wall_speed'));
assert.ok(cfg.different_settings_to_system[4].includes('nozzle_temperature'));
assert.ok(built.settings.notes.some(n=>n.includes('outside')));
const off=convertProject(project,1,null,{target:'snapmaker',carrySettings:false});
assert.notEqual(JSON.parse(dec.decode(off.entries.get(SRC_BBL_PROJECT))).outer_wall_speed,'30');
for(const target of ['bambu','orca','prusa']) {
 const converted=convertProject(project,1,null,{target,filamentProfiles:project.filamentProfiles,preserveSourceSettings:true});
 assert.deepEqual(converted.problems,[]);
 const settings=dec.decode(converted.entries.get(target==='prusa'?'Metadata/Slic3r_PE.config':SRC_BBL_PROJECT));
 assert.ok(settings.includes('Bambu PETG - YAB3D'));
 assert.ok(settings.includes('250'));
 assert.ok(!settings.includes('machine_start_gcode'));
 assert.ok(!settings.includes('nozzle_diameter'));
 const parsed=readProject(converted.entries);assert.equal(parsed.types[1],'PETG');
}
assert.throws(()=>parseFilamentPreset('{"name":"partial","filament_type":["PLA"],"inherits":"parent"}'),/inheritance/);
const imported=parseFilamentPreset('{"name":"Sunlu PLA","filament_type":["PLA"],"nozzle_temperature":["215"],"machine_start_gcode":"EVIL"}');
assert.equal(imported.name,'Sunlu PLA');assert.equal(imported.values.machine_start_gcode,undefined);
const session=new ConvertSession(()=>null);session.output={url:'test'};session.dropOutput=()=>{session.output=null;};
session.setU1Nozzle('0.6');assert.equal(session.output,null);assert.equal(session.u1Nozzle,'0.6');
const zip=await writeZip([{name:'nested/one.3mf',data:new Uint8Array([1,2])},{name:'mesh.stl',data:new Uint8Array([3])}]);
const bundle=await unpackBundle(zip);assert.equal(bundle.files.length,1);assert.equal(bundle.ignored.length,1);
const file='C:/Users/rende/Desktop/Frankenstein Couple.zip';
if(existsSync(file)) {
 const real=await unpackBundle(new Uint8Array(readFileSync(file)));
 assert.equal(real.files.length,4);assert.equal(real.ignored.length,6);
 for(const f of real.files) {
  const p=readProject(await readZip(f.bytes),{allowNegative:true});
  const result=convertProject(p,p.plates[0].id,null,{target:'snapmaker'});
  assert.deepEqual(result.problems,[]);
  console.log('Bundle project:',f.name,p.kind,p.types,result.settings.profile);
 }
}
console.log('PASS nozzle/profile matching, mixed materials, source brands, slot gaps, object speed caps, layer bounds, portable presets, JSON import and ZIP bundle analysis');
