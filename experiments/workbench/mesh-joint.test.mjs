import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cutMesh,signedVolume} from './mesh-cut.js';
import {closeInterface,separateColour} from './mesh-joint.js';
const vertices=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
const indices=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const cube=indices.map(ids=>({points:ids.map(i=>vertices[i]),attrs:' source="kept"',colour:1}));
function manifold(faces){const edges=new Map(),key=p=>p.map(n=>n.toFixed(6)).join(',');for(const f of faces)for(let i=0;i<3;i++){const a=key(f.points[i]),b=key(f.points[(i+1)%3]),k=[a,b].sort().join('|'),e=edges.get(k)||{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(k,e);}assert([...edges.values()].every(e=>e.count===2&&e.direction===0),'every edge has exactly two oppositely wound faces');}
const painted=()=>cutMesh(cube,2,5).openHalves.flatMap((faces,i)=>faces.map(f=>({...f,colour:i+1})));

test('pins and blind sockets are closed solids on either side of all three cut axes',()=>{
  for(const axis of [0,1,2])for(const side of ['selected','base']){
    const cut=cutMesh(cube,axis,5),normal=[0,1,2].map(i=>i===axis?1:0),connector={diameter:3,length:3,clearance:.3,side};
    const {halves,joint}=closeInterface(...cut.openHalves,cut.loops,{normal,connector,attrsA:' a="1"',attrsB:' b="2"'});
    halves.forEach(manifold);assert.equal(joint.socketDiameter,3.3);assert.equal(joint.socketDepth,3.2);
    const pin=side==='selected'?1:0,socket=1-pin;
    const area=r=>40/2*r*r*Math.sin(2*Math.PI/40);
    assert(Math.abs(signedVolume(halves[pin])-500-area(1.5)*3)<1e-7);
    assert(Math.abs(signedVolume(halves[socket])-500+area(1.65)*3.2)<1e-7);
    assert(halves[pin].some(f=>f.points.every(p=>Math.abs(p[axis]-(side==='selected'?2:8))<1e-6)));
  }
});
test('colour separation preserves surfaces and volume and closes both sides of a painted join',()=>{
  const source=painted(),saved=JSON.stringify(source),split=separateColour(source,2);
  assert.equal(split.parts.length,1);manifold(split.remaining);manifold(split.parts[0]);
  assert(Math.abs(signedVolume(split.remaining)-500)<1e-7);assert(Math.abs(signedVolume(split.parts[0])-500)<1e-7);assert.equal(JSON.stringify(source),saved);
  const joint=separateColour(source,2,{connector:{diameter:3,length:2,clearance:.2}});
  assert.equal(joint.joints.length,1);manifold(joint.remaining);manifold(joint.parts[0]);
  assert(joint.parts[0].some(f=>f.attrs.includes('source')));
});
test('invalid dimensions, thin receivers, open paint and surface-only patches fail without editing input',()=>{
  const source=painted(),saved=JSON.stringify(source);
  for(const connector of [{diameter:15},{length:10},{clearance:0},{length:NaN}])assert.throws(()=>separateColour(source,2,{connector}),/pin|solid|clearance/i);
  const patch=cube.map((f,i)=>({...f,colour:i===2||i===3?2:1}));assert.throws(()=>separateColour(patch,2),/surface patch/);
  assert.throws(()=>separateColour(source.slice(0,-1),2),/mismatched|open|winding|branching/);
  assert.throws(()=>separateColour(source,3),/not painted/);assert.equal(JSON.stringify(source),saved);
});
test('already separate colour objects can be extracted but cannot receive an invented connector',()=>{
  const other=cube.map(f=>({...f,colour:2,points:f.points.map(p=>p.map((v,i)=>v+(i===0?15:0)))})),faces=[...cube,...other];
  const result=separateColour(faces,2);assert.equal(result.parts.length,1);manifold(result.parts[0]);manifold(result.remaining);
  assert.throws(()=>separateColour(faces,2,{connector:{}}),/already a disconnected part/);
});
test('targeting one region keeps the other regions of the same colour unchanged',()=>{
  const a=painted(),b=a.map(f=>({...f,points:f.points.map(p=>[p[0]+25,p[1],p[2]])})),source=[...a,...b],before=JSON.stringify(source);
  const split=separateColour(source,2,{region:0,connector:{diameter:3,length:2,clearance:.2}});
  assert.equal(split.parts.length,1);assert(split.remaining.some(f=>f.colour===2));split.parts.forEach(manifold);manifold(split.remaining);
  assert.equal(JSON.stringify(source),before);assert.throws(()=>separateColour(source,2,{region:2}),/no longer available/);
});
test('a curved paint seam has identical mating cap triangles outside the socket',()=>{
  const cut=cutMesh(cube,2,5),bend=p=>[p[0],p[1],p[2]+(Math.abs(p[2]-5)<1e-6?.18*Math.cos(p[0]*.8)*Math.sin(p[1]*.7):0)];
  const open=cut.openHalves.map(faces=>faces.map(f=>({...f,points:f.points.map(bend)}))),loops=cut.loops.map(l=>l.map(bend));
  const {halves}=closeInterface(...open,loops,{normal:[0,0,1],attrsA:'capA',attrsB:'capB',connector:{diameter:3,length:2,clearance:.3}});
  halves.forEach(manifold);
  const pointKey=p=>p.map(v=>v.toFixed(6)).join(','),rim=new Set(loops.flat().map(pointKey));
  const outer=(faces,attrs)=>new Set(faces.filter(f=>f.attrs===attrs&&f.points.some(p=>rim.has(pointKey(p)))).map(f=>f.points.map(pointKey).sort().join('|')));
  assert.deepEqual(outer(halves[0],'capA'),outer(halves[1],'capB'));
});
