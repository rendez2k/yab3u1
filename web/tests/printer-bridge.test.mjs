import test from 'node:test';
import assert from 'node:assert/strict';
import {openPrinterBridge} from '../shared/printerBridge.js';
const reels=['#FFFFFF','#000000','#FF0000','#0080C0'].map(color=>({color,type:'PLA'}));
function fixture(){
 const listeners=new Map(),timers=new Map(),posts=[],messages=[];let counter=0,done=0,url;
 const popup={closed:false,postMessage:(data,origin)=>posts.push({data,origin})};
 const host={location:{origin:'https://yab3d.uk'},crypto:globalThis.crypto,open:value=>{url=value;return popup;},addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k),setTimeout:fn=>{timers.set(++counter,fn);return counter;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{timers.set(++counter,fn);return counter;},clearInterval:id=>timers.delete(id)};
 const cancel=openPrinterBridge({host,reels,status:(...value)=>messages.push(value),done:()=>done++});
 const token=new URLSearchParams(new URL(url).hash.slice(1)).get('yab3d-printer');
 const emit=(type,extra={},event={})=>listeners.get('message')?.({source:popup,origin:'https://spool-studio.uk',data:{type:'yab3d-printer:'+type,version:1,token,...extra},...event});
 return {emit,cancel,posts,messages,host,popup,listeners,timers,get done(){return done;}};
}
test('handoff sends only four palette colours to the authenticated popup, ignores spoofed origins and tokens',()=>{
 const f=fixture();f.emit('ready',{}, {origin:'https://evil.example'});f.emit('ready',{token:'wrong'});f.emit('ready',{}, {source:{}});assert.equal(f.posts.length,0);
 f.emit('ready');assert.deepEqual(f.posts[0].data.palette,reels.map(r=>({color:r.color,material:r.type})));assert.equal(f.posts[0].origin,'https://spool-studio.uk');
 assert.equal(JSON.stringify(f.posts).includes('key'),false);f.cancel();assert.equal(f.done,1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});
test('only readback verification for all four exact slots gets a complete success message',()=>{
 const f=fixture();f.emit('ready');f.emit('progress',{slot:1,state:'verified',exact:true});assert(!f.messages.at(-1)[0].includes('verified'));
 f.emit('received');f.emit('progress',{slot:1,state:'queued',exact:true});assert.match(f.messages.at(-1)[1],/waiting for bridge/);
 for(let slot=1;slot<=4;slot++)f.emit('progress',{slot,state:'verified',exact:slot!==4});assert.notEqual(f.messages.at(-1)[0],'All four slots verified on U1');assert.match(f.messages.at(-1)[1],/different library/);
 f.emit('progress',{slot:4,state:'verified',exact:true});assert.equal(f.messages.at(-1)[0],'All four slots verified on U1');
 f.emit('progress',{slot:4,state:'uncertain',exact:true});assert.match(f.messages.at(-1)[1],/not verified/);f.cancel();
});
test('blocked popup has a visible recovery and completes synchronously',()=>{
 let done=false,result;openPrinterBridge({host:{location:{origin:'https://yab3d.uk'},crypto:globalThis.crypto,open:()=>null},reels,status:(...x)=>result=x,done:()=>done=true});assert(done);assert.equal(result[0],'Allow pop-ups');
});
