import test from 'node:test';
import assert from 'node:assert/strict';
import {restingFaces,turnParts} from './orientation.js';
import {signedVolume} from './mesh-cut.js';

// A closed wedge: 20 x 10 footprint, 10 tall at x=0, sloping to nothing at x=20.
const P=[[0,0,0],[20,0,0],[20,10,0],[0,10,0],[0,0,10],[0,10,10]];
const tri=(a,b,c)=>({points:[P[a],P[b],P[c]],attrs:''});
const wedge=()=>[{subtype:'normal_part',faces:[tri(0,2,1),tri(0,3,2),tri(0,1,4),tri(3,5,2),tri(0,4,5),tri(0,5,3),tri(1,2,5),tri(1,5,4)]}];
const box=parts=>{const lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];for(const p of parts)for(const f of p.faces)for(const v of f.points)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],v[i]);hi[i]=Math.max(hi[i],v[i]);}return hi.map((v,i)=>+(v-lo[i]).toFixed(6));};
const volume=parts=>+signedVolume(parts[0].faces).toFixed(6);

test('quarter turns are exact, keep volume and winding, and four of them return the original',()=>{
  const start=wedge();assert.equal(volume(start),1000);
  const x=turnParts(start,{axis:0,degrees:90});assert.deepEqual(box(x),[20,10,10]);assert.equal(volume(x),1000);
  const y=turnParts(start,{axis:1,degrees:90});assert.deepEqual(box(y),[10,10,20]);assert.equal(volume(y),1000);
  const z=turnParts(start,{axis:2,degrees:-90});assert.deepEqual(box(z),[10,20,10]);assert.equal(volume(z),1000);
  let again=start;for(let i=0;i<4;i++)again=turnParts(again,{axis:1,degrees:90});
  assert.deepEqual(again[0].faces.map(f=>f.points),start[0].faces.map(f=>f.points));
  assert.deepEqual(turnParts(turnParts(start,{axis:0,degrees:180}),{axis:0,degrees:180})[0].faces.map(f=>f.points),start[0].faces.map(f=>f.points));
  assert.throws(()=>turnParts(start,{axis:0,degrees:45}),/quarter or half turn/);
});
test('lay flat rests the object on its largest supporting face',()=>{
  const start=wedge(),faces=restingFaces(start);
  // The slope (about 223.6 mm²) is larger than the base (200 mm²).
  assert(Math.abs(faces[0].area-Math.hypot(20,10)*10)<1e-6);assert(faces[0].normal[2]>0);
  const flat=turnParts(start,{flat:true});assert.equal(volume(flat),1000);
  const [down]=restingFaces(flat);assert(Math.abs(down.normal[2]+1)<1e-9);assert(Math.abs(down.area-faces[0].area)<1e-6);
  assert.throws(()=>turnParts(flat,{flat:true}),/already rests/);
});
test('flat areas inside a hollow or too small to matter are not offered',()=>{
  // An open-topped tray: the inner floor is flat but not a supporting plane.
  const outer=wedge()[0].faces,inner={points:[[5,2,2],[15,2,2],[10,8,2]],attrs:''};
  const faces=restingFaces([{subtype:'normal_part',faces:[...outer,inner]}]);
  assert(faces.every(f=>Math.abs(f.area-30)>1e-6));
  const sphere=[];for(let i=0;i<40;i++)for(let j=0;j<20;j++){const a=i/40*2*Math.PI,b=(i+1)/40*2*Math.PI,t=j/20*Math.PI,u=(j+1)/20*Math.PI,pt=(p,q)=>[Math.sin(q)*Math.cos(p),Math.sin(q)*Math.sin(p),Math.cos(q)];sphere.push({points:[pt(a,t),pt(a,u),pt(b,u)]},{points:[pt(a,t),pt(b,u),pt(b,t)]});}
  assert.throws(()=>turnParts([{subtype:'normal_part',faces:sphere}],{flat:true}),/No flat area/);
});
test('uniform scale multiplies every dimension and the volume by its cube',()=>{
  const start=wedge(),big=turnParts(start,{scale:1.5});assert.deepEqual(box(big),[30,15,15]);assert.equal(volume(big),3375);
  assert.deepEqual(box(turnParts(start,{scale:.5})),[10,5,5]);
  assert.throws(()=>turnParts(start,{scale:1}),/already at 100%/);assert.throws(()=>turnParts(start,{scale:20}),/between 10% and 1000%/);assert.throws(()=>turnParts(start,{scale:NaN}),/between 10% and 1000%/);
});
