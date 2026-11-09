import {decode,encode} from '../../web/shared/paint.js';
import {leafTriangles} from '../../web/shared/standard.js';
import {cutMesh} from './mesh-cut.js';
import {closeInterface} from './mesh-joint.js';
import {conformCut} from './conform-cut.js';
const paintRE=/(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9a-f]*)"/i;
const paintLeaf=n=>` paint_color="${encode({kind:'leaf',state:n})}"`;
const stripPaint=s=>s.replace(/\s*(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="[^"]*"/g,'');

const hasAttachedPin=connector=>connector&&(connector.kind||'pin')==='pin';
const vertexKey=p=>p.map(v=>Math.round(v*1e6)).join(',');
const edgeKeys=f=>f.points.map((p,i)=>{const a=vertexKey(p),b=vertexKey(f.points[(i+1)%3]);return a<b?`${a}|${b}`:`${b}|${a}`;});

// Resolving one painted triangle can subdivide its neighbours' edges. Resolve
// the touching painted component in one pass, so conformity does not walk one
// triangle per iteration across a long painted boundary.
function paintedNeighbours(faces,crosses,nodeFor){
  const edges=new Map(),keys=new Map(),wanted=new Set(),queue=[];
  for(const [i,f]of faces.entries()){
    if(nodeFor(f)?.kind!=='split')continue;
    const ks=edgeKeys(f);keys.set(i,ks);
    for(const k of ks){if(!edges.has(k))edges.set(k,[]);edges.get(k).push(i);}
    if(crosses(f)){wanted.add(i);queue.push(i);}
  }
  for(let cursor=0;cursor<queue.length;cursor++)for(const k of keys.get(queue[cursor]))for(const i of edges.get(k))if(!wanted.has(i)){wanted.add(i);queue.push(i);}
  return wanted;
}

// Preserve untouched paint trees and resolve only triangles crossed by the plane.
export function cutPaintedPart(part,axis,height,connector,{singleJoin=false,conform=false}={}){
  const nodes=new Map(),nodeFor=f=>{const code=paintRE.exec(f.attrs)?.[1];if(!code)return null;if(!nodes.has(code))nodes.set(code,decode(code));return nodes.get(code);};
  const expand=f=>{
    for(const a of f.attrs.matchAll(/(?:support|seam)[\w:]*="([0-9a-f]+)"/gi))if(decode(a[1]).kind!=='leaf')throw Error('The cut crosses subdivided support or seam painting. Move the cut, or make this cut in the slicer.');
    const node=nodeFor(f);
    return node?.kind==='split'?[...leafTriangles(f.points,node)].map(leaf=>({points:leaf.triangle,attrs:stripPaint(f.attrs)+paintLeaf(leaf.state||part.base)})):[f];
  };
  const faces=[],crosses=f=>f.points.some(p=>p[axis]<height-1e-6)&&f.points.some(p=>p[axis]>height+1e-6);
  const neighbours=conform?paintedNeighbours(part.faces,crosses,nodeFor):new Set();
  for(const [i,f]of part.faces.entries()){
    if(!crosses(f)&&!neighbours.has(i)){faces.push(f);continue;}
    for(const leaf of expand(f))faces.push(leaf);
    if(conform&&faces.length>2000000)throw Error('The painted cut would exceed two million triangles. Simplify a copy before splitting.');
  }
  if(faces.every(f=>f.points.every(p=>p[axis]>=height-1e-6)))return {parts:[null,part],loose:[]};
  if(faces.every(f=>f.points.every(p=>p[axis]<=height+1e-6)))return {parts:[part,null],loose:[]};
  const cut=cutMesh(faces,axis,height,paintLeaf(part.base));
  if(singleJoin&&cut.loops.length!==1)throw Error('This narrow section crosses several joins. Use a plane cut to review the intersected parts.');
  const joined=connector?closeInterface(...cut.openHalves,cut.loops,{normal:[0,1,2].map(i=>i===axis?1:0),attrsA:paintLeaf(part.base),attrsB:paintLeaf(part.base),connector}):{halves:cut.halves};
  const pinSide=connector?.side==='base'?0:1;
  return {parts:joined.halves.map((f,i)=>({...part,faces:conform?conformCut(f,expand):f,pinDirections:hasAttachedPin(connector)&&joined.joint&&i===pinSide?[joined.joint.normal.map(v=>v*(pinSide===0?1:-1))]:[]})),joint:joined.joint,loose:(joined.loose||[]).map(faces=>({faces,joint:joined.joint}))};
}
