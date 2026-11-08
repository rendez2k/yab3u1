// Deterministic surface paths. Points snap to the source mesh; no preview mesh
// is ever used to cut or repaint the exported model.
const key=p=>p.map(v=>Math.round(v*1e6)).join(',');
const edge=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export function surfaceGraph(faces){
  if(faces.length>750000)throw Error('Draw a boundary on a part with fewer than 750,000 triangles.');
  const vertices=[],lookup=new Map(),neighbours=[],edges=new Map(),triangles=[];
  function vertex(p){const k=key(p);if(lookup.has(k))return lookup.get(k);const id=vertices.length;lookup.set(k,id);vertices.push(p);neighbours.push(new Set());return id;}
  faces.forEach((f,i)=>{
    const ids=f.points.map(vertex);if(new Set(ids).size!==3)throw Error('The mesh has a collapsed triangle. Repair it in your slicer before drawing a boundary.');triangles.push(ids);
    for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],k=edge(a,b);neighbours[a].add(b);neighbours[b].add(a);if(!edges.has(k))edges.set(k,[]);edges.get(k).push(i);}
  });
  for(const faces of edges.values())if(faces.length!==2)throw Error('This part has open or overlapping edges. Repair it in your slicer before drawing a boundary.');
  return {vertices,neighbours,edges,triangles,faces};
}
class Heap{
  constructor(){this.items=[];}
  push(id,cost){let i=this.items.length;const item={id,cost};this.items.push(item);while(i){const parent=(i-1)>>1;if(this.items[parent].cost<=cost)break;this.items[i]=this.items[parent];i=parent;}this.items[i]=item;}
  pop(){const top=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let child=i*2+1;if(child+1<this.items.length&&this.items[child+1].cost<this.items[child].cost)child++;if(this.items[child].cost>=last.cost)break;this.items[i]=this.items[child];i=child;}this.items[i]=last;}return top;}
}
function shortest(graph,start,end){
  const {vertices,neighbours}=graph,dist=new Float64Array(vertices.length).fill(Infinity),previous=new Int32Array(vertices.length).fill(-1),visited=new Uint8Array(vertices.length),heap=new Heap();
  dist[start]=0;heap.push(start,distance(vertices[start],vertices[end]));
  while(heap.items.length){const {id}=heap.pop();if(visited[id])continue;visited[id]=1;if(id===end)break;
    for(const next of neighbours[id]){const cost=dist[id]+distance(vertices[id],vertices[next]);if(cost<dist[next]-1e-10){dist[next]=cost;previous[next]=id;heap.push(next,cost+distance(vertices[next],vertices[end]));}}
  }
  if(!visited[end])throw Error('These points are on disconnected shells. Keep the boundary on one connected surface.');
  const path=[end];while(path.at(-1)!==start)path.push(previous[path.at(-1)]);return path.reverse();
}
function area(face){const [a,b,c]=face.points,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);}
export function traceBoundary(graph,points,{closed=false,flip=false}={}){
  if(!Array.isArray(points)||points.length>64||points.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error('Use up to 64 valid surface points.');
  if(closed&&points.length<3)throw Error('Add at least three points around the part before closing the boundary.');
  const anchors=points.map(p=>{let best=Infinity,id=-1;graph.vertices.forEach((v,i)=>{const d=distance(p,v);if(d<best){best=d;id=i;}});return id;});
  if(new Set(anchors).size!==anchors.length)throw Error('Two points snap to the same vertex. Move them further apart.');
  const path=anchors.length?[anchors[0]]:[];
  for(let i=1;i<anchors.length+(closed?1:0);i++)path.push(...shortest(graph,anchors[i-1],anchors[i%anchors.length]).slice(1));
  const loop=closed?path.slice(0,-1):path;
  if(new Set(loop).size!==loop.length)throw Error('The boundary crosses or doubles back. Move or remove a point and try again.');
  const result={anchors:anchors.map(i=>graph.vertices[i]),path:path.map(i=>graph.vertices[i]),indices:[],closed,perimeter:path.slice(1).reduce((n,id,i)=>n+distance(graph.vertices[path[i]],graph.vertices[id]),0)};
  if(!closed)return result;
  const barrier=new Set(path.slice(1).map((id,i)=>edge(path[i],id))),visited=new Uint8Array(graph.faces.length);
  function flood(start){const out=[start];visited[start]=1;for(let i=0;i<out.length;i++){const ids=graph.triangles[out[i]];for(let j=0;j<3;j++){const k=edge(ids[j],ids[(j+1)%3]);if(barrier.has(k))continue;for(const f of graph.edges.get(k))if(!visited[f]){visited[f]=1;out.push(f);}}}return out;}
  const sides=graph.edges.get(edge(path[0],path[1])),a=flood(sides[0]);
  if(visited[sides[1]])throw Error('This loop does not isolate a part; the surface is still joined elsewhere. Choose another boundary or use a plane cut.');
  const b=flood(sides[1]),areaA=a.reduce((n,i)=>n+area(graph.faces[i]),0),areaB=b.reduce((n,i)=>n+area(graph.faces[i]),0);
  result.indices=((areaA<=areaB)!==Boolean(flip)?a:b).sort((a,b)=>a-b);return result;
}
