import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const bridge=createRequire(import.meta.url)('../../extensions/makerworld-yab3d/printer-bridge.js');
const page='https://yab3d.uk',printer='http://192.168.1.31';
const label="SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=2 VENDOR='Generic' FILAMENT_TYPE='PLA' FILAMENT_SUBTYPE='Basic' FILAMENT_COLOR_RGBA=F7E400FF";

test('only a private printer address is accepted',()=>{
  for(const ok of ['http://192.168.1.31','http://10.0.0.5','http://172.16.4.2','http://172.31.255.1:7125'])assert.ok(bridge.printerOrigin(ok),ok);
  for(const bad of ['https://192.168.1.31','http://8.8.8.8','http://172.32.0.1','http://printer.local','http://192.168.1.31/path','http://user:pw@192.168.1.31','http://192.168.1.31/?x=1','http://127.0.0.1','nonsense',''])
    assert.equal(bridge.printerOrigin(bad),null,bad);
});

test('only YAB3D may ask, and only for the few supported requests',()=>{
  const ask=extra=>bridge.refusal({page,printer,route:'/server/info',body:null,...extra});
  assert.equal(ask({}),'');assert.equal(ask({route:bridge.STATUS_ROUTE}),'');
  assert.equal(ask({route:'/printer/gcode/script',body:{script:label}}),'');
  assert.match(ask({page:'https://example.com'}),/Only YAB3D/);
  assert.match(ask({page:'https://yab3d.uk.example.com'}),/Only YAB3D/);
  assert.match(ask({printer:'http://8.8.8.8'}),/private address/);
  assert.match(ask({route:'/printer/print/start'}),/not supported/);
  assert.match(ask({route:'/server/files/upload'}),/not supported/);
  // Writes: nothing but a filament label, on the one write route, with no extra fields.
  for(const script of ['G28','M104 S250',label+'\nG28',label.replace("VENDOR='Generic'","VENDOR='X'"),label.replace('CONFIG_EXTRUDER=2','CONFIG_EXTRUDER=9'),'FIRMWARE_RESTART'])
    assert.match(ask({route:'/printer/gcode/script',body:{script}}),/Only filament label/,script);
  assert.match(ask({route:'/printer/gcode/script',body:{script:label,extra:1}}),/Only filament label/);
  assert.match(ask({route:'/server/info',body:{script:label}}),/Only filament label/);
});

test('a label is only sent to an idle printer with that slot loaded and free',()=>{
  const info={result:{klippy_state:'ready',components:[]}};
  const status=over=>({result:{status:{gcode:{commands:{SET_PRINT_FILAMENT_CONFIG:{}}},print_stats:{state:'standby'},idle_timeout:{state:'Idle'},print_task_config:{filament_exist:[true,true,true,true],filament_spool_id:[0,0,0,0]},...over}}});
  assert.equal(bridge.writable(info,status({}),label),true);
  assert.equal(bridge.writable(info,status({print_stats:{state:'printing'}}),label),false);
  assert.equal(bridge.writable(info,status({idle_timeout:{state:'Printing'}}),label),false);
  assert.equal(bridge.writable(info,status({print_task_config:{filament_exist:[true,true,false,true],filament_spool_id:[0,0,0,0]}}),label),false);
  assert.equal(bridge.writable(info,status({print_task_config:{filament_exist:[true,true,true,true],filament_spool_id:[0,0,7,0]}}),label),false);
  assert.equal(bridge.writable({result:{klippy_state:'error'}},status({}),label),false);
  assert.equal(bridge.writable(info,status({gcode:{commands:{}}}),label),false);
});

test('the manifest asks for printer access only as an optional permission',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../extensions/makerworld-yab3d/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.optional_host_permissions,['http://*/*']);
  // The Chrome Web Store refuses a manifest description over 132 characters.
  assert.ok(manifest.description.length<=132,`description is ${manifest.description.length} characters`);
  assert.ok(manifest.name.length<=75);
  assert.deepEqual(manifest.host_permissions,['https://makerworld.com/*','https://makerworld.com.cn/*']);
  const script=manifest.content_scripts.find(c=>c.js.includes('printer-bridge-content.js'));
  assert.deepEqual(script.matches,['https://yab3d.uk/*']);
});
