import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FILAMENT_BUNDLES,CATALOGUE_REVISION,selectBundleReels,smallerBundleOptions,compatibleBundleOptions,bundleFit} from '../shared/filamentBundles.js';
import {recommendWorkflow} from '../shared/recommend.js';
import {reelIdentity} from '../shared/filamentIdentity.js';
import {scoreColourOutcome} from '../shared/colourPriorities.js';

const pack=FILAMENT_BUNDLES.find(b=>b.id==='bambu-palette-cmykw');
const choices=r=>[...(r.found?[r,...r.alternatives]:[]),...r.approximateOptions];

test('verified PLA Palette pack keeps stable product IDs and distinguishes its translucent key',()=>{
  assert.equal(pack.kind,'retail');assert.equal(CATALOGUE_REVISION,'2026-11-05.1');
  assert.deepEqual(pack.reels.map(r=>r.color),['#0090DA','#E24585','#FCE300','#000000','#FFFFFF']);
  assert.deepEqual(pack.reels.map(r=>r.opticalClass),['opaque','opaque','opaque','translucent','opaque']);
  assert.equal(pack.reels[3].productId,'bambu-lab/pla-palette/2026/key');
  for(const id of ['bambu-palette-cmyw','bambu-palette-cmyk']){
    const subset=FILAMENT_BUNDLES.find(b=>b.id===id);
    assert.equal(subset.kind,'curated');assert.equal(subset.reels.length,4);
    assert(subset.reels.every(r=>pack.reels.some(p=>reelIdentity(p)===reelIdentity(r))));
  }
});

test('reversible subsets retain product identity and say exactly which reels were omitted',()=>{
  const before=structuredClone(pack),cmyk=selectBundleReels(pack,[0,1,2,3]);
  assert.deepEqual(cmyk.omittedReels.map(r=>r.name),['Bambu Lab White']);
  const smaller=selectBundleReels(cmyk,[0,2,3]);
  assert.deepEqual(smaller.omittedReels.map(r=>r.name),['Bambu Lab White','Bambu Lab Magenta']);
  assert.deepEqual(pack,before);assert.equal(selectBundleReels(pack,[0,1,2,3,4]).id,pack.id);
  assert.throws(()=>selectBundleReels(pack,[]),/at least one/);
  assert.throws(()=>selectBundleReels(pack,[0,0]),/at least one/);
  assert.throws(()=>selectBundleReels(pack,[5]),/at least one/);
});

test('four and three input comparisons cover all small-pack subsets without using PETG as a colour',()=>{
  assert.equal(smallerBundleOptions(pack,4).length,5);
  const triples=compatibleBundleOptions([pack],4,true);
  assert.equal(triples.length,10);assert(triples.every(b=>bundleFit(b,4,true).fits));
  const colours={1:'#C12E1F',2:'#3F8E43',3:'#FFFFFF',4:'#000000'};
  const result=recommendWorkflow({sources:colours,bundles:triples,capacity:4,supportInterface:true});
  assert.equal(result.search.evaluated,10);
  assert(choices(result).length>0);
  for(const option of choices(result)){
    assert.equal(option.reels.filter(r=>r.role==='support-interface').length,1);
    const slot=option.reels.findIndex(r=>r.role==='support-interface')+1;
    assert(option.outcome.rows.filter(row=>row.recipe).every(({recipe:r})=>r.a!==slot&&r.b!==slot));
    assert.equal(option.omittedReels.length,2);
  }
  const deduped=compatibleBundleOptions(FILAMENT_BUNDLES.filter(b=>b.brand==='Bambu Lab'),4);
  assert.equal(deduped.length,5,'CMYK and CMYW catalogue entries do not duplicate the same pack subsets');
  const fromLoaded=recommendWorkflow({mode:'loaded',sources:colours,loaded:pack.reels,bundles:deduped,capacity:4});
  assert(choices(fromLoaded).every(option=>!option.usesLoaded&&option.reels.length===4),'pack alternatives are explicit replacements, not the old loaded setup');
});

test('large combinatorial searches require an explicit smaller selection',()=>{
  const big={...pack,reels:Array.from({length:24},(_,i)=>({...pack.reels[0],productId:'test/'+i}))};
  assert.throws(()=>smallerBundleOptions(big,12),/Select fewer reels/);
  assert.equal(smallerBundleOptions(big,24).length,1);
});

test('prioritising a small accent changes palette ranking without changing source paint or loaded reels',()=>{
  const sources={1:'#FF0000',2:'#0000FF'},weights={'#FF0000':100,'#0000FF':1};
  const bundles=Object.values(sources).map((color,i)=>({id:'choice-'+i,name:'Choice '+i,reels:[{color,type:'PLA'}]}));
  const original=structuredClone({sources,bundles});
  const base={sources,weights,bundles,capacity:1,blends:false};
  assert.equal(recommendWorkflow(base).bundleId,'choice-0');
  assert.equal(recommendWorkflow({...base,importantColours:['#0000FF']}).bundleId,'choice-1');
  assert.deepEqual({sources,bundles},original);
  assert.equal(scoreColourOutcome([],weights,['#0000FF']),0);
});
