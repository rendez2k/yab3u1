// Deterministic, geometry-only region proposals. Original faces are never remeshed.
// Concave edges resist merging; broad convex surfaces stay together. This is a
// geometric aid, not semantic recognition or a guarantee of a printable seam.
const key=p=>p.map(v=>Math.round(v*1e5)).join(',');
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function detectShapeParts(faces,{detail='balanced'}={}){
  if(!['coarse','balanced','fine'].includes(detail))throw Error('Choose a valid detection detail.');
  if(faces.length>750000)throw Error('Shape detection supports up to 750,000 triangles per part. Use painted regions or split a smaller object first.');
  if(!faces.length)return [];
  const min=[Infinity,Infinity,Infinity],max=min.map(()=>-Infinity),centres=[],normals=[],areas=[],edges=new Map();
  faces.forEach((f,i)=>{
    const n=cross(sub(f.points[1],f.points[0]),sub(f.points[2],f.points[0])),length=Math.hypot(...n);
    if(!Number.isFinite(length)||length<1e-12)throw Error('This mesh has degenerate faces. Repair it in your slicer before detecting parts.');
    normals.push(n.map(v=>v/length));areas.push(length/2);centres.push([0,1,2].map(a=>f.points.reduce((s,p)=>s+p[a],0)/3));
    for(let e=0;e<3;e++){
      const a=key(f.points[e]),b=key(f.points[(e+1)%3]),k=a<b?`${a}|${b}`:`${b}|${a}`;
      if(!edges.has(k))edges.set(k,[]);edges.get(k).push(i);
      for(let d=0;d<3;d++){min[d]=Math.min(min[d],f.points[e][d]);max[d]=Math.max(max[d],f.points[e][d]);}
    }
  });
  const scale=Math.hypot(...sub(max,min)),total=areas.reduce((a,b)=>a+b,0),parent=Int32Array.from(faces,(_,i)=>i),mass=areas.slice();
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{a=root(a);b=root(b);if(a===b)return;a>b&&([a,b]=[b,a]);parent[b]=a;mass[a]+=mass[b];};
  const links=[];
  for(const adjacent of edges.values())if(adjacent.length===2){
    const [a,b]=adjacent,delta=sub(centres[b],centres[a]),distance=Math.hypot(...delta);
    // Positive: neighbouring face lies outside this face's tangent plane.
    const concavity=Math.max(0,dot(normals[a],delta)-dot(normals[b],delta))/Math.max(distance*distance,1e-12)*scale;
    links.push({a,b,weight:concavity});
  }
  const threshold={coarse:14,balanced:6,fine:2}[detail];
  for(const e of links)if(e.weight<threshold)join(e.a,e.b);
  // Suppress tiny surface slivers, without joining disconnected shells.
  links.sort((a,b)=>a.weight-b.weight||a.a-b.a||a.b-b.b);
  const smallest=total*({coarse:.012,balanced:.006,fine:.003}[detail]);
  for(const e of links)if(mass[root(e.a)]<smallest||mass[root(e.b)]<smallest)join(e.a,e.b);
  const groups=new Map();for(let i=0;i<faces.length;i++){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}
  return [...groups.values()].sort((a,b)=>b.reduce((s,i)=>s+areas[i],0)-a.reduce((s,i)=>s+areas[i],0)||a[0]-b[0]);
}
