import {decode} from '../../web/shared/paint.js';
import {leafTriangles} from '../../web/shared/standard.js';

// Exact source/cap triangles for inspection. A bounded payload keeps a cancelled
// check from flooding the UI with an unbounded paint tree.
export function inspectionSoup(groups,colours,names=[],withSources=false){
  const positions=[],colors=[],ranges=[],faceSources=[];
  groups.forEach((group,index)=>{
    const start=positions.length/3,lo=[Infinity,Infinity,Infinity],hi=lo.map(()=>-Infinity);
    for(const part of group)for(const [faceIndex,face] of part.faces.entries()){
      const code=/(?:paint_color|mmu_segmentation)="([0-9a-f]*)"/i.exec(face.attrs||'')?.[1],node=code?decode(code):{kind:'leaf',state:part.base};
      for(const leaf of leafTriangles(face.points,node)){
        if(positions.length>=18000000)throw Error('This painted model is too detailed for split inspection. Try a smaller selection.');
        const hex=colours[(leaf.state||part.base)-1]||'#888888',rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
        for(const p of leaf.triangle){positions.push(...p);colors.push(...rgb);for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],p[a]);hi[a]=Math.max(hi[a],p[a]);}}
        if(withSources)faceSources.push(faceIndex);
      }
    }
    if(positions.length/3>start)ranges.push({start,count:positions.length/3-start,name:names[index]||`Part ${index+1}`,centre:lo.map((n,a)=>(n+hi[a])/2),bounds:{lo,hi},part:index,dowel:group.every(p=>p.dowel)});
  });
  const solids=ranges.filter(r=>!r.dowel),centre=solids.reduce((sum,r)=>sum.map((n,a)=>n+r.centre[a]/solids.length),[0,0,0]);
  ranges.forEach((r,i)=>{if(r.dowel){r.direction=[0,0,0];return;}let v=r.centre.map((n,a)=>n-centre[a]),length=Math.hypot(...v);if(length<.01){v=[Math.cos(i*2.399),Math.sin(i*2.399),i%2?.4:-.4];length=Math.hypot(...v);}r.direction=v.map(n=>n/length);});
  return {positions:Float32Array.from(positions),colors:Float32Array.from(colors),ranges,...(withSources?{faceSources:Uint32Array.from(faceSources)}:{})};
}

export function explodedPositions(soup,gap){
  if(!Number.isFinite(gap)||gap<0||gap>100)throw Error('Choose a separation from 0 to 100 mm.');
  const positions=soup.positions.slice();for(const r of soup.ranges)for(let i=r.start*3;i<(r.start+r.count)*3;i++)positions[i]+=r.direction[i%3]*gap;return positions;
}

export function inspectionBounds(soup,gap=0){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const r of soup.ranges)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],r.bounds.lo[a]+r.direction[a]*gap);hi[a]=Math.max(hi[a],r.bounds.hi[a]+r.direction[a]*gap);}
  return {lo,hi,size:lo.map((n,a)=>hi[a]-n),centre:lo.map((n,a)=>(n+hi[a])/2)};
}
