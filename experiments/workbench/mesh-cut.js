import earcut from './vendor/earcut.js';

const EPS=1e-6;
const key=p=>p.map(v=>Math.round(v/EPS)).join(',');
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const area=t=>Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])));
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
export function cutMesh(faces,axis,height,capAttributes='') {
  if(![0,1,2].includes(axis)||!Number.isFinite(height))throw Error('Choose a valid cut axis and position.');
  const halves=[[],[]],segments=[];
  let crossed=0;
  for(const face of faces){
    const d=face.points.map(p=>p[axis]-height);
    if(d.every(v=>v>=-EPS)){halves[1].push(face);continue;}
    if(d.every(v=>v<=EPS)){halves[0].push(face);continue;}
    crossed++;
    const ends=[];
    for(let side=0;side<2;side++){
      const sign=side?1:-1,polygon=[];
      for(let i=0;i<3;i++){
        const j=(i+1)%3,a=face.points[i],b=face.points[j];
        if(d[i]*sign>=-EPS)polygon.push(a);
        if((d[i]>EPS&&d[j]<-EPS)||(d[i]<-EPS&&d[j]>EPS)){
          const t=d[i]/(d[i]-d[j]),p=a.map((v,k)=>v+(b[k]-v)*t);p[axis]=height;polygon.push(p);if(side===0)ends.push(p);
        }else if(Math.abs(d[i])<=EPS&&side===0)ends.push(a);
      }
      for(let i=1;i<polygon.length-1;i++){const points=[polygon[0],polygon[i],polygon[i+1]];if(area(points)>EPS*EPS)halves[side].push({...face,points});}
    }
    const unique=[...new Map(ends.map(p=>[key(p),p])).values()];
    if(unique.length===2)segments.push(unique);
  }
  if(!crossed||halves.some(x=>!x.length))throw Error('The cut does not pass through this object. Move it inside the model.');
  // Every intersection must form a closed contour before any result is offered.
  const nodes=new Map();
  for(const [a,b]of segments){for(const [p,q]of [[a,b],[b,a]]){const k=key(p);if(!nodes.has(k))nodes.set(k,{point:p,links:new Set()});nodes.get(k).links.add(key(q));}}
  if([...nodes.values()].some(n=>n.links.size!==2))throw Error('This cut crosses an open or touching mesh boundary. Move the cut slightly, or repair the model in your slicer.');
  const visited=new Set(),loops=[];
  for(const start of nodes.keys()){
    if(visited.has(start))continue;
    const loop=[];let at=start,previous=null;
    do{if(visited.has(at))throw Error('The cut contour intersects itself. Choose a different position.');visited.add(at);const n=nodes.get(at);loop.push(n.point);const next=[...n.links].find(k=>k!==previous);previous=at;at=next;}while(at!==start);
    if(loop.length>=3)loops.push(loop);
  }
  const uv=[0,1,2].filter(a=>a!==axis),project=p=>[p[uv[0]],p[uv[1]]];
  const inside=(p,loop)=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=project(loop[i]),b=project(loop[j]);if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
  const depth=loops.map((loop,i)=>loops.filter((other,j)=>i!==j&&inside(project(loop[0]),other)).length);
  const openHalves=halves.map(f=>f.slice());let caps=0;
  for(let i=0;i<loops.length;i++){
    if(depth[i]%2)continue;
    const rings=[loops[i],...loops.filter((l,j)=>depth[j]===depth[i]+1&&inside(project(l[0]),loops[i]))];
    const points=rings.flat(),holes=[];let cursor=rings[0].length;for(let r=1;r<rings.length;r++){holes.push(cursor);cursor+=rings[r].length;}
    const triangles=earcut(points.flatMap(project),holes,2);
    if(!triangles.length)throw Error('The cut surface could not be closed. Try a different position.');
    for(let t=0;t<triangles.length;t+=3){let tri=triangles.slice(t,t+3).map(k=>points[k]);if(cross(sub(tri[1],tri[0]),sub(tri[2],tri[0]))[axis]<0)tri=[tri[0],tri[2],tri[1]];
      halves[0].push({points:tri,attrs:capAttributes});halves[1].push({points:[tri[0],tri[2],tri[1]],attrs:capAttributes});caps++;
    }
  }
  return {halves,caps,openHalves,loops};
}

/** Separate disconnected mesh shells; a shared vertex keeps touching pieces together. */
export function connectedParts(faces){
  const parent=Int32Array.from(faces,(_,i)=>i),owner=new Map();
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let f=0;f<faces.length;f++)for(const p of faces[f].points){const k=key(p);if(owner.has(k))parent[root(f)]=root(owner.get(k));else owner.set(k,f);}
  const groups=new Map();for(let f=0;f<faces.length;f++){const r=root(f);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(faces[f]);}
  return [...groups.values()].sort((a,b)=>b.length-a.length);
}

export function signedVolume(faces){return faces.reduce((v,f)=>v+dot(f.points[0],cross(f.points[1],f.points[2]))/6,0);}
