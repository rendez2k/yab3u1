import test from 'node:test';
import assert from 'node:assert/strict';
import {plateGeometry, Preview, fitDistance} from '../shared/preview.js';
import {targetLayout} from '../shared/layout.js';

test('U1 plate and tower use the planner origin without moving model geometry', () => {
  const options = targetLayout('snapmaker', {tower:true});
  const plate = plateGeometry(options);
  assert.deepEqual(plate.bounds.lo, [.5,1,-.35]);
  assert.deepEqual(plate.bounds.hi, [270.5,271,0]);
  assert.deepEqual(plate.description.reservations, [{...options.towerBox,kind:'tower'}]);
  assert.equal(plate.position.length, plate.color.length);
  assert.equal(plate.position.length, plate.normal.length);
  assert.ok(plate.position.every(Number.isFinite));
  const preview = Object.create(Preview.prototype);
  preview.view='plate'; preview.plate=plate;
  preview.bounds={lo:[-20,10,0],hi:[90,150,50],size:[110,140,50],centre:[35,80,25]};
  const original=structuredClone(preview.bounds);
  assert.deepEqual(preview.frameBounds().lo.slice(0,2),[-20,1]);
  assert.ok(Math.abs(preview.frameBounds().lo[2]+.35)<1e-6);
  assert.equal(preview.frameBounds().hi[0],270.5);
  assert.deepEqual(preview.bounds,original);
  preview.view='model';
  assert.equal(preview.frameBounds(),preview.bounds);
  assert.ok(fitDistance(plate.bounds.hi, .5)>fitDistance(plate.bounds.hi, 2));
});

test('responsive resizing preserves the relative zoom and orbit', () => {
  const preview=Object.create(Preview.prototype);
  preview.ok=true;preview.view='model';preview.yaw=.3;preview.pitch=.8;
  preview.bounds={size:[150,150,60]};preview.viewportAspect=2;
  preview.canvas={width:800,height:400,clientWidth:300,clientHeight:400};
  preview.distance=fitDistance(preview.bounds.size,2,.3,.8)*1.2;
  preview.requestDraw=()=>{};
  globalThis.window={devicePixelRatio:1};
  try {
    preview.resize();
    assert.ok(Math.abs(preview.distance/fitDistance(preview.bounds.size,.75,.3,.8)-1.2)<1e-9);
    assert.equal(preview.yaw,.3);assert.equal(preview.pitch,.8);
  } finally { delete globalThis.window; }
});

test('generic tower strips, printer keepouts and disabled reservation remain distinct', () => {
  const plate=plateGeometry({width:256,depth:200,centre:[0,0],tower:true,
    keepoutBoxes:[{min:[20,30],max:[40,50]}]});
  assert.equal(plate.description.reservations.length,3);
  assert.equal(plate.description.reservations[0].kind,'keepout');
  assert.deepEqual(plate.description.reservations[2].min,[231,0]);
  assert.equal(plateGeometry({width:256,depth:200,tower:false}).description.reservations.length,0);
  for (const options of [null,{width:NaN,depth:270},{width:270,depth:0},{width:270,depth:270,centre:[Infinity,0]}])
    assert.equal(plateGeometry(options),null);
});

test('drawing rebinds model buffers after the separate plate pass', () => {
  const calls=[];
  const preview=Object.create(Preview.prototype);
  preview.ok=true;preview.canvas={width:800,height:500};preview.count=3;
  preview.bounds={lo:[0,0,0],hi:[10,10,10],size:[10,10,10],centre:[5,5,5]};
  preview.plate=plateGeometry({width:270,depth:270});
  preview.plate.buffers={position:'bedP',color:'bedC',normal:'bedN'};
  preview.buffers={position:'modelP',color:'modelC',normal:'modelN'};
  preview.attributes={position:0,color:1,normal:2};preview.uniforms={};
  preview.view='plate';preview.distance=500;preview.yaw=-.6;preview.pitch=.78;preview.pan=[0,0];
  preview.gl=new Proxy({TRIANGLES:'triangles',bindBuffer:(_,b)=>calls.push(b),
    drawArrays:(_,start,count)=>calls.push(count)}, {get:(target,name)=>target[name]??(()=>{})});
  preview.draw();
  assert.deepEqual(calls.slice(-4),['modelP','modelC','modelN',3]);
  assert.deepEqual(calls.slice(0,3),['bedP','bedC','bedN']);
  calls.length=0;preview.view='model';preview.draw();
  assert.deepEqual(calls,['modelP','modelC','modelN',3]);
});
