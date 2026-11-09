/** Axis-aligned bottlenecks are proposals only. The caller must still validate
 * closed solids, painting, material depth and the chosen connector. */
export function neckCandidates(faces){
  const min=[Infinity,Infinity,Infinity],max=min.map(()=>-Infinity);
  for(const f of faces)for(const p of f.points)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}
  const candidates=[],bins=100;
  for(let axis=0;axis<3;axis++){
    const span=max[axis]-min[axis];if(span<8)continue;
    const step=span/bins,rows=Array.from({length:bins},(_,i)=>({height:min[axis]+(i+.5)*step,area:0})),u=(axis+1)%3,v=(axis+2)%3;
    for(const {points:p}of faces){
      const lo=Math.min(...p.map(p=>p[axis])),hi=Math.max(...p.map(p=>p[axis]));
      for(let k=Math.max(0,Math.ceil((lo-min[axis])/step-.5));k<Math.min(bins,Math.ceil((hi-min[axis])/step-.5));k++){
        const row=rows[k];let start,end;
        for(let i=0;i<3;i++){
          const a=p[i],b=p[(i+1)%3],da=a[axis]-row.height,db=b[axis]-row.height;
          if((da<0)===(db<0))continue;
          const t=da/(da-db),q=[a[u]+t*(b[u]-a[u]),a[v]+t*(b[v]-a[v])];
          if(da>0)start=q;else end=q;
        }
        if(start&&end)row.area+=(start[0]*end[1]-start[1]*end[0])/2;
      }
    }
    for(const row of rows)row.area=Math.abs(row.area);
    const total=rows.reduce((sum,r)=>sum+r.area,0);let below=0;
    for(let i=0;i<bins;i++){
      const r=rows[i];below+=r.area;
      // Substantial material on both sides; at least 25% narrower than both
      // shoulders. This excludes tips, broad convex solids and shallow ripples.
      if(i<10||i>=90||r.area<1||r.area>=rows[i-1].area||r.area>rows[i+1].area)continue;
      const balance=Math.min(below,total-below)/total;if(balance<.12)continue;
      const left=Math.max(...rows.slice(Math.max(0,i-20),i).map(r=>r.area)),right=Math.max(...rows.slice(i+1,i+21).map(r=>r.area)),ratio=r.area/Math.min(left,right);
      if(ratio>.75)continue;
      candidates.push({axis,height:r.height,step,score:(1-ratio)*balance});
    }
  }
  return candidates.sort((a,b)=>b.score-a.score||a.axis-b.axis||a.height-b.height).slice(0,3);
}
