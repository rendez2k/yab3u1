import test from 'node:test';
import assert from 'node:assert/strict';
import {layerIndex,layerBounds,bandTriangle} from '../shared/layerBands.js';
const zOf=p=>p[2], area=t=>{const [a,b,c]=t,u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};

test('layer numbering follows first layer then fixed height',()=>{
  assert.equal(layerIndex(0.1,0.2,0.08),0);
  assert.equal(layerIndex(0.2,0.2,0.08),1);
  assert.equal(layerIndex(0.2799999,0.2,0.08),1);
  assert.equal(layerIndex(0.28,0.2,0.08),2);
  assert.deepEqual(layerBounds(2,0.2,0.08).map(v=>Number(v.toFixed(6))),[0.28,0.36]);
});
test('a wall triangle is cut into one strip per layer with its area preserved',()=>{
  const tri=[[0,0,0.2],[1,0,0.2],[0,0,0.52]];           // spans layers 1..4
  const out=bandTriangle(tri,zOf,0.2,0.08);
  assert.deepEqual([...new Set(out.map(t=>t.layer))].sort(),[1,2,3,4]);
  assert.ok(Math.abs(out.reduce((n,t)=>n+area(t.points),0)-area(tri))<1e-9);
  for(const t of out)for(const p of t.points)assert.ok(layerIndex(p[2]-1e-7,0.2,0.08)<=t.layer&&layerIndex(p[2]+1e-7,0.2,0.08)>=t.layer);
});
test('a flat triangle inside one layer is returned unchanged',()=>{
  const tri=[[0,0,0.3],[1,0,0.3],[0,1,0.3]];
  assert.deepEqual(bandTriangle(tri,zOf,0.2,0.08),[{points:tri,layer:2}]);
});
test('winding is kept and neighbours sharing an edge get identical cut points',()=>{
  const a=bandTriangle([[0,0,0],[1,0,0],[0,0,1]],zOf,0.2,0.1),b=bandTriangle([[1,0,0],[1,0,1],[0,0,1]],zOf,0.2,0.1);
  const onEdge=list=>new Set(list.flatMap(t=>t.points).filter(p=>Math.abs(p[0]+p[2]-1)<1e-9).map(p=>p.map(v=>v.toFixed(7)).join()));
  assert.deepEqual([...onEdge(a)].sort(),[...onEdge(b)].sort());
  for(const t of a){const [p,q,r]=t.points;assert.ok((q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2])<=1e-12);}   // same facing as the input (normal y < 0)
});
