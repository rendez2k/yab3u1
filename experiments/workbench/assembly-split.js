import {connectedParts,signedVolume} from './mesh-cut.js';
import {separateShape} from './mesh-joint.js';
import {detectShapeParts} from './shape-parts.js';
import {encode} from '../../web/shared/paint.js';
import {neckCandidates} from './neck-candidates.js';
import {cutPaintedPart} from './painted-cut.js';

const paint=base=>` paint_color="${encode({kind:'leaf',state:base})}"`;
const area=f=>{const [a,b,c]=f.points,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};
const box=faces=>{const min=[Infinity,Infinity,Infinity],max=min.map(()=>-Infinity);for(const f of faces)for(const p of f.points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max};};
const disjoint=(a,b)=>a.min.some((v,i)=>v>b.max[i]+1e-6||b.min[i]>a.max[i]+1e-6);

/** Original triangles only: painting subdivision can have legitimate T junctions. */
export function assemblyMeshHealth(faces){
  const edges=new Map(),key=p=>p.map(v=>Math.round(v*1e6)).join(',');let degenerate=0;
  for(const f of faces){if(!Number.isFinite(area(f))||area(f)<1e-12)degenerate++;for(let i=0;i<3;i++){
    const a=key(f.points[i]),b=key(f.points[(i+1)%3]),k=a<b?`${a}|${b}`:`${b}|${a}`,e=edges.get(k)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(k,e);
  }}
  let open=0,nonManifold=0,reversed=0;
  for(const [count,direction]of edges.values()){if(count===1)open++;else if(count!==2)nonManifold++;else if(direction)reversed++;}
  return {ok:!degenerate&&!open&&!nonManifold&&!reversed,degenerate,open,nonManifold,reversed};
}

/** Find substantial geometry regions, independent of their paint. Unsafe joins
 * and small decorative islands stay with the body; no speculative mesh repair. */
export function autoAssembly(parts,{connector=null,progress=()=>{}}={}){
  const report={strategy:'assembly',separated:[],retained:[],disconnected:0,parts:1},anchors=[],detached=[],dowels=[],joints=[];
  const totalArea=parts.reduce((sum,p)=>sum+p.faces.reduce((n,f)=>n+area(f),0),0),minimumArea=Math.max(4,totalArea*.025);
  const sources=[];
  for(const part of parts){
    if(part.faces.length>750000){anchors.push(part);report.retained.push({count:1,reason:'Automatic assembly splitting supports up to 750,000 original triangles per part. Simplify a copy in your slicer first.'});continue;}
    progress('Checking the original mesh before finding larger parts…');
    const health=assemblyMeshHealth(part.faces);
    if(!health.ok){
      const faults=[health.open&&`${health.open} open edges`,health.nonManifold&&`${health.nonManifold} non-manifold edges`,health.reversed&&`${health.reversed} inconsistently oriented edges`,health.degenerate&&`${health.degenerate} degenerate faces`].filter(Boolean).join(', ');
      report.needsRepair=true;anchors.push(part);report.retained.push({count:1,reason:`This mesh needs repair (${faults}). Choose Repair mesh to try a local repair before splitting.`});continue;
    }
    const shells=connectedParts(part.faces),boxes=shells.map(box);
    const independent=shells.length>1&&shells.length<=64&&shells.every(s=>signedVolume(s)>.01)&&boxes.every((b,i)=>boxes.slice(i+1).every(c=>disjoint(b,c)));
    sources.push(...(independent?shells.map(faces=>({...part,faces})): [part]));
  }
  // An invalid source component may overlap another one. Do not detach those
  // neighbours and accidentally alter how the slicer combines the volumes.
  if(anchors.length)return {groups:[parts],names:['body'],report,joints};
  const boxes=sources.map(p=>box(p.faces)),independent=sources.length>1&&boxes.every((b,i)=>boxes.slice(i+1).every(c=>disjoint(b,c)));
  const largest=sources.reduce((best,p,i)=>p.faces.reduce((sum,f)=>sum+area(f),0)>(sources[best]?.faces.reduce((sum,f)=>sum+area(f),0)||0)?i:best,0);
  for(const [partIndex,part]of sources.entries()){
    let remaining=part.faces,anchorPart=part;const reportStart=report.retained.length;
    const partArea=remaining.reduce((sum,f)=>sum+area(f),0);
    if(independent&&partIndex!==largest&&partArea>=minimumArea){detached.push([part]);report.disconnected++;continue;}
    let regions;
    try{regions=detectShapeParts(remaining,{detail:'coarse'}).map(indices=>({faces:indices.map(i=>remaining[i]),size:indices.reduce((sum,i)=>sum+area(remaining[i]),0)})).sort((a,b)=>b.size-a.size);}
    catch(e){anchors.push(part);report.retained.push({count:1,reason:e.message});continue;}
    const eligible=regions.slice(1).filter(r=>r.size>=minimumArea),candidates=eligible.slice(0,12);
    if(eligible.length>12)report.retained.push({count:eligible.length-12,reason:'Automatic assembly splitting checks up to 12 large joins per component. Review further regions with By shape.'});
    const small=regions.slice(1).filter(r=>r.size<minimumArea).length;
    if(small)report.retained.push({count:small,informational:true,reason:'Small details stay on the body so the result remains a set of larger assembly parts.'});
    if(!candidates.length&&!small)report.retained.push({count:1,reason:'No distinct larger join was found. Use By shape to combine regions, Draw boundary, or Plane cut to choose the separation.'});
    const minimumVolume=Math.max(1,Math.abs(signedVolume(remaining))*.01),detachedBefore=detached.length;
    for(const [index,candidate]of candidates.entries()){
      progress(`Checking larger part ${index+1} of ${candidates.length}…`);
      const wanted=new Set(candidate.faces),indices=[];remaining.forEach((f,i)=>{if(wanted.has(f))indices.push(i);});if(!indices.length)continue;
      try{
        const result=separateShape(remaining,indices,{connector,capAttributes:paint(part.base),selectedCapAttributes:paint(part.base)});
        if(!result.remaining.length||result.parts.some(p=>signedVolume(p)<minimumVolume))throw Error('This candidate would make a small or thin piece. It stays attached to the larger body.');
        for(const [i,faces]of result.parts.entries()){
          const joint=result.joints?.[i];detached.push([{...part,faces,pinDirections:joint?.kind==='pin'?[joint.normal.map(v=>-v)]:[]}]);
          report.separated.push({part:partIndex,region:index,connector:joint?.kind||null,pin:joint?.kind==='pin'});
        }
        joints.push(...(result.joints||[]).filter(Boolean));
        dowels.push(...(result.loose||[]).map(({faces,joint})=>[{name:'Separate dowel',base:part.base,faces,settings:{},subtype:'normal_part',dowel:true,pinDirections:[joint.normal]}]));
        remaining=result.remaining;
      }catch(e){report.retained.push({count:1,reason:e.message.replace(/^This colour /,'This shape region ')});}
    }
    // Curved surface regions can wrap around a whole head or body. When none
    // closes, try one conservative plane through a genuine narrow section.
    if(detached.length===detachedBefore){
      const neck=splitAtNeck(part,{connector,progress});
      if(neck.result){
        report.retained.splice(reportStart);
        anchorPart=neck.result.parts[0];remaining=anchorPart.faces;detached.push([neck.result.parts[1]]);
        if(neck.result.joint)joints.push(neck.result.joint);
        dowels.push(...neck.result.loose.map(({faces,joint})=>[{name:'Separate dowel',base:part.base,faces,settings:{},subtype:'normal_part',dowel:true,pinDirections:[joint.normal]}]));
        report.separated.push({part:partIndex,method:'neck-plane',axis:neck.axis,height:neck.height,connector:neck.result.joint?.kind||null,pin:neck.result.joint?.kind==='pin'});
      }else if(neck.reason)report.retained.unshift({count:1,reason:neck.reason});
    }
    anchors.push({...anchorPart,faces:remaining});
  }
  const groups=[...(anchors.length?[anchors]:[]),...detached,...dowels];
  const names=[...(anchors.length?['body']:[]),...detached.map((_,i)=>`assembly part ${i+1}`),...dowels.map((_,i)=>`dowel ${i+1}`)];
  report.parts=groups.length;return {groups,names,report,joints};
}

export function splitAtNeck(part,{connector=null,progress=()=>{}}={}){
  progress('Looking for a narrow section for a larger-part cut…');
  const candidates=neckCandidates(part.faces),volume=signedVolume(part.faces);let reason='';
  for(const [index,candidate]of candidates.entries())for(const offset of [0,1,-1,2,-2,3,-3]){
    const {axis,step}=candidate,height=candidate.height+offset*step;
    progress(`Checking narrow section ${index+1} of ${candidates.length}…`);
    try{
      const plain=cutPaintedPart(part,axis,height,null,{singleJoin:true,conform:true});
      if(plain.parts.some(p=>!p||signedVolume(p.faces)<Math.max(1,volume*.1)))continue;
      if(Math.abs(plain.parts.reduce((n,p)=>n+signedVolume(p.faces),0)-volume)>Math.max(.001,volume*1e-6))continue;
      if(plain.parts.some(p=>!assemblyMeshHealth(p.faces).ok))continue;
      const result=connector?cutPaintedPart(part,axis,height,connector,{singleJoin:true,conform:true}):plain;
      if(result.parts.some(p=>!assemblyMeshHealth(p.faces).ok)||result.loose.some(p=>!assemblyMeshHealth(p.faces).ok))continue;
      return {result,axis,height};
    }catch(e){reason=e.message;}
  }
  return {reason:candidates.length?(reason||'The narrow-section cuts could not preserve closed painted parts. Use Plane cut to choose a different join.'):''};
}
