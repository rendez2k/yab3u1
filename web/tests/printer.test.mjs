import assert from 'node:assert/strict';
import {printerOrigin,filamentSetup,readSnapshot,inspectPrinter,sendSetup,metadataCommand,statusRoute} from '../shared/printer.js';
const profiles=filamentSetup(['#FFFFFF','#000000','#0080C0','#C12E1F'].map(color=>({color,type:'PLA'})));
const make=()=>({state:'complete',idle:'Ready',ready:'ready',supported:true,slots:Array.from({length:4},()=>({vendor:'Generic',material:'PLA',subtype:'Basic',rgba:'FFFFFFFF',spoolId:0,present:true})),posts:[]});
function transport(state){return async(route,body)=>{
 if(route==='/server/info')return {result:{klippy_state:state.ready,components:['spoollink']}};
 if(route===statusRoute)return {result:{status:{gcode:{commands:state.supported?{SET_PRINT_FILAMENT_CONFIG:{}}:{}},print_stats:{state:state.state},idle_timeout:{state:state.idle},print_task_config:Object.fromEntries(Object.entries({filament_vendor:'vendor',filament_type:'material',filament_sub_type:'subtype',filament_color_rgba:'rgba',filament_spool_id:'spoolId',filament_exist:'present'}).map(([k,v])=>[k,state.slots.map(s=>s[v])]))}}};
 if(route==='/printer/gcode/script'){
  state.posts.push(body.script);if(state.lost||state.lostAt===state.posts.length)throw Error('Lost response');
  const ch=Number(body.script.match(/CONFIG_EXTRUDER=(\d)/)[1]);
  if(!state.mismatch)Object.assign(state.slots[ch],profiles[ch]);
  return {result:'ok'};
 }
 throw Error('Unexpected route');
};}
const review=async(s)=>({before:await inspectPrinter(transport(s)),profiles:structuredClone(profiles),channels:[0,1,2,3],created:Date.now()});
for(const bad of ['https://example.com','http://8.8.8.8','http://192.168.1.2/path','http://user:pass@192.168.1.2'])assert.throws(()=>printerOrigin(bad));
assert.equal(printerOrigin('192.168.1.26'),'http://192.168.1.26');
assert.throws(()=>filamentSetup([{color:'#FFFFFF',type:'PLA'}]));
assert.throws(()=>metadataCommand(5,profiles[0]));
assert.throws(()=>metadataCommand(0,{...profiles[0],material:"PLA'\nG28"}));
for(const change of [s=>s.state='printing',s=>s.state='paused',s=>s.idle='Printing',s=>s.ready='shutdown',s=>s.supported=false,s=>s.slots[0].spoolId=3,s=>s.slots[0].present=false]){
 const s=make(),r=await review(s);change(s);const result=await sendSetup(transport(s),r);assert.equal(s.posts.length,0);assert.equal(result.verified.length,0);
}
let s=make(),r=await review(s);let out=await sendSetup(transport(s),r);assert.deepEqual(out.verified,[1,2,3,4]);assert.equal(s.posts.length,4);
for(const property of ['lost','mismatch']){s=make();r=await review(s);s[property]=true;r.channels=[1,2];out=await sendSetup(transport(s),r);assert(out.uncertain);assert.equal(s.posts.length,1,'never retry uncertain writes');}
s=make();r=await review(s);s.lostAt=2;out=await sendSetup(transport(s),r);assert.deepEqual(out.verified,[1]);assert(out.uncertain);assert.equal(s.posts.length,2);
s=make();r=await review(s);await sendSetup(transport(s),r,()=>false);assert.equal(s.posts.length,0);
r.created-=61000;await sendSetup(transport(s),r);assert.equal(s.posts.length,0);
console.log('PASS U1 metadata: validation, idle/busy/paused/unknown, Spoolman protection, changed review, read-back and no retry.');
