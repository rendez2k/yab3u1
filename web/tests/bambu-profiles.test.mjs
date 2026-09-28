import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BambuProfiles,nativeBambuConfig,validateBambuLayers,applyNativeBambuFilaments} from '../shared/bambuProfiles.js';
import {readProject,convertProject} from '../shared/project.js';
import {readZip} from '../zip.js';

// Synthetic profiles: no dependency on the network or installed slicer.
const printer='Bambu Lab Test 0.4 nozzle';
const machine={name:printer,printer_model:'Bambu Lab Test',printer_variant:'0.4',
  nozzle_diameter:['0.4'],min_layer_height:['0.08'],max_layer_height:['0.28'],
  machine_start_gcode:'DESTINATION ONLY',printable_area:['0x0','256x0','256x256','0x256'],printable_height:'250',
  default_print_profile:'Test process'};
const process={name:'Test process',layer_height:'0.2',enable_support:'0'};
const pla={name:'Generic PLA',instantiation:'true',compatible_printers:[printer],
  filament_type:['PLA'],filament_id:'TEST-PLA',nozzle_temperature:['220'],filament_extruder_variant:['Standard']};
const setup={machine,process,materials:{PLA:pla},bed:{width:256,depth:256,maxHeight:250,edgeMargin:0}};

test('native config keeps exact palette and selected hardware; carries print intent only',()=>{
  const cfg=nativeBambuConfig(setup,['#FF0000','#FFFFFF','#000000','#008000'],Array(4).fill('PLA'),
    {layer_height:'0.16',support_material:'1',support_material_auto:'0',support_material_style:'organic',machine_start_gcode:'FOREIGN'});
  assert.equal(cfg.filament_colour.length,4);
  assert.deepEqual(cfg.nozzle_diameter,['0.4']);
  assert.equal(cfg.printer_settings_id,printer);
  assert.equal(cfg.machine_start_gcode,'DESTINATION ONLY');
  assert.equal(cfg.enable_support,'1');
  assert.equal(cfg.layer_height,'0.16');
  assert.equal(cfg.inherits_group.length,6);
  assert.deepEqual(cfg.filament_ids,Array(4).fill('TEST-PLA'));
});

test('multiple extruder variants survive without becoming extra colour slots',()=>{
  const s=structuredClone(setup);
  s.machine.nozzle_diameter=['0.4','0.4'];
  s.materials.PLA.filament_extruder_variant=['Standard','High Flow'];
  s.materials.PLA.nozzle_temperature=['220','225'];
  const cfg=nativeBambuConfig(s,['#FFFFFF','#000000'],['PLA','PLA']);
  assert.deepEqual(cfg.filament_self_index,['1','1','2','2']);
  assert.deepEqual(cfg.nozzle_temperature,['220','225','220','225']);
  assert.equal(cfg.filament_colour.length,2);
  assert.equal(cfg.nozzle_diameter.length,2);
  const reels=[210,230].map(temp=>({type:'PLA',profile:{name:'Custom',type:'PLA',vendor:'Test',values:{nozzle_temperature:String(temp)}}}));
  applyNativeBambuFilaments(cfg,reels);
  assert.deepEqual(cfg.nozzle_temperature,['210','210','230','230']);
  assert.equal(cfg.filament_settings_id.length,2);
});

test('incompatible material and layer heights stop rather than substitute',()=>{
  assert.throws(()=>nativeBambuConfig(setup,['#FFFFFF'],['PETG']),/Missing compatible PETG/);
  assert.throws(()=>validateBambuLayers({layer_height:'0.4'},setup),/outside/);
  assert.equal(nativeBambuConfig(setup,['#FFFFFF'],['PLA'],{layer_height:'0.4'},false).layer_height,'0.2');
});

test('catalogue resolves inherited settings and included machine commands',async()=>{
  const files={'BBL.json':{machine_list:[{name:printer,sub_path:'machine/test.json'},{name:'base',sub_path:'machine/base.json'},{name:'commands',sub_path:'machine/commands.json'}],
    process_list:[{name:process.name,sub_path:'process/test.json'}],filament_list:[{name:pla.name,sub_path:'filament/test.json'}]},
    'BBL/machine/test.json':{...machine,inherits:'base',include:['commands']},
    'BBL/machine/base.json':{bed_custom_model:'test.stl'},'BBL/machine/commands.json':{machine_end_gcode:'END'},
    'BBL/process/test.json':process,'BBL/filament/test.json':pla};
  const p=new BambuProfiles(async path=>structuredClone(files[path]));
  assert.equal((await p.catalogue()).length,1);
  const s=await p.setup(printer,['PLA']);
  assert.equal(s.machine.machine_end_gcode,'END');
  assert.equal(s.machine.bed_custom_model,'test.stl');
  assert.equal(s.bed.width,256);
  await assert.rejects(()=>p.setup(printer,['PETG']),/No compatible official/);
  files['BBL/machine/base.json'].inherits=printer;
  const circular=new BambuProfiles(async path=>structuredClone(files[path]));
  await assert.rejects(()=>circular.resolve('machine',printer),/Circular/);
});

test('native archive has project config and paint; default fallback remains colour-model import',async()=>{
  const project=readProject(await readZip(new Uint8Array(readFileSync(new URL('../selftest-fixture-bambu.3mf',import.meta.url)))));
  const output=convertProject(project,project.plates[0].id,null,{target:'bambu',bambuSetup:setup,removeUnused:true,preserveSourceSettings:true});
  assert.deepEqual(output.problems,[]);
  assert.equal(output.settings.format,'native-project');
  const cfg=JSON.parse(new TextDecoder().decode(output.entries.get('Metadata/project_settings.config')));
  assert.equal(cfg.filament_colour.length,Object.keys(output.colours).length);
  assert.equal(cfg.printer_settings_id,printer);
  const model=new TextDecoder().decode(output.entries.get('3D/3dmodel.model'));
  assert.match(model,/BambuStudio-/);
  assert.ok([...output.entries].some(([name,data])=>name.endsWith('.model') && new TextDecoder().decode(data).includes('paint_color=')));
  const fallback=convertProject(project,project.plates[0].id,null,{target:'bambu',removeUnused:true});
  assert.equal(fallback.settings.format,'standard-colour');
  assert.equal(fallback.entries.has('Metadata/project_settings.config'),false);
});
