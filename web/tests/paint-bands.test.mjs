import test from 'node:test';
import assert from 'node:assert/strict';
import {bandMesh} from '../shared/paintBands.js';
import {layerBounds,layerIndex} from '../shared/layerBands.js';
import {leafTriangles} from '../shared/standard.js';
import * as paint from '../shared/paint.js';

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
const dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2], normal=([a,b,c])=>cross(sub(b,a),sub(c,a));
const area=t=>Math.hypot(...normal(t))/2;
const scale=(vertices,s)=>vertices.map(p=>p.map(c=>c*s));
const corners=(out,piece)=>piece.v.map(i=>out.vertices[i]);

/** A closed unit sphere of 20 * 4^level faces, wound outwards, as indexed vertices and faces. */
function icosphere(level){
  const t=(1+Math.sqrt(5))/2,unit=v=>{const l=Math.hypot(...v);return v.map(c=>c/l);};
  const vertices=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(unit);
  let faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for(let s=0;s<level;s++){
    const mids=new Map(),mid=(a,b)=>{const k=a<b?a+','+b:b+','+a;
      if(!mids.has(k)){mids.set(k,vertices.length);vertices.push(unit(vertices[a].map((c,i)=>(c+vertices[b][i])/2)));}
      return mids.get(k);};
    faces=faces.flatMap(([a,b,c])=>{const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);return [[a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]];});
  }
  return {vertices,faces:faces.map(v=>({v}))};
}

/** A small seeded generator (mulberry32), so no test depends on Math.random. */
function generator(seed){
  let a=seed>>>0;
  return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
/** A valid split tree with states 1-4 whose deepest branch is exactly `depth` splits deep. */
function randomPaint(seed,depth){
  const next=generator(seed*7919+depth),pick=n=>Math.floor(next()*n);
  const build=(d,forced)=>{
    if(d===0||(!forced&&next()<0.4))return {kind:'leaf',state:1+pick(4)};
    const sides=1+pick(3),deep=pick(sides+1);
    return {kind:'split',sides,specialSide:pick(4),children:Array.from({length:sides+1},(_,i)=>build(d-1,forced&&i===deep))};
  };
  const tree=build(depth,true);
  assert.deepEqual(paint.decode(paint.encode(tree)),tree);   // a tree the file format can hold
  return tree;
}

/** Directed edge counts of indexed triangles. */
function directed(pieces){
  const m=new Map();
  for(const {v} of pieces)for(let i=0;i<3;i++){const k=v[i]+'>'+v[(i+1)%3];m.set(k,(m.get(k)||0)+1);}
  return m;
}
/** Every undirected index pair is used exactly twice, once each way. */
function manifold(pieces){
  const m=directed(pieces);
  for(const [k,n] of m){const [a,b]=k.split('>');if(n!==1||m.get(b+'>'+a)!==1)return false;}
  return m.size>0;
}
/** Directed edges with no partner running the other way. */
function openEdges(pieces){
  const m=directed(pieces);
  return [...m.keys()].filter(k=>{const [a,b]=k.split('>');return !m.has(b+'>'+a);}).map(k=>k.split('>').map(Number));
}
/** The area each state covers on each face, straight from the paint tree. */
function leafAreas(vertices,face){
  const m=new Map();
  for(const {triangle,state} of leafTriangles(face.v.map(i=>vertices[i]),face.paint))m.set(state,(m.get(state)||0)+area(triangle));
  return m;
}
function randomlyPainted(seed){
  const {vertices,faces}=icosphere(2);faces.forEach((f,i)=>f.paint=randomPaint(seed*1000+i,1+(i+seed)%5));
  return {vertices:scale(vertices,6),faces};
}
const opts={zOf:p=>p[2]+6,first:0.2,height:0.12};

test('a whole-painted closed mesh stays closed by index',()=>{
  const {vertices,faces}=icosphere(3);for(const f of faces)f.paint={kind:'leaf',state:1};
  for(const h of [0.08,0.12])assert.equal(manifold(bandMesh(scale(vertices,6),faces,{zOf:p=>p[2]+6,first:0.2,height:h}).pieces),true);
});
test('split paint next to whole paint leaves no gap',()=>{
  const {vertices,faces}=icosphere(2);faces.forEach((f,i)=>f.paint=i%3?{kind:'leaf',state:1}:randomPaint(i,3));
  const out=bandMesh(scale(vertices,6),faces,{zOf:p=>p[2]+6,first:0.2,height:0.12});
  assert.equal(manifold(out.pieces),true);
});
test('every face split to a different random depth leaves no gap',()=>{
  for(const seed of [1,2,3,4,5]){
    const {vertices,faces}=icosphere(2);faces.forEach((f,i)=>f.paint=randomPaint(seed*1000+i,1+(i+seed)%5));
    assert.equal(manifold(bandMesh(scale(vertices,6),faces,{zOf:p=>p[2]+6,first:0.2,height:0.12}).pieces),true);
  }
});
test('each state keeps its area on every face, with the winding kept',()=>{
  for(const seed of [1,2]){
    const {vertices,faces}=randomlyPainted(seed),out=bandMesh(vertices,faces,opts);
    const got=faces.map(()=>new Map());
    let lastFace=-1;
    for(const piece of out.pieces){
      assert.ok(piece.face>=lastFace,'pieces of one face are adjacent, in face order');lastFace=piece.face;
      const t=corners(out,piece),m=got[piece.face];
      m.set(piece.state,(m.get(piece.state)||0)+area(t));
      const n=normal(faces[piece.face].v.map(i=>vertices[i]));
      assert.ok(dot(normal(t),n)>0,`piece of face ${piece.face} is flipped or has no area`);
    }
    faces.forEach((face,i)=>{
      const want=leafAreas(vertices,face);
      assert.deepEqual([...got[i].keys()].sort(),[...want.keys()].sort(),`states on face ${i}`);
      for(const [state,a] of want)assert.ok(Math.abs(got[i].get(state)-a)<=1e-9*a,`face ${i} state ${state}: ${got[i].get(state)} against ${a}`);
    });
  }
});
test('pieces lie in one layer and one paint leaf, and input vertices keep their indices',()=>{
  const {vertices,faces}=randomlyPainted(3),before=structuredClone({vertices,faces});
  const out=bandMesh(vertices,faces,opts);
  assert.deepEqual(out.vertices.slice(0,vertices.length),vertices);
  assert.deepEqual({vertices,faces},before,'the input is not changed');
  const leaves=faces.map(f=>leafTriangles(f.v.map(i=>vertices[i]),f.paint));
  const inside=(p,[a,b,c])=>{                                   // barycentric test in the triangle's own plane
    const n=normal([a,b,c]),nn=dot(n,n);
    const u=dot(cross(sub(c,b),sub(p,b)),n)/nn,v=dot(cross(sub(a,c),sub(p,c)),n)/nn;
    return u>-1e-9&&v>-1e-9&&1-u-v>-1e-9;
  };
  const layers=new Set();
  for(const piece of out.pieces){
    const t=corners(out,piece),[lo,hi]=layerBounds(piece.layer,opts.first,opts.height);
    layers.add(piece.layer);
    for(const p of t)assert.ok(opts.zOf(p)>=lo-1e-6&&opts.zOf(p)<=hi+1e-6,`corner outside layer ${piece.layer}`);
    const centre=[0,1,2].map(i=>(t[0][i]+t[1][i]+t[2][i])/3);
    const home=leaves[piece.face].filter(l=>inside(centre,l.triangle));
    assert.ok(home.length>=1&&home.every(l=>l.state===piece.state),`piece of face ${piece.face} is not inside a leaf of state ${piece.state}`);
  }
  assert.ok(layers.size>90);                                    // a 12 mm sphere at 0.12 mm
});
test('an open input edge is the only kind of open edge in the output',()=>{
  const vertices=[[0,0,0],[4,0,0.4],[4.3,0.2,3],[0.1,0,3.2]];
  const outline=[[0,1],[1,2],[2,3],[3,0]];
  for(const seed of [11,12,13]){
    const faces=[{v:[0,1,2],paint:randomPaint(seed,4)},{v:[0,2,3],paint:randomPaint(seed+50,5)}];
    const out=bandMesh(vertices,faces,{zOf:p=>p[2],first:0.2,height:0.12});
    const open=openEdges(out.pieces);
    assert.ok(open.length>=4);
    const onSide=(p,[i,j])=>{const a=vertices[i],b=vertices[j],d=sub(b,a),t=dot(sub(p,a),d)/dot(d,d);
      return t>=-1e-12&&t<=1+1e-12&&Math.hypot(...cross(sub(p,a),d))/Math.hypot(...d)<1e-9;};
    for(const [a,b] of open){
      const p=out.vertices[a],q=out.vertices[b];
      assert.ok(outline.some(s=>onSide(p,s)&&onSide(q,s)),`open edge ${a}-${b} is not on the outline`);
    }
    const m=directed(out.pieces);                               // and every other edge is used once each way
    for(const [k,n] of m)assert.equal(n,1,`edge ${k} is used ${n} times one way`);
    const length=([a,b])=>Math.hypot(...sub(out.vertices[b],out.vertices[a]));
    const perimeter=outline.reduce((s,e)=>s+length(e),0);
    assert.ok(Math.abs(open.reduce((s,e)=>s+length(e),0)-perimeter)<1e-9*perimeter,'the open edges cover the outline once');
  }
});
test('appended vertices are unique and the result is repeatable',()=>{
  const {vertices,faces}=randomlyPainted(4),out=bandMesh(vertices,faces,opts);
  const n=vertices.length,appended=out.vertices.slice(n),seen=new Set(vertices.map(p=>p.join()));
  assert.ok(appended.length>n);
  for(const p of appended){const k=p.join();assert.ok(!seen.has(k),`vertex ${k} appears twice`);seen.add(k);}
  for(const piece of out.pieces)for(const i of piece.v)assert.ok(Number.isInteger(i)&&i>=0&&i<out.vertices.length);
  assert.deepEqual(bandMesh(vertices,faces,opts),out);
});
test('split paint over vertices on and beside the layer planes leaves no gap',()=>{
  // Midpoints of edges between two on-plane vertices are on the plane too, so runs of
  // several points on one plane occur along a side.
  for(const seed of [6,7]){
    const {vertices,faces}=randomlyPainted(seed);
    let snapped=0;
    vertices.forEach((p,i)=>{
      if(i%3===2)return;
      const k=Math.round((p[2]+6-0.2)/0.12);
      p[2]=0.2+k*0.12-6+(i%9===0?1e-8:i%9===4?-1e-8:0);snapped++;
    });
    assert.ok(snapped>vertices.length/2);
    const out=bandMesh(vertices,faces,opts);
    assert.equal(manifold(out.pieces),true);
    const total=out.pieces.reduce((s,piece)=>s+area(corners(out,piece)),0);
    const want=faces.reduce((s,f)=>s+area(f.v.map(i=>vertices[i])),0);
    assert.ok(Math.abs(total-want)<=1e-9*want,'no area is lost or doubled');
  }
});
test('a side with two points on one plane and its far end off it leaves no gap',()=>{
  // Equator vertices on the plane and 2e-7 mm (more than the tolerance) beside it: the
  // midpoint between them is within the tolerance, so a side holds two on-plane points.
  const plane=0.2+5*0.12,leaf=s=>({kind:'leaf',state:s});
  for(const dz of [2e-7,-2e-7]){
    const vertices=[[4,4,plane],[3,5,plane+dz],[2,4,plane],[3,3,plane+dz],[3,4,plane+1],[3,4,plane-1]];
    const faces=[];
    for(let i=0;i<4;i++){const a=i,b=(i+1)%4;faces.push({v:[a,b,4]},{v:[b,a,5]});}
    faces.forEach((f,i)=>f.paint=i%2?{kind:'split',sides:3,specialSide:0,children:[leaf(1),leaf(2),leaf(3),leaf(4)]}:leaf(1));
    const out=bandMesh(vertices,faces,{zOf:p=>p[2],first:0.2,height:0.12});
    assert.equal(manifold(out.pieces),true,`dz=${dz}`);
  }
});
test('a tilted placement is honoured',()=>{
  const {vertices,faces}=randomlyPainted(5),zOf=p=>0.6*p[0]+0.8*p[2]+3;
  const out=bandMesh(vertices,faces,{zOf,first:0.2,height:0.12});
  assert.equal(manifold(out.pieces),true);
  let byZ=0;
  for(const piece of out.pieces){
    const t=corners(out,piece),[lo,hi]=layerBounds(piece.layer,0.2,0.12);
    for(const p of t)assert.ok(zOf(p)>=lo-1e-6&&zOf(p)<=hi+1e-6);
    const centre=[0,1,2].map(i=>(t[0][i]+t[1][i]+t[2][i])/3);
    if(layerIndex(centre[2]+6,0.2,0.12)!==piece.layer)byZ++;
  }
  assert.ok(byZ>out.pieces.length/2,'layers follow zOf, not z');
});
test('bad heights are refused',()=>{
  const {vertices,faces}=icosphere(0);for(const f of faces)f.paint={kind:'leaf',state:1};
  assert.throws(()=>bandMesh(vertices,faces,{zOf:p=>p[2],first:0.2,height:0}),{name:'RangeError',message:'Layer heights must be positive numbers.'});
  assert.throws(()=>bandMesh(vertices,faces,{zOf:p=>p[2]>0.8?NaN:p[2],first:0.2,height:0.1}),{name:'RangeError',message:'Vertex heights must be finite numbers.'});
});
