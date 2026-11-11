import test from 'node:test';
import assert from 'node:assert/strict';
import {layerIndex,layerBounds,bandTriangle,layerPlanes} from '../shared/layerBands.js';
const zOf=p=>p[2], area=t=>{const [a,b,c]=t,u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
const normal=([a,b,c])=>cross(sub(b,a),sub(c,a)), dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
const lineDistance=(p,a,b)=>Math.hypot(...cross(sub(p,a),sub(b,a)))/Math.hypot(...sub(b,a));

const key=p=>p.join();                                  // exact, no rounding
const edges=tris=>{const m=new Map();for(const t of tris)for(let i=0;i<3;i++){const a=key(t.points[i]),b=key(t.points[(i+1)%3]);m.set(a+'>'+b,(m.get(a+'>'+b)||0)+1);}return m;};
const closed=tris=>{const m=edges(tris);for(const [k,n] of m){const [a,b]=k.split('>');if(n!==1||m.get(b+'>'+a)!==1)return false;}return true;};

/** A closed sphere of 20 * 4^level faces, wound outwards, with every shared vertex the same array. */
function icosphere(level,centre,radius){
  const t=(1+Math.sqrt(5))/2;
  let dirs=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
  let faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const unit=v=>{const l=Math.hypot(...v);return v.map(c=>c/l);};
  dirs=dirs.map(unit);
  for(let s=0;s<level;s++){
    const mids=new Map(),mid=(a,b)=>{const k=a<b?a+','+b:b+','+a;
      if(!mids.has(k)){mids.set(k,dirs.length);dirs.push(unit([(dirs[a][0]+dirs[b][0])/2,(dirs[a][1]+dirs[b][1])/2,(dirs[a][2]+dirs[b][2])/2]));}
      return mids.get(k);};
    faces=faces.flatMap(([a,b,c])=>{const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);return [[a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]];});
  }
  const verts=dirs.map(d=>d.map((c,i)=>centre[i]+radius*c));
  return faces.map(f=>f.map(i=>verts[i]));
}
/** A closed octahedron, wound outwards, whose four equator vertices sit at height zEquator. */
function octahedron(zEquator){
  const top=[3,4,zEquator+1],bottom=[3,4,zEquator-1],ring=[[4,4,zEquator],[3,5,zEquator],[2,4,zEquator],[3,3,zEquator]],faces=[];
  for(let i=0;i<4;i++){const a=ring[i],b=ring[(i+1)%4];faces.push([a,b,top],[b,a,bottom]);}
  return faces;
}

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
  const onEdge=list=>new Set(list.flatMap(t=>t.points).filter(p=>Math.abs(p[0]+p[2]-1)<1e-9).map(key));
  assert.deepEqual([...onEdge(a)].sort(),[...onEdge(b)].sort());
  for(const t of a){const [p,q,r]=t.points;assert.ok((q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2])<=1e-12);}   // same facing as the input (normal y < 0)
});
test('strips of one triangle share bit-identical points',()=>{
  const tri=[[0,0,0.05],[7.3,1.1,3.37],[2.2,9.4,11.913]];
  const onSide=(p,q)=>[0,1,2].some(i=>{const a=tri[i],b=tri[(i+1)%3];return lineDistance(p,a,b)<1e-9&&lineDistance(q,a,b)<1e-9;});
  for(const h of [0.08,0.12]){
    const out=bandTriangle(tri,p=>p[2],0.2,h);
    const m=edges(out);let matched=0;
    for(const [k,n] of m){
      assert.equal(n,1);
      const [a,b]=k.split('>');
      if(m.has(b+'>'+a)){matched++;continue;}
      assert.ok(onSide(a.split(',').map(Number),b.split(',').map(Number)),`unmatched edge ${k} is not on a side of the triangle (h=${h})`);
    }
    assert.ok(matched>0);
  }
});
test('a closed solid stays closed, exactly, at 0.08 and 0.12',()=>{
  for(const h of [0.08,0.12]){
    const solid=icosphere(3,[5.1,4.9,6.03],5.77);
    assert.equal(solid.length,1280);
    assert.equal(closed(solid.map(points=>({points}))),true);
    assert.equal(closed(solid.flatMap(points=>bandTriangle(points,p=>p[2],0.2,h))),true);
  }
});
test('vertices on and within tolerance of a boundary do not open the mesh',()=>{
  // an octahedron whose equator sits at z = 0.2 + 5*0.12 exactly, and one moved by +4e-8 and by -4e-8
  for(const dz of [0,4e-8,-4e-8]){
    const solid=octahedron(0.2+5*0.12+dz);
    assert.equal(closed(solid.map(points=>({points}))),true);
    assert.equal(closed(solid.flatMap(points=>bandTriangle(points,p=>p[2],0.2,0.12))),true);
  }
});
test('area and winding are kept through a tilted placement',()=>{
  const zOf=p=>0.6*p[0]+0.8*p[2]+1;                               // not the identity
  const tri=[[0,0,0],[4,0,1],[1,5,3]],out=bandTriangle(tri,zOf,0.2,0.12);
  assert.ok(out.length>1);
  assert.ok(Math.abs(out.reduce((s,t)=>s+area(t.points),0)-area(tri))<1e-9);
  for(const t of out)assert.ok(dot(normal(t.points),normal(tri))>0||area(t.points)===0);
  for(const t of out)for(const p of t.points){const [lo,hi]=layerBounds(t.layer,0.2,0.12);assert.ok(zOf(p)>=lo-1e-6&&zOf(p)<=hi+1e-6);}
});
test('layer planes are computed by multiplication',()=>{
  assert.deepEqual(layerPlanes(0.25,0.5,0.2,0.12),[0.2+1*0.12,0.2+2*0.12]);
  assert.deepEqual(layerPlanes(0,0.2,0.2,0.12),[]);
});
test('a vertex just below a boundary, outside the tolerance, stays in its own layer',()=>{
  // s = 0.999999 is 1.00000000003e-6 below boundary 1: not on it, and inside layer 1
  const tri=[[0,0,0.5],[1,0,0.999999],[0,1,0.5]],out=bandTriangle(tri,p=>p[2],0,1);
  assert.equal(out.length,1);
  assert.equal(out[0].layer,1);
  assert.deepEqual(out[0].points,tri);
});
test('non-finite vertex heights are refused',()=>{
  const message='Vertex heights must be finite numbers.';
  for(const z of [NaN,Infinity,-Infinity]){
    assert.throws(()=>bandTriangle([[0,0,0.3],[1,0,z],[0,1,0.3]],p=>p[2],0.2,0.12),{name:'RangeError',message});
    assert.throws(()=>layerPlanes(0.3,z,0.2,0.12),{name:'RangeError',message});
    assert.throws(()=>layerPlanes(z,0.3,0.2,0.12),{name:'RangeError',message});
  }
});
test('a closed solid with vertices on and beside the boundaries stays exactly closed with no zero-area piece',()=>{
  const first=0.2,h=0.12,solid=icosphere(3,[5.1,4.9,6.03],5.77);
  const verts=[...new Set(solid.flat())];                  // shared arrays, so moving one moves it in every face
  let onPlane=0,beside=0;
  verts.forEach((p,i)=>{
    if(i%2)return;
    const k=Math.round((p[2]-first)/h);
    p[2]=first+k*h+(i%10===0?1e-8:i%10===4?-1e-8:0);
    if(i%10===0||i%10===4)beside++;else onPlane++;
  });
  assert.ok(onPlane>verts.length*0.25&&beside>verts.length*0.1);
  assert.equal(closed(solid.map(points=>({points}))),true);
  const out=solid.flatMap(points=>bandTriangle(points,p=>p[2],first,h));
  assert.ok(out.length>solid.length);
  assert.equal(closed(out),true);
  for(const t of out)assert.ok(area(t.points)>0,`zero-area piece in layer ${t.layer}`);
});
test('bad heights are refused and the input is never returned by reference',()=>{
  const tri=[[0,0,0.3],[1,0,0.3],[0,1,0.3]];
  assert.throws(()=>bandTriangle(tri,p=>p[2],0.2,0),RangeError);
  assert.throws(()=>bandTriangle(tri,p=>p[2],0.2,NaN),RangeError);
  assert.throws(()=>bandTriangle(tri,p=>p[2],-0.1,0.12),{name:'RangeError',message:'Layer heights must be positive numbers.'});
  assert.throws(()=>layerPlanes(0,1,0.2,0),RangeError);
  assert.notEqual(bandTriangle(tri,p=>p[2],0.2,0.12)[0].points,tri);
});
