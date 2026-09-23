import assert from 'node:assert/strict';
import { parseSpoolStock, sharedSpoolStock, requestSpoolStock } from '../shared/spoolImport.js';
const item = {brand:'Maker', product:'Basic', colour:'Green', material:'PLA', hex:'#3f8e43', spools:1, used:false};
const pack = items => JSON.stringify({format:'spool-studio-account-export-v1', accountKey:'private-account', library:{items}, phoneBatch:{private:'ignored'}});
const parsed = parseSpoolStock(pack([item, {...item}, {...item, used:true}, {...item, spools:0}, {...item, hex:'invalid'}, {...item, material:'PLA-CF'}, {...item, colour:'Rainbow'}]));
assert.equal(parsed.rows.length,1);
assert.equal(parsed.omitted,5);
assert.deepEqual(parsed.rows[0], {color:'#3F8E43',type:'PLA',name:'Maker · Basic · Green · PLA'});
assert.ok(!JSON.stringify(parsed).includes('private'));
assert.throws(()=>parseSpoolStock('{}'),/Spool Studio/);
assert.throws(()=>parseSpoolStock('not json'),/valid JSON/);
assert.equal(parseSpoolStock(pack([])).rows.length,0);
assert.equal(parseSpoolStock(pack([{...item,hex:'#ffffffFF'}])).rows[0].color,'#FFFFFF');
console.log('Spool Studio import: supported export, availability, colour/material filters and private-field isolation passed');

const shared = {brand:'Maker',product:'Basic',colour:'Green',material:'PLA',finish:'matte',hex:'#3F8E43',availableRolls:1};
assert.match(sharedSpoolStock([shared]).rows[0].name,/matte/);
for (const row of [{...shared,accountKey:'private'}, {...shared,hex:'red'}, {...shared,availableRolls:-1}, {...shared,colour:'bad\nlabel'}])
  assert.throws(()=>sharedSpoolStock([row]));
function connection({blocked=false,origin='https://yab3d.uk'}={}) {
  const hooks=new Map(), timers=new Map(), sent=[],received=[],messages=[];let sequence=0,finished=0,url;
  const popup={closed:false,postMessage:(data,origin)=>sent.push({data,origin})};
  const host={location:{origin},crypto:{getRandomValues:array=>array.fill(7)},open:value=>{url=value;return blocked?null:popup;},
    addEventListener:(name,callback)=>hooks.set(name,callback),removeEventListener:name=>hooks.delete(name),
    setTimeout:callback=>{timers.set(++sequence,callback);return sequence;},setInterval:callback=>{timers.set(++sequence,callback);return sequence;},
    clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)};
  const stop=requestSpoolStock({host,receive:r=>received.push(r),status:s=>messages.push(s),done:()=>finished++});
  const token=url?new URLSearchParams(new URL(url).hash.slice(1)).get('strata-stock'):'';
  const event=(type,patch={})=>({source:popup,origin:'https://spool-studio.uk',data:{type:'strata-spool:stock-'+type,version:1,token,...patch}});
  return {hooks,timers,sent,received,messages,stop,popup,event,send:e=>hooks.get('message')?.(e),get finished(){return finished;}};
}
const c=connection();
c.send(c.event('data',{colours:[shared]}));assert.equal(c.received.length,0);
for(const patch of [{source:{}},{origin:'https://evil.test'},{data:{type:'strata-spool:stock-ready',version:1,token:'wrong'}}])c.send({...c.event('ready'),...patch});
assert.equal(c.sent.length,0);
c.send(c.event('ready'));c.send(c.event('ready'));assert.equal(c.sent.length,1);
assert.equal(c.sent[0].data.type,'strata-spool:stock-request');
c.send(c.event('data',{colours:[shared]}));assert.equal(c.received.length,1);
assert.equal(c.sent.at(-1).data.type,'strata-spool:stock-received');
assert.equal(c.hooks.size,0);assert.equal(c.timers.size,0);assert.equal(c.finished,1);
const cancelled=connection();cancelled.stop();cancelled.send(cancelled.event('data',{colours:[shared]}));assert.equal(cancelled.received.length,0);
assert.equal(cancelled.timers.size,0);assert.equal(cancelled.finished,1);
const closed=connection();closed.popup.closed=true;[...closed.timers.values()][1]();assert.equal(closed.finished,1);
const timeout=connection();[...timeout.timers.values()][0]();assert.equal(timeout.finished,1);
const blocked=connection({blocked:true});assert.match(blocked.messages.at(-1),/pop-ups/);assert.equal(blocked.hooks.size,0);
const local=connection({origin:'http://localhost:8760'});assert.match(local.messages.at(-1),/File import/);
console.log('Direct stock sharing: handshake, exact source/origin/token, explicit share, cleanup, cancel, timeout and popup blocking passed');
