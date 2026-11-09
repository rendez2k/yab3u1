import {assemblyMeshHealth} from './assembly-split.js';
import {signedVolume} from './mesh-cut.js';

const key=p=>p.map(v=>Math.round(v*1e6)).join(',');
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normal=f=>cross(sub(f.points[1],f.points[0]),sub(f.points[2],f.points[0]));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const canonical=keys=>{const i=keys.indexOf([...keys].sort()[0]);return [...keys.slice(i),...keys.slice(0,i)];};

/** Local, transactional repair. Retained faces keep their vertex order and
 * attributes (including subdivided paint). No remeshing, hole filling or
 * guessing which overlapping solid should win. */
export function repairMesh(source,{progress=()=>{}}={}){
  if(source.length>750000)throw Error('Mesh repair supports up to 750,000 original triangles per part.');
  const before=assemblyMeshHealth(source);
  const report={before,after:before,duplicateFaces:0,zeroThicknessFaces:0,degenerateFaces:0,separatedVertices:0,maxMovement:0};
  progress('Removing duplicate and zero-thickness faces…');
  const groups=new Map(),removed=new Set();
  source.forEach((f,i)=>{
    const keys=f.points.map(key);
    if(new Set(keys).size<3||Math.hypot(...normal(f))<2e-12){removed.add(i);report.degenerateFaces++;return;}
    const signature=[...keys].sort().join('|');
    if(!groups.has(signature))groups.set(signature,[]);
    groups.get(signature).push({i,keys:canonical(keys)});
  });
  for(const copies of groups.values())if(copies.length>1){
    if(copies.length!==2)throw Error('Several faces overlap in one place. This repair cannot choose which surface to keep. Your model is unchanged.');
    const [a,b]=copies,opposed=a.keys[1]===b.keys[2];
    if(opposed){removed.add(a.i);removed.add(b.i);report.zeroThicknessFaces+=2;}
    else{
      const fa=source[a.i],fb=source[b.i];
      if(fa.attrs!==fb.attrs||fa.points.some((p,j)=>key(p)!==key(fb.points[j])))throw Error('Overlapping faces have different painting or vertex order. This repair cannot safely choose between them. Your model is unchanged.');
      removed.add(b.i);report.duplicateFaces++;
    }
  }
  if(before.ok&&!removed.size)return {faces:source,changed:false,report};
  let faces=source.filter((_,i)=>!removed.has(i));
  if(!faces.length)throw Error('This mesh has no solid surface left after removing zero-thickness faces. Your model is unchanged.');
  // Duplicate triangles make the input volume unreliable. Compare movement
  // against the cleaned surface, before any vertex positions are adjusted.
  const cleanVolume=signedVolume(faces);
  // A corner graph connects only the two faces on a normal edge. Distinct fans
  // at a pinched vertex can then be separated without changing triangle order.
  progress('Separating pinched edges while retaining the painting…');
  const points=[],vertices=new Map(),indices=new Int32Array(faces.length*3),edges=new Map();
  const pointId=p=>{const k=key(p);if(!vertices.has(k)){vertices.set(k,points.length);points.push(p);}return vertices.get(k);};
  faces.forEach((f,i)=>{f.points.forEach((p,j)=>{indices[i*3+j]=pointId(p);});for(let j=0;j<3;j++){
    const a=indices[i*3+j],b=indices[i*3+(j+1)%3],k=a<b?`${a}:${b}`:`${b}:${a}`;
    if(!edges.has(k))edges.set(k,[]);edges.get(k).push(i*3+j);
  }});
  const parents=Int32Array.from({length:indices.length},(_,i)=>i);
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  const end=h=>Math.floor(h/3)*3+(h%3+1)%3;
  const badVertices=new Set(),badEdges=[];
  for(const half of edges.values()){
    if(half.length===1)throw Error('The mesh has open boundaries. This repair does not fill holes or invent missing painting. Your model is unchanged.');
    if(half.length===2){
      const [a,b]=half;if(indices[a]!==indices[end(b)])throw Error('Some faces point in inconsistent directions. This repair keeps painted triangle orientation unchanged.');
      parents[root(a)]=root(end(b));parents[root(end(a))]=root(b);
    }else{badEdges.push(half);for(const h of half){badVertices.add(indices[h]);badVertices.add(indices[end(h)]);}}
  }
  for(const half of badEdges){
    if(half.length!==4)throw Error('More than two surfaces share an edge. This repair cannot safely separate them. Your model is unchanged.');
    const forward=half.filter(h=>indices[h]<indices[end(h)]),back=half.filter(h=>indices[h]>indices[end(h)]);
    if(forward.length!==2||back.length!==2)throw Error('The shared edge has inconsistent face directions. Your model is unchanged.');
    const score=pairs=>{
      let shared=0,alignment=0;
      for(const [a,b]of pairs){
        const common=Number(root(a)===root(end(b)))+Number(root(end(a))===root(b));
        if(!common)return null;shared+=common;
        const n=normal(faces[Math.floor(a/3)]),m=normal(faces[Math.floor(b/3)]);alignment+=dot(n,m)/(Math.hypot(...n)*Math.hypot(...m));
      }
      return {pairs,shared,alignment};
    };
    const choices=[score([[forward[0],back[0]],[forward[1],back[1]]]),score([[forward[0],back[1]],[forward[1],back[0]]])].filter(Boolean).sort((a,b)=>b.shared-a.shared||b.alignment-a.alignment);
    if(!choices.length||(choices.length>1&&choices[0].shared===choices[1].shared&&Math.abs(choices[0].alignment-choices[1].alignment)<1e-7))throw Error('A shared edge has no unambiguous local surface pairing. Your model is unchanged.');
    for(const [a,b]of choices[0].pairs){parents[root(a)]=root(end(b));parents[root(end(a))]=root(b);}
  }
  for(const half of badEdges){
    const pairs=new Map();
    for(const h of half){const a=root(h),b=root(end(h)),k=a<b?`${a}:${b}`:`${b}:${a}`;if(!pairs.has(k))pairs.set(k,[]);pairs.get(k).push(h);}
    if([...pairs.values()].some(p=>p.length!==2||indices[p[0]]!==indices[end(p[1])]))throw Error('A shared edge cannot be separated into unambiguous surface pairs. Your model is unchanged.');
  }
  const fans=new Map(),vertexFans=new Map();
  for(let c=0;c<indices.length;c++)if(badVertices.has(indices[c])){
    const r=root(c),v=indices[c];if(!fans.has(r))fans.set(r,[]);fans.get(r).push(c);
    if(!vertexFans.has(v))vertexFans.set(v,new Set());vertexFans.get(v).add(r);
  }
  const replacements=new Map();
  for(const [r,corners]of fans){
    if(vertexFans.get(indices[r]).size<2)continue;
    const p=points[indices[r]],neighbours=new Set();
    for(const c of corners){const base=Math.floor(c/3)*3;for(let j=0;j<3;j++)if(indices[base+j]!==indices[c])neighbours.add(indices[base+j]);}
    const direction=[0,0,0];let shortest=Infinity;
    for(const id of neighbours){const d=sub(points[id],p);for(let j=0;j<3;j++)direction[j]+=d[j]/neighbours.size;shortest=Math.min(shortest,Math.hypot(...d));}
    const length=Math.hypot(...direction),distance=Math.min(.001,shortest*.01);
    if(length<1e-10||distance<.00001)throw Error('This pinched detail is too small to move safely. Your model is unchanged.');
    replacements.set(r,p.map((v,j)=>v+direction[j]/length*distance));
    report.maxMovement=Math.max(report.maxMovement,distance);report.separatedVertices++;
  }
  if(replacements.size)faces=faces.map((f,i)=>{
    const moved=f.points.map((p,j)=>replacements.get(root(i*3+j))||p);
    if(moved.every((p,j)=>p===f.points[j]))return f;
    const next={...f,points:moved};
    if(dot(normal(f),normal(next))<=0)throw Error('Repair would fold a painted triangle. Your model is unchanged.');
    return next;
  });
  progress('Checking repaired edges and model volume…');
  report.after=assemblyMeshHealth(faces);
  if(!report.after.ok)throw Error('Local repair could not close every edge. Your model is unchanged.');
  const newVolume=signedVolume(faces);
  if(Math.abs(newVolume-cleanVolume)>Math.max(1e-7,Math.abs(cleanVolume)*.0001))throw Error('Repair would change too much of the model volume. Your model is unchanged.');
  return {faces,changed:removed.size>0||replacements.size>0,report};
}
