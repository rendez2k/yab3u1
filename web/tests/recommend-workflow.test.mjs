import assert from 'node:assert/strict';
import {recommendWorkflow} from '../shared/recommend.js';
const sources={1:'#0080C0',2:'#FF0000',3:'#FFFFFF',4:'#000000',5:'#C5C263'};
const loaded=['#FFFFFF','#000000','#3D9140','#FF9500'].map(color=>({color,type:'PLA'}));
const weights={'#000000':700000,'#FFFFFF':250000,'#0080C0':200000,'#FF0000':50000,'#C5C263':10000};
const all=r=>[...(r.found?[r,...r.alternatives]:[]),...r.approximateOptions];
const model=recommendWorkflow({sources,loaded,weights});
assert.equal(model.search.evaluated,5,'compare every original four-of-five set');
assert.equal(all(model).length,5);
for(const p of all(model)) {
 assert.equal(p.outcome.counts.preserved,4);
 assert.equal(p.outcome.counts.blended,1);
 assert.equal(p.outcome.counts.substituted,0);
 assert.equal(p.outcome.outputCount,5);
 assert(p.reels.every(r=>Object.values(sources).includes(r.color)));
}
assert(all(model)[0].reels.some(r=>r.color==='#000000'),'prominent black stays exact');
const different=loaded.map(r=>({...r,color:'#FF00FF'}));
assert.deepEqual(recommendWorkflow({sources,loaded:different,weights}),model,'model-first is independent of saved reels');
const locked=recommendWorkflow({sources,loaded,keepExact:['#000000','#FF0000']});
assert(all(locked).every(p=>['#000000','#FF0000'].every(c=>p.reels.some(r=>r.color===c))));
assert.throws(()=>recommendWorkflow({sources,loaded,keepExact:Object.values(sources)}),/at most four/);
for(const reels of [loaded,['#00FFFF','#FF00FF','#FFFF00','#000000'].map(color=>({color,type:'PLA'}))]) {
 const fixed=recommendWorkflow({mode:'loaded',sources,loaded:reels,stock:[{color:'#123456',type:'PLA'}]});
 assert.equal(fixed.search.evaluated,1);
 assert(all(fixed).length>0);
 all(fixed).forEach(p=>assert.deepEqual(p.reels,reels,'loaded mode must not replace or reorder reels'));
}
const stock=Object.values(sources).map((color,i)=>({color,type:'PLA',name:'Owned '+i}));
const owned=recommendWorkflow({sources,loaded,stock});
assert(!owned.rough);
assert(all(owned).every(p=>p.reels.every(r=>stock.some(s=>s.name===r.name))));
assert.equal(all(recommendWorkflow({sources,loaded,stock:[]})).length,0);
const three={1:'#FFFFFF',2:'#000000',3:'#FF0000'};
assert.equal(recommendWorkflow({sources:three,loaded}).outcome.counts.preserved,3);
assert.equal(recommendWorkflow({sources:three,loaded}).outcome.blendCount,0);
assert.throws(()=>recommendWorkflow({sources:{},loaded}),/readable/);
console.log('Workflow recommendation checks passed: model-first, all original sets, prominence, exact colours, fixed loaded and CMYK, stock, small palettes.');
