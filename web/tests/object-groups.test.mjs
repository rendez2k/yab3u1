import test from 'node:test';
import assert from 'node:assert/strict';
import {objectGroup,groupQuantities,quantityRows} from '../shared/objectQuantities.js';
import {Preview} from '../shared/preview.js';

const objects=[
  {objectId:'stem',name:'Green stem',colours:[{extruder:3,color:'#008000'}]},
  {objectId:'pumpkin',name:'Painted pumpkin',colours:[{extruder:1,color:'#FF8800'},{extruder:3,color:'#008000'}]},
  {objectId:'unknown',name:'Unknown paint',undecodable:1,colours:[{extruder:3,color:'#008000'}]},
];
test('remove a single-colour group preserves multicolour and unknown-paint objects',()=>{
  assert.deepEqual(groupQuantities(objects,{pumpkin:5},'filament:3','remove'),{stem:0,pumpkin:5,unknown:1});
  assert.equal(objectGroup(objects[2]),'unknown');
});
test('keep only a group and restore whole objects without changing paint',()=>{
  const before=structuredClone(objects);
  assert.deepEqual(groupQuantities(objects,{stem:0,pumpkin:5},'filament:3','only'),{stem:1,pumpkin:0,unknown:0});
  assert.deepEqual(groupQuantities(objects,{stem:0},'all','restore'),{stem:1,pumpkin:1,unknown:1});
  assert.deepEqual(objects,before);
});
test('source filaments remain distinct even when their RGB colours match',()=>{
  const same={objectId:'other',colours:[{extruder:4,color:'#008000'}]};
  assert.equal(groupQuantities([...objects,same],{},'filament:3','remove').other,1);
  const html=quantityRows([{...objects[0],name:'<b>"Stem"</b>'}]);
  assert.ok(html.includes('&lt;b&gt;&quot;Stem&quot;&lt;/b&gt;'));
  assert.ok(!html.includes('Quantity for <'));
});
test('top view frames the bed, resets overhead and keeps geometry unchanged',()=>{
  const preview=Object.create(Preview.prototype);
  preview.view='top';preview.bounds={lo:[10,10,0],hi:[30,40,50],size:[20,30,50]};
  preview.plate={bounds:{lo:[0,0,-.35],hi:[270,270,0]}};
  preview.canvas={clientWidth:700,clientHeight:400};preview.requestDraw=()=>{};
  const before=structuredClone(preview.bounds);preview.reset();
  assert.equal(preview.frameBounds().hi[0],270);assert.equal(preview.yaw,0);
  assert.ok(preview.pitch>1.56);assert.ok(Number.isFinite(preview.distance));
  assert.deepEqual(preview.bounds,before);
});
