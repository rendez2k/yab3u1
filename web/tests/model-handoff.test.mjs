import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {receiveModel,MAX_MODEL_BYTES} from '../shared/modelHandoff.js';

function receiver({allowed=true,load=async()=>true}={}){
 const listeners=new Map(),domListeners=new Map(),timers=new Map(),posts=[];let id=0,imports=0,note;
 const token='a'.repeat(32),source={postMessage:data=>posts.push(data)};
 const host={File,opener:source,location:{hash:'#'+new URLSearchParams({'yab3d-model':token,sender:'https://makerworld.com'}),pathname:'/',search:''},history:{replaceState(){}},document:{createElement:()=>({setAttribute(){}}),addEventListener:(k,v)=>domListeners.set(k,v),removeEventListener:k=>domListeners.delete(k)},addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k),setInterval:fn=>(timers.set(++id,fn),id),setTimeout:fn=>(timers.set(++id,fn),id),clearInterval:i=>timers.delete(i),clearTimeout:i=>timers.delete(i)};
 receiveModel({host,mount:{prepend:n=>note=n},canReceive:()=>allowed,load:async file=>{imports++;return load(file);}});
 const emit=(data={},event={})=>listeners.get('message')?.({source,origin:'https://makerworld.com',data:{type:'yab3d-model:file',version:1,token,name:'original.3mf',bytes:new Uint8Array([80,75,3,4,7,8]).buffer,...data},...event});
 return {emit,posts,timers,listeners,domListeners,get imports(){return imports;},get note(){return note;}};
}
test('original bytes and filename survive transfer; success waits for parsing',async()=>{
 let release;const f=receiver({load:async file=>{assert.equal(file.name,'original.3mf');assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[80,75,3,4,7,8]);await new Promise(r=>release=r);return true;}});
 const pending=f.emit();await new Promise(r=>setImmediate(r));assert.equal(f.posts.at(-1).type,'yab3d-model:received');await f.emit();assert.equal(f.imports,1);release();await pending;assert.equal(f.posts.at(-1).type,'yab3d-model:opened');assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
});
test('wrong origin, source and nonce never import',async()=>{
 const f=receiver();await f.emit({}, {origin:'https://evil.example'});await f.emit({}, {source:{}});await f.emit({token:'b'.repeat(32)});assert.equal(f.imports,0);await f.emit();assert.equal(f.imports,1);
});
test('occupied page, bad archive, size and path names are rejected',async()=>{
 for(const [options,data] of [[{allowed:false},{}],[{},{bytes:new ArrayBuffer(4)}],[{},{bytes:new ArrayBuffer(MAX_MODEL_BYTES+1)}],[{},{name:'../file.3mf'}],[{},{name:'file.stl'}]]){
  const f=receiver(options);await f.emit(data);assert.equal(f.imports,0);assert.equal(f.posts.at(-1).type,'yab3d-model:error');assert.equal(f.timers.size,0);
 }
});
test('manual file selection cancels before a late incoming transfer',async()=>{
 const f=receiver();f.domListeners.get('change')({target:{type:'file'}});await f.emit();assert.equal(f.imports,0);assert.match(f.note.textContent,/cancelled/);
});
test('parse failure is reported as failure, not opened',async()=>{
 const f=receiver({load:async()=>false});await f.emit();assert.equal(f.posts.at(-1).type,'yab3d-model:error');assert.match(f.note.textContent,/could not open/);
});
test('MakerWorld display name is separate from the original filename and bytes',async()=>{
 const f=receiver({load:async file=>{assert.equal(file.name,'original.3mf');assert.equal(file.yab3dDisplayName,'Friendly Pumpkin');assert.equal(file.size,6);return true;}});
 await f.emit({displayName:'Friendly Pumpkin'});assert.equal(f.posts.at(-1).type,'yab3d-model:opened');
});

function sender(){
 const listeners=new Map(),timers=new Map(),posts=[],statuses=[];let id=0,url;
 const popup={closed:false,postMessage:d=>posts.push(d)};
 const host={open:u=>(url=u,popup),addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 const scope=vm.createContext({window:host,location:{origin:'https://makerworld.com'},AbortController,URL,URLSearchParams,crypto:globalThis.crypto,Uint8Array,console,setTimeout:fn=>(timers.set(++id,fn),id),setInterval:fn=>(timers.set(++id,fn),id),clearTimeout:i=>timers.delete(i),clearInterval:i=>timers.delete(i)});
 vm.runInContext(fs.readFileSync('integrations/makerworld/yab3d-handoff.js','utf8'),scope);
 const transfer=scope.YAB3DModelHandoff.open('recolour.html',s=>statuses.push(s));
 const token=new URL(url).hash.match(/yab3d-model=([^&]+)/)[1];
 const emit=(type,event={})=>listeners.get('message')?.({origin:'https://u1-reel-changes--yab3u1.netlify.app',source:popup,data:{type:'yab3d-model:'+type,token,version:1},...event});
 return {transfer,emit,posts,timers,listeners,statuses,popup};
}
test('sender waits for authenticated ready, keeps original buffer and distinguishes receipt from opened',async()=>{
 const f=sender(),bytes=new Uint8Array([80,75,3,4,5]);let done=false;
 const pending=f.transfer.send(bytes,'test.3mf').then(()=>done=true);
 f.emit('ready',{origin:'https://evil.example'});assert.equal(f.posts.length,0);
 f.emit('ready');assert.deepEqual([...new Uint8Array(f.posts[0].bytes)],[...bytes]);assert.equal(bytes.byteLength,5);
 f.emit('received');await Promise.resolve();assert.equal(done,false);f.emit('opened');await pending;assert(done);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});
test('closed receiving tab fails visibly and does not leave sender waiting',async()=>{
 const f=sender();const pending=f.transfer.send(new Uint8Array([80,75,3,4]),'test.3mf');f.popup.closed=true;[...f.timers.values()][1]();await assert.rejects(pending,/tab closed/);assert.equal(f.timers.size,0);
});
