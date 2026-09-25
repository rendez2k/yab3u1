import test from 'node:test';
import assert from 'node:assert/strict';
import {RecolourWorker,loadModelWithRecovery} from '../shared/workerClient.js';

const stopped=()=>Object.assign(new Error('background worker stopped'),{code:'WORKER_STOPPED'});
const bytes=[80,75,3,4,1,2,3];
const file=new File([new Uint8Array(bytes)],'original.3mf');

test('one worker failure retries with a fresh, non-detached copy of the original file',async()=>{
 const freshFlags=[];let retries=0;
 const result=await loadModelWithRecovery({file,isCurrent:()=>true,onRetry:()=>retries++,restart:fresh=>{
  freshFlags.push(fresh);return {load:async buffer=>{
   assert.deepEqual([...new Uint8Array(buffer)],bytes);
   structuredClone(buffer,{transfer:[buffer]});assert.equal(buffer.byteLength,0);
   if(!fresh)throw stopped();return 'opened';
  }};
 }});
 assert.equal(result,'opened');assert.equal(retries,1);assert.deepEqual(freshFlags,[false,true]);
 assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],bytes);
});
test('persistent worker failure stops after two attempts and keeps source File readable',async()=>{
 let attempts=0;
 await assert.rejects(loadModelWithRecovery({file,isCurrent:()=>true,restart:()=>({load:async()=>{attempts++;throw stopped();}})}),{code:'WORKER_STOPPED'});
 assert.equal(attempts,2);assert.equal((await file.arrayBuffer()).byteLength,bytes.length);
});
test('invalid model errors are never retried as worker crashes',async()=>{
 let attempts=0;
 await assert.rejects(loadModelWithRecovery({file,isCurrent:()=>true,restart:()=>({load:async()=>{attempts++;throw new Error('Invalid archive');}})}),/Invalid archive/);
 assert.equal(attempts,1);
});
test('replacing a file during a worker failure prevents an obsolete retry',async()=>{
 let current=true,attempts=0;
 const result=await loadModelWithRecovery({file,isCurrent:()=>current,restart:()=>({load:async()=>{attempts++;current=false;throw stopped();}})});
 assert.equal(result,null);assert.equal(attempts,1);
});
test('replacement during retry disk read never creates another worker',async()=>{
 let current=true,reads=0,attempts=0;
 const delayed={arrayBuffer:async()=>{if(++reads===2)current=false;return file.arrayBuffer();}};
 const result=await loadModelWithRecovery({file:delayed,isCurrent:()=>current,restart:()=>({load:async()=>{attempts++;throw stopped();}})});
 assert.equal(result,null);assert.equal(attempts,1);
});
test('a dead worker rejects pending and future requests; disposal is not retryable',async()=>{
 const original=globalThis.Worker;
 class FakeWorker {postMessage(){} terminate(){this.stopped=true;}}
 globalThis.Worker=FakeWorker;
 try {
  const client=new RecolourWorker();const pending=client.request('load');
  client.worker.onerror({});await assert.rejects(pending,{code:'WORKER_STOPPED'});
  await assert.rejects(client.request('preview'),{code:'WORKER_STOPPED'});
  assert.equal(client.pending.size,0);assert(client.worker.stopped);
  const cancelled=new RecolourWorker();const waiting=cancelled.request('load');cancelled.dispose();
  await assert.rejects(waiting,error=>error.code===undefined);
 } finally {globalThis.Worker=original;}
});
