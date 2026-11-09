const EPS=1e-6,key=p=>p.map(v=>Math.round(v/EPS)).join(',');
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const area=([a,b,c])=>{const u=sub(b,a),v=sub(c,a);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};

/** Match collinear edge subdivisions introduced by resolving painted triangles.
 * No hole filling or surface movement: only split an existing triangle where
 * an existing boundary vertex lies on its edge. All fan faces stay in its plane. */
export function conformCut(source,expand){
  let faces=source.filter(f=>area(f.points)>=1e-12&&new Set(f.points.map(key)).size===3);
  for(let pass=0;pass<12;pass++){
    const open=new Map();
    for(const [index,f]of faces.entries())for(let edge=0;edge<3;edge++){
      const a=f.points[edge],b=f.points[(edge+1)%3],ka=key(a),kb=key(b),k=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;
      const other=open.get(k);if(other){if(other.ka===ka)throw Error('The cut has inconsistent surface directions. Choose a different cut.');open.delete(k);}else open.set(k,{a,b,ka,kb,index,edge});
    }
    if(!open.size)return faces;
    if(open.size>20000)throw Error('The painted cut needs too many edge subdivisions. Choose another position.');
    const nodes=new Map();for(const e of open.values()){nodes.set(e.ka,e.a);nodes.set(e.kb,e.b);}
    const sorted=[0,1,2].map(axis=>[...nodes.values()].sort((a,b)=>a[axis]-b[axis]));
    const lower=(points,axis,value)=>{let lo=0,hi=points.length;while(lo<hi){const m=(lo+hi)>>>1;if(points[m][axis]<value)lo=m+1;else hi=m;}return lo;};
    const edits=new Map();
    for(const e of open.values()){
      const d=sub(e.b,e.a),length2=dot(d,d),axis=d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs))),points=sorted[axis],added=[];
      const low=Math.min(e.a[axis],e.b[axis]),high=Math.max(e.a[axis],e.b[axis]);
      for(let i=lower(points,axis,low+EPS);i<points.length&&points[i][axis]<high-EPS;i++){
        const p=points[i],t=dot(sub(p,e.a),d)/length2;
        if(t<=0||t>=1||Math.hypot(...p.map((v,j)=>v-e.a[j]-d[j]*t))>EPS)continue;
        added.push({p,t});
      }
      if(added.length){if(!edits.has(e.index))edits.set(e.index,new Map());edits.get(e.index).set(e.edge,added.sort((a,b)=>a.t-b.t).map(r=>r.p));}
    }
    if(!edits.size)throw Error('The painted cut has an unmatched boundary. Choose a different position.');
    const next=[];
    for(const [index,f]of faces.entries()){
      const edges=edits.get(index);if(!edges){next.push(f);continue;}
      const flat=expand(f);if(flat.length>1){next.push(...flat);continue;}
      const ring=f.points.flatMap((p,i)=>[p,...(edges.get(i)||[])]),centre=[0,1,2].map(a=>f.points.reduce((n,p)=>n+p[a],0)/3);
      for(let i=0;i<ring.length;i++){const points=[centre,ring[i],ring[(i+1)%ring.length]];if(area(points)>=1e-12&&new Set(points.map(key)).size===3)next.push({...flat[0],points});}
    }
    if(next.length>source.length*2+20000)throw Error('The painted cut needs too many additional triangles. Choose another position.');
    faces=next;
  }
  throw Error('The painted cut could not match every subdivided edge. Choose another position.');
}
