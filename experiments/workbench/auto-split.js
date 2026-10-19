import {connectedParts,signedVolume} from './mesh-cut.js';
import {separateColour,colourBoundary} from './mesh-joint.js';
import {decode,encode} from '../../web/shared/paint.js';

const paint=c=>` paint_color="${encode({kind:'leaf',state:c})}"`;
const area=f=>{const a=f.points[1].map((v,i)=>v-f.points[0][i]),b=f.points[2].map((v,i)=>v-f.points[0][i]);return Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);};
const bounds=faces=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const f of faces)for(const p of f.points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max};};
const disjoint=(a,b)=>a.min.some((v,i)=>v>b.max[i]+1e-6||b.min[i]>a.max[i]+1e-6);
function closed(faces){
  const edges=new Map(),key=p=>p.map(n=>Math.round(n/1e-6)).join(',');
  for(const f of faces)for(let i=0;i<3;i++){const a=key(f.points[i]),b=key(f.points[(i+1)%3]),k=[a,b].sort().join('|'),e=edges.get(k)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(k,e);}
  return [...edges.values()].every(([count,direction])=>count===2&&direction===0)&&signedVolume(faces)>.01;
}
function resolvedCaps(faces,base){return faces.map(f=>{if(f.colour!==undefined)return f;const code=/(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9a-f]*)"/i.exec(f.attrs)?.[1];return {...f,colour:code?decode(code).state||base:base};});}

/** Conservative auto mode: keep the largest painted area as the body, and
 * test every other connected colour region independently. No guessed cuts. */
export function autoSeparate(parts,{connector=null,progress=()=>{}}={}){
  const report={separated:[],retained:[]},sources=[];
  for(const part of parts){
    const shells=connectedParts(part.faces),boxes=shells.map(bounds);
    // Inner cavity shells and overlapping volumes must remain together.
    const safe=shells.length>1&&shells.length<=64&&shells.every(closed)&&boxes.every((b,i)=>boxes.slice(i+1).every(c=>disjoint(b,c)));
    sources.push(...(safe?shells.map(faces=>({...part,faces})): [part]));
  }
  const boxes=sources.map(p=>bounds(p.faces));
  const separateShells=sources.length>1&&sources.every(p=>closed(p.faces))&&boxes.every((b,i)=>boxes.slice(i+1).every(c=>disjoint(b,c)));
  const anchors=[],detached=[];
  for(const [partIndex,part] of sources.entries()){
    let remaining=part.faces;
    const sizes=new Map();for(const f of remaining)sizes.set(f.colour,(sizes.get(f.colour)||0)+area(f));
    const [body]=[...sizes].sort((a,b)=>b[1]-a[1])[0]||[];
    const candidates=[...sizes.keys()].filter(c=>c!==body).sort((a,b)=>a-b);
    for(const colour of candidates){
      // Keep stable references to each original region as the body changes.
      const regions=connectedParts(remaining.filter(f=>f.colour===colour));
      const candidates=regions.length>32?regions.map(region=>({region,area:region.reduce((sum,f)=>sum+area(f),0)})).sort((a,b)=>b.area-a.area).slice(0,32).map(r=>r.region):regions;
      if(regions.length>32)report.retained.push({colour,count:regions.length-32,reason:'Automatic separation checks up to 32 large regions per colour; these smaller patches stayed attached.'});
      let current=regions;
      for(const [checked,region]of candidates.entries()){
        const index=regions.indexOf(region);
        if(detached.length>=60){report.retained.push({colour,count:1,reason:'Automatic separation is limited to 60 detached pieces per object.'});continue;}
        progress(`Checking colour ${colour}, region ${checked+1} of ${candidates.length}…`);
        current??=connectedParts(remaining.filter(f=>f.colour===colour));
        const at=current.findIndex(group=>group.includes(region[0]));
        if(at<0)continue;
        try{
          // Reject malformed small patches before scanning the full model again.
          colourBoundary(current[at]);
          const alreadySeparate=closed(region);
          const result=separateColour(remaining,colour,{region:at,connector:alreadySeparate?null:connector,capAttributes:paint});
          if(!result.remaining.length)continue;
          const piece=result.parts[0],joint=result.joints[0];
          detached.push([{...part,base:colour,faces:piece,pinDirections:joint?[joint.normal.map(v=>-v)]:[]}]);
          remaining=resolvedCaps(result.remaining,part.base);
          current=null;
          report.separated.push({colour,part:partIndex,region:index,pin:Boolean(joint)});
        }catch(error){report.retained.push({colour,count:1,reason:error.message.includes('already a disconnected part')?'This small or reversed shell stays with the body to preserve its shape.':error.message});}
      }
    }
    anchors.push({...part,faces:remaining});
  }
  const groups=[...(separateShells?anchors.map(p=>[p]):[anchors]),...detached];
  const names=[...(separateShells?anchors.map((_,i)=>`part ${i+1}`):['body']),...report.separated.map((p,i)=>`colour ${p.colour} · part ${i+1}`)];
  report.disconnected=separateShells?anchors.length:0;
  report.parts=groups.length;
  return {groups,names,report};
}
