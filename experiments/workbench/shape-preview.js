// Map a simplified view to the original surface regions. This mapping is only
// for highlighting/picking; edits always use the original face index sets.
export function mapShapePreview(parts,groups,positions){
  const min=[Infinity,Infinity,Infinity],viewMin=min.slice(),points=[];
  const labels=parts.map(p=>new Int32Array(p.faces.length).fill(-1));
  groups.forEach((g,label)=>g.faces.forEach(i=>labels[g.part][i]=label));
  parts.forEach((part,pi)=>part.faces.forEach((f,i)=>{
    for(const p of f.points)for(let a=0;a<3;a++)min[a]=Math.min(min[a],p[a]);
    points.push({p:[0,1,2].map(a=>f.points.reduce((s,v)=>s+v[a],0)/3),label:labels[pi][i]});
  }));
  for(let i=0;i<positions.length;i++)viewMin[i%3]=Math.min(viewMin[i%3],positions[i]);
  // Spatial bins keep both construction and queries bounded on detailed meshes.
  const max=min.slice();for(const q of points)for(let a=0;a<3;a++)max[a]=Math.max(max[a],q.p[a]);
  const cell=Math.max(.01,Math.hypot(...max.map((v,a)=>v-min[a]))/80),bins=new Map();
  const grid=p=>p.map((v,a)=>Math.floor((v-min[a])/cell));
  for(const point of points){const k=grid(point.p).join(',');if(!bins.has(k))bins.set(k,[]);bins.get(k).push(point);}
  const out=new Int32Array(positions.length/9).fill(-1);
  for(let f=0;f<out.length;f++){
    const p=[0,1,2].map(a=>(positions[f*9+a]+positions[f*9+3+a]+positions[f*9+6+a])/3-viewMin[a]+min[a]),g=grid(p);
    let nearest=Infinity,label=-1;
    for(let r=0;r<=4;r++){
      for(let x=-r;x<=r;x++)for(let y=-r;y<=r;y++)for(let z=-r;z<=r;z++){
        if(r&&Math.max(Math.abs(x),Math.abs(y),Math.abs(z))!==r)continue;
        for(const q of bins.get([g[0]+x,g[1]+y,g[2]+z].join(','))||[]){const d=q.p.reduce((s,v,a)=>s+(v-p[a])**2,0);if(d<nearest){nearest=d;label=q.label;}}
      }
      // Nearest points beyond the searched box cannot beat this result.
      if(nearest<(r*cell)**2)break;
    }
    out[f]=label;
  }
  return out;
}
