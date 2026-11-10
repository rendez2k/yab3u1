import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore,describeAge,plainContext,sameFile} from './session-store.js';

// A minimal in-memory IndexedDB: enough for one store with put/get/delete.
function fakeIndexedDB(){
  const data=new Map();
  const request=(result,owner)=>{const r={result};queueMicrotask(()=>{r.onsuccess?.();owner?.oncomplete?.();});return r;};
  return {data,open(){const r={result:{createObjectStore(){},close(){},transaction(){const tx={};tx.objectStore=()=>({put:(v,k)=>{data.set(k,v);return request(undefined,tx);},get:k=>request(data.get(k),tx),delete:k=>{data.delete(k);return request(undefined,tx);}});return tx;}}};queueMicrotask(()=>{r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
}
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};

test('session ages read naturally and unchanged files are recognised',()=>{
  const now=1e12;
  assert.equal(describeAge(now-20000,now),'just now');assert.equal(describeAge(now-60000,now),'1 minute ago');
  assert.equal(describeAge(now-45*60000,now),'45 minutes ago');assert.equal(describeAge(now-3*3600000,now),'3 hours ago');assert.equal(describeAge(now-2*86400000,now),'2 days ago');
  assert(sameFile({name:'a.3mf',size:4,lastModified:9},{name:'a.3mf',size:4,lastModified:9}));
  assert(!sameFile({name:'a.3mf',size:4,lastModified:9},{name:'a.3mf',size:5,lastModified:9}));assert(!sameFile(null,{name:'a'}));
});
test('only plain settings are kept from a workspace context',()=>{
  assert.deepEqual(plainContext({target:'snapmaker',layout:{quantities:{1:2}},fn(){},missing:undefined}),{target:'snapmaker',layout:{quantities:{1:2}}});
  const loop={};loop.self=loop;assert.deepEqual(plainContext(loop),{});
});
test('the last model is saved, read back, forgotten and never kept once switched off',async()=>{
  const indexedDB=fakeIndexedDB(),store=createSessionStore({indexedDB,storage:memory()});
  assert.equal(await store.read(),null);
  assert.equal(await store.save({blob:'bytes',name:'pumpkin.3mf',savedAt:1}),true);
  assert.equal((await store.read()).name,'pumpkin.3mf');
  await store.saveContext({target:'bambu'});assert.deepEqual((await store.read()).context,{target:'bambu'});
  await store.save({blob:'bytes',name:'next.3mf',savedAt:5,context:{target:'prusa'}});assert.deepEqual((await store.read()).context,{target:'prusa'});
  await store.clear();assert.equal(await store.read(),null);
  await store.save({blob:'bytes',name:'pumpkin.3mf',savedAt:1});await store.setEnabled(false);
  assert.equal(store.enabled(),false);assert.equal(indexedDB.data.size,0);
  assert.equal(await store.save({blob:'bytes',name:'again.3mf',savedAt:2}),false);assert.equal(indexedDB.data.size,0);
});
test('missing or failing storage never breaks the workspace',async()=>{
  const store=createSessionStore({indexedDB:undefined,storage:memory()});
  assert.equal(await store.save({blob:'x'}),false);assert.equal(await store.read(),null);await store.clear();
});
