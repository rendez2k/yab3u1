// Local texture-to-filament preparation. Geometry stays indexed and intact;
// only the preview is simplified. One sampled colour becomes one face colour.
import {toLab} from './colour.js';
import {writeZip} from '../zip.js';
export const MAX_FACES=2500000;
export const pack=(r,g,b)=>(Math.round(r)<<16)|(Math.round(g)<<8)|Math.round(b);
export const channels=c=>[(c>>>16)&255,(c>>>8)&255,c&255];
export const hex=c=>'#'+c.toString(16).padStart(6,'0').toUpperCase();
export const bin=c=>((c>>>19)&31)*1024+((c>>>11)&31)*32+((c>>>3)&31);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiply(a,b){const out=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
export function transform(positions,m){
  if(m.length!==16 || !m.every(Number.isFinite))throw Error('Invalid model transform.');
  const out=new Float32Array(positions.length);
  for(let i=0;i<positions.length;i+=3){const x=positions[i],y=positions[i+1],z=positions[i+2];for(let a=0;a<3;a++)out[i+a]=m[a]*x+m[4+a]*y+m[8+a]*z+m[12+a];}
  return out;
}
export function bounds(meshes){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const m of meshes)for(let i=0;i<m.positions.length;i++){const x=m.positions[i];if(!Number.isFinite(x))throw Error('Non-finite vertex coordinate.');const a=i%3;min[a]=Math.min(min[a],x);max[a]=Math.max(max[a],x);}return {min,max,size:max.map((x,i)=>x-min[i])};}
export function validateModel(model){
  let faces=0;
  for(const m of model.meshes){
    faces+=m.indices.length/3;
    if(m.positions.length%3 || m.indices.length%3 || m.colours.length!==m.indices.length/3)throw Error('Incomplete mesh data.');
    for(const i of m.indices)if(!Number.isInteger(i)||i<0||i>=m.positions.length/3)throw Error('Face references a missing vertex.');
  }
  if(!faces || faces>MAX_FACES)throw Error(`Choose a model with 1–${MAX_FACES.toLocaleString()} triangles.`);
  model.bounds=bounds(model.meshes);model.faces=faces;
  if(!(Math.max(...model.bounds.size)>0))throw Error('The model has no measurable size.');
  return model;
}
function area(m,f){const a=m.indices[f*3]*3,b=m.indices[f*3+1]*3,c=m.indices[f*3+2]*3,p=m.positions;const x=p[b]-p[a],y=p[b+1]-p[a+1],z=p[b+2]-p[a+2],u=p[c]-p[a],v=p[c+1]-p[a+1],w=p[c+2]-p[a+2];return Math.hypot(y*w-z*v,z*u-x*w,x*v-y*u)/2;}
export function histogram(model){
  const bins=new Map();
  for(const m of model.meshes)for(let f=0;f<m.colours.length;f++){
    const weight=area(m,f);if(!weight)continue;const c=m.colours[f],key=bin(c),rgb=channels(c);
    let row=bins.get(key);if(!row){row={key,weight:0,sum:[0,0,0]};bins.set(key,row);}
    row.weight+=weight;for(let k=0;k<3;k++)row.sum[k]+=rgb[k]*weight;
  }
  return [...bins.values()].map(r=>({...r,rgb:r.sum.map(x=>x/r.weight),lab:toLab(hex(pack(...r.sum.map(x=>x/r.weight))))}));
}
const sq=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
export function reducePalette(rows,count){
  if(!Number.isInteger(count)||count<2||count>16)throw Error('Choose 2–16 colours.');
  if(!rows.length)throw Error('The model has no non-degenerate coloured surface.');
  count=Math.min(count,rows.length);
  // Weighted farthest seeds retain distinct small accents; k-means then fits
  // surface area rather than the density of the source triangulation.
  const seeds=[rows.reduce((a,b)=>a.weight>b.weight?a:b).lab];
  while(seeds.length<count){let best=null,score=-1;for(const r of rows){const d=Math.min(...seeds.map(s=>sq(s,r.lab)))*Math.sqrt(r.weight);if(d>score){score=d;best=r;}}if(score<=0)break;seeds.push(best.lab);}
  let centers=seeds.map(s=>s.slice()),owners=new Uint8Array(rows.length);
  for(let step=0;step<18;step++){
    const sums=centers.map(()=>[0,0,0,0]);
    rows.forEach((r,i)=>{let best=0,d=Infinity;centers.forEach((c,j)=>{const x=sq(c,r.lab);if(x<d){d=x;best=j;}});owners[i]=best;for(let k=0;k<3;k++)sums[best][k]+=r.lab[k]*r.weight;sums[best][3]+=r.weight;});
    centers=centers.map((c,j)=>sums[j][3]?sums[j].slice(0,3).map(v=>v/sums[j][3]):c);
  }
  const sums=centers.map(()=>[0,0,0,0]),lookup=new Uint8Array(32768);
  rows.forEach((r,i)=>{const j=owners[i];lookup[r.key]=j;for(let k=0;k<3;k++)sums[j][k]+=r.rgb[k]*r.weight;sums[j][3]+=r.weight;});
  const used=sums.map((s,i)=>({i,s})).filter(x=>x.s[3]>0),remap=new Map(used.map((x,i)=>[x.i,i]));
  for(const r of rows)lookup[r.key]=remap.get(lookup[r.key]);
  const total=sums.reduce((s,r)=>s+r[3],0);
  return {palette:used.map(({s})=>hex(pack(...s.slice(0,3).map(x=>x/s[3])))),coverage:used.map(({s})=>s[3]/total),lookup};
}
export function previewMesh(model,budget=100000){
  // Weld onto a grid, keeping a closed coarse surface instead of dropping every
  // nth face. The exported indexed meshes are never changed by this operation.
  const {min,size}=model.bounds,extent=Math.max(...size);
  for(const cells of [160,96,64,40,24,12]){
    const positions=[],colours=[],seen=new Set();
    for(let mi=0;mi<model.meshes.length;mi++){
      const m=model.meshes[mi],points=new Map(),ids=new Uint32Array(m.positions.length/3),centers=[];
      for(let v=0;v<ids.length;v++){
        const p=Array.from(m.positions.subarray(v*3,v*3+3));const key=p.map((x,a)=>Math.round((x-min[a])/extent*cells)).join(',');
        let id=points.get(key);if(id===undefined){id=centers.length;points.set(key,id);centers.push([0,0,0,0]);}ids[v]=id;
        const c=centers[id];for(let a=0;a<3;a++)c[a]+=p[a];c[3]++;
      }
      for(const p of centers)for(let a=0;a<3;a++)p[a]/=p[3];
      for(let f=0;f<m.colours.length;f++){
        const a=ids[m.indices[f*3]],b=ids[m.indices[f*3+1]],c=ids[m.indices[f*3+2]];
        if(a===b||b===c||a===c)continue;
        const key=mi+':'+[a,b,c].sort((x,y)=>x-y).join(',');if(seen.has(key))continue;seen.add(key);
        for(const id of [a,b,c])positions.push(...centers[id].slice(0,3));colours.push(m.colours[f]);
      }
    }
    if(colours.length && colours.length<=budget)return {positions:Float32Array.from(positions),colours:Uint32Array.from(colours)};
  }
  throw Error('Preview is too complex; simplify the mesh in its source application.');
}
export function orientedPositions(positions,up='z',height=150,modelBounds){
  if(!['y','z'].includes(up)||!Number.isFinite(height)||height<=0||height>1000)throw Error('Choose a height between 0 and 1000 mm and an up axis.');
  const a=up==='y'?1:2,scale=height/modelBounds.size[a];if(!Number.isFinite(scale))throw Error('No height on the selected up axis.');
  const out=new Float32Array(positions.length),center=modelBounds.min.map((v,i)=>v+modelBounds.size[i]/2);
  for(let i=0;i<positions.length;i+=3){const x=(positions[i]-center[0])*scale,y=(positions[i+1]-center[1])*scale,z=(positions[i+2]-center[2])*scale;
    out[i]=x;out[i+1]=up==='y'?-z:y;out[i+2]=(up==='y'?y:z)+height/2;
  }return out;
}
export async function printable3mf(model,reduced,{palette=reduced.palette,height=150,up=model.up}={}){
  if(palette.length!==reduced.palette.length||!palette.every(x=>/^#[0-9a-f]{6}$/i.test(x)))throw Error('Invalid palette.');
  const chunks=[],encoder=new TextEncoder();let lines=[],length=0;
  const add=s=>{lines.push(s);if(lines.length>=12000)flush();};
  const flush=()=>{if(!lines.length)return;const b=encoder.encode(lines.join(''));length+=b.length;if(length>256*1048576)throw Error('Prepared model exceeds 256 MB; simplify the source mesh.');chunks.push(b);lines=[];};
  add('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"><metadata name="Title">'+esc(model.name)+'</metadata><metadata name="Application">YAB3D texture palette import</metadata><resources><m:colorgroup id="1000000">');
  palette.forEach(c=>add(`<m:color color="${c}"/>`));add('</m:colorgroup>');
  add(`<object id="1" name="${esc(model.name)}" type="model" pid="1000000" pindex="0"><mesh><vertices>`);
  model.meshes.forEach(m=>{
    const pos=orientedPositions(m.positions,up,height,model.bounds);
    for(let i=0;i<pos.length;i+=3)add(`<vertex x="${+pos[i].toFixed(5)}" y="${+pos[i+1].toFixed(5)}" z="${+pos[i+2].toFixed(5)}"/>`);
  });
  add('</vertices><triangles>');let vertexOffset=0;
  model.meshes.forEach(m=>{
    for(let f=0;f<m.colours.length;f++)add(`<triangle v1="${m.indices[f*3]+vertexOffset}" v2="${m.indices[f*3+1]+vertexOffset}" v3="${m.indices[f*3+2]+vertexOffset}" pid="1000000" p1="${reduced.lookup[bin(m.colours[f])]}"/>`);
    vertexOffset+=m.positions.length/3;
  });
  add('</triangles></mesh></object></resources><build><item objectid="1"/></build></model>');flush();
  const xml=new Uint8Array(length);let offset=0;for(const b of chunks){xml.set(b,offset);offset+=b.length;}
  return writeZip([
    {name:'3D/3dmodel.model',data:xml},
    {name:'[Content_Types].xml',data:encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')},
    {name:'_rels/.rels',data:encoder.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')},
  ]);
}
