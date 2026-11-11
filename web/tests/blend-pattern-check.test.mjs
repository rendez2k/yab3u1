import test from 'node:test';
import assert from 'node:assert/strict';
import {blendPatterns, blendTally, judgeBlends} from '../../tools/blendPatternCheck.mjs';
import {definitions, wallPatternRow} from '../shared/targets.js';

const cfg=rows=>({filament_colour:['#00FFFFFF','#FF00FFFF','#FFFF00FF','#FFFFFFFF'],mixed_filament_definitions:rows.join(';')});

test('the blend table is read as the app writes it: pattern rows, ratio rows, disabled rows skipped',()=>{
  const rows=definitions(4,[{a:1,b:2,percent:50},{a:2,b:3,percent:17,c:4,percentC:66}]);
  const table=blendPatterns(cfg(rows));
  assert.equal(table.physical,4);assert.deepEqual([...table.blends.keys()],[5,6]);
  assert.deepEqual(table.blends.get(5),{kind:'ratio',a:1,b:2,percent:50,row:rows[0]});
  assert.equal(table.blends.get(6).kind,'pattern');assert.equal(table.blends.get(6).outer.length,6);assert.equal(table.blends.get(6).inner,null);
  const fine=blendPatterns(cfg([wallPatternRow({a:3,b:4,percent:60},1)]));
  assert.deepEqual(fine.blends.get(5).outer,[4,3,4,3,4]);assert.deepEqual(fine.blends.get(5).inner,[3,4,3,4,4]);
});

test('a pattern the slicer follows passes at whatever layer it starts; one it ignores fails',()=>{
  const table=blendPatterns(cfg([wallPatternRow({a:3,b:4,percent:60},1)])),pattern=table.blends.get(5).outer;
  const run=tool=>{const tally=blendTally(4);for(let layer=1;layer<=60;layer+=1)tally.add(layer,{kind:'wrong',length:10,tool:tool(layer),reel:5});return judgeBlends(tally.data,table);};
  const followed=run(layer=>pattern[(layer+2)%pattern.length]-1);
  assert.equal(followed.pass,true);assert.equal(followed.results[0].offset,2);assert.equal(followed.results[0].matchedShare,1);
  const ignored=run(layer=>(layer%2?2:3));
  assert.equal(ignored.pass,false);assert.ok(ignored.results[0].matchedShare<0.9);
  // Physical reels and hidden wall are not counted; a blend with almost no wall is not judged.
  const tally=blendTally(4);tally.add(1,{kind:'matched',length:50,tool:0,reel:1});tally.add(1,{kind:'hidden',length:50,tool:0,reel:5});tally.add(1,{kind:'wrong',length:5,tool:3,reel:5});
  const thin=judgeBlends(tally.data,table);
  assert.equal(thin.results[0].judged,5);assert.equal(thin.results[0].pass,null);assert.equal(thin.pass,false);assert.equal(thin.judgedBlends,0);
});

test('a ratio blend is reported, not judged',()=>{
  const table=blendPatterns(cfg(definitions(4,[{a:1,b:2,percent:25}])));
  const tally=blendTally(4);for(let layer=1;layer<=40;layer+=1)tally.add(layer,{kind:'wrong',length:10,tool:layer%4?0:1,reel:5});
  const out=judgeBlends(tally.data,table);
  assert.equal(out.results[0].pass,null);assert.equal(out.results[0].reelShares[2],0.25);assert.equal(out.results[0].expected[2],0.25);
});
