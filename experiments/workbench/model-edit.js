// Workbench-only editing. Source objects and archive members remain intact.
// Each edited copy gets new resources so shared meshes cannot repaint siblings.
import {readProject,selectionInstances,matrixFromText,matmul,applyMatrix,isHiddenPart,MODEL_FILE,SRC_BBL_MODEL,SRC_BBL_PROJECT} from '../../web/shared/project.js';
import {decode,encode} from '../../web/shared/paint.js';
import {leafTriangles} from '../../web/shared/standard.js';
import {cutMesh,connectedParts} from './mesh-cut.js';
const decoder=new TextDecoder(),encoder=new TextEncoder();
const text=(entries,name)=>decoder.decode(entries.get(name)||new Uint8Array());
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const attr=(s,k)=>new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s)?.[1];
const paintRE=/(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9a-f]*)"/i;
const paintLeaf=n=>` paint_color="${encode({kind:'leaf',state:n})}"`;
const stripPaint=s=>s.replace(/\s*(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="[^"]*"/g,'');

function objectBlock(entries,member,id){const found=[...text(entries,member).matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)].find(m=>attr(m[1],'id')===String(id));if(!found)throw Error('A referenced part is missing from the source file.');return found[2];}
function sourceParts(project,plateId,id){
  const object=project.objects.get(String(id)),meta=project.meta.get(String(id))||{};
  if(!object)throw Error('Select an object on the current plate.');
  const parts=[];
  for(const [,instance]of selectionInstances(project,plateId,[String(id)])){
    const components=object.hasMesh?[{objectid:id,path:MODEL_FILE}]:object.components;
    for(const c of components){
      const member=(c.path||MODEL_FILE).replace(/^\//,''),body=objectBlock(project.entries,member,c.objectid);
      if(!body.includes('<mesh'))throw Error('This nested assembly must be separated in its slicer first.');
      const part=(meta.parts||[]).find(p=>String(p.id)===String(c.objectid))||{},base=part.extruder||meta.extruder||1;
      const matrix=matmul(matrixFromText(c.transform),matrixFromText(instance)),points=[];
      for(const v of body.matchAll(/<vertex\b([^>]*)\/>/g)){const p=['x','y','z'].map(a=>Number(attr(v[1],a)));if(p.some(n=>!Number.isFinite(n)))throw Error('The source has an invalid vertex.');points.push(applyMatrix(matrix,p));}
      const faces=[];
      for(const t of body.matchAll(/<triangle\b([^>]*)\/>/g)){const ids=['v1','v2','v3'].map(a=>Number(attr(t[1],a)));if(ids.some(i=>!points[i]))throw Error('A source triangle references a missing vertex.');faces.push({points:ids.map(i=>points[i]),attrs:t[1].replace(/\s*v[123]="[^"]*"/g,'')});}
      parts.push({name:part.name||meta.name||`Object ${id}`,base,settings:part.settings||{},subtype:part.subtype||'normal_part',faces});
    }
  }
  if(!parts.length)throw Error('This object has no printable instances.');
  return {parts,meta};
}

function recolour(part,from,to){
  if(isHiddenPart(part.subtype))return part;
  return {...part,faces:part.faces.map(face=>{
    const original=paintRE.exec(face.attrs)?.[1];
    let value;
    if(from==='all')value=paintLeaf(to);
    else if(original){const node=decode(original);const map={[Number(from)]:to};if(Number(from)===part.base)map[0]=to;
      const replace=n=>n.kind==='leaf'?{...n,state:map[n.state]??n.state}:{...n,children:n.children.map(replace)};
      value=` paint_color="${encode(replace(node))}"`;
    }else value=paintLeaf(part.base===Number(from)?to:part.base);
    return {...face,attrs:stripPaint(face.attrs)+value};
  })};
}

function cutPart(part,axis,height){
  const faces=[];
  for(const f of part.faces){
    const crosses=f.points.some(p=>p[axis]<height-1e-6)&&f.points.some(p=>p[axis]>height+1e-6);
    if(!crosses){faces.push(f);continue;}
    // A cut cannot reinterpret a subdivided support/seam tree on a new triangle.
    for(const a of f.attrs.matchAll(/(?:support|seam)[\w:]*="([0-9a-f]+)"/gi))if(decode(a[1]).kind!=='leaf')throw Error('The cut crosses subdivided support or seam painting. Move the cut, or make this cut in the slicer.');
    const code=paintRE.exec(f.attrs)?.[1],node=code?decode(code):null;
    if(node?.kind==='split')for(const leaf of leafTriangles(f.points,node))faces.push({points:leaf.triangle,attrs:stripPaint(f.attrs)+paintLeaf(leaf.state||part.base)});
    else faces.push(f);
  }
  if(faces.every(f=>f.points.every(p=>p[axis]>=height-1e-6)))return [null,part];
  if(faces.every(f=>f.points.every(p=>p[axis]<=height+1e-6)))return [part,null];
  return cutMesh(faces,axis,height,paintLeaf(part.base)).halves.map(f=>({...part,faces:f}));
}

function meshXml(part,id){
  const vertices=[],triangles=[],indices=new Map();
  const add=p=>{const key=p.map(n=>Number(n.toFixed(7))).join(',');if(indices.has(key))return indices.get(key);const index=vertices.length;indices.set(key,index);vertices.push(`<vertex x="${+p[0].toFixed(7)}" y="${+p[1].toFixed(7)}" z="${+p[2].toFixed(7)}"/>`);return index;};
  for(const f of part.faces){const ids=f.points.map(add);if(new Set(ids).size<3)continue;triangles.push(`<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"${f.attrs}/>`);}
  return `<object id="${id}" type="model"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
}
const settingsXml=settings=>Object.entries(settings||{}).map(([k,v])=>`<metadata key="${esc(k)}" value="${esc(v)}"/>`).join('');

export function editProject(input,{plateId=1,objectIds=[],operation,from='all',colour,axis=2,position=50}={}){
  const entries=new Map(input),project=readProject(entries,{allowNegative:true});
  if(!objectIds.length)throw Error('Select an object first.');
  if(!['colour','cut','separate'].includes(operation))throw Error('Choose Colour or Split.');
  const colours=project.colors.slice();let target=0;
  if(operation==='colour'){
    if(!/^#[0-9a-f]{6}$/i.test(colour||''))throw Error('Choose a valid filament colour.');
    target=colours.findIndex(c=>c.toUpperCase()===colour.toUpperCase())+1;
    if(!target){if(colours.length>=16)throw Error('This file already contains 16 colours. Choose an existing filament.');colours.push(colour.toUpperCase());target=colours.length;}
  }
  let next=Math.max(1,...[...project.objects.keys()].map(Number))+1;
  const resources=[],newItems=[],newMeta=[],changes=[];
  for(const oldId of objectIds){
    const {parts,meta}=sourceParts(project,plateId,oldId);let groups=[];
    if(operation==='colour')groups=[parts.map(p=>recolour(p,from,target))];
    else {
      if(parts.some(p=>isHiddenPart(p.subtype)))throw Error('This object contains a negative or modifier volume. Split it in your slicer so its cutouts stay correct.');
      if(operation==='separate'){
        groups=parts.flatMap(p=>connectedParts(p.faces).map(faces=>[{...p,faces}]));
        if(groups.length<2)throw Error('This is one connected piece. Use a plane cut to make separate parts.');
        if(groups.length>64)throw Error('This object contains more than 64 disconnected shells. Repair or group them in your slicer first.');
      } else {
        if(!Number.isFinite(position)||position<=0||position>=100)throw Error('Place the cut between 1% and 99% of the object.');
        let lo=Infinity,hi=-Infinity;for(const p of parts)for(const f of p.faces)for(const v of f.points){lo=Math.min(lo,v[axis]);hi=Math.max(hi,v[axis]);}
        const height=lo+(hi-lo)*position/100;groups=[[],[]];for(const part of parts){const split=cutPart(part,axis,height);split.forEach((p,i)=>{if(p)groups[i].push(p);});}
        if(groups.some(g=>!g.length))throw Error('The cut leaves an empty part. Change the cut position.');
      }
    }
    const created=[];
    for(let g=0;g<groups.length;g++){
      let group=groups[g];
      if(operation!=='colour'){
        let floor=Infinity;for(const p of group)for(const f of p.faces)for(const v of f.points)floor=Math.min(floor,v[2]);
        group=group.map(p=>({...p,faces:p.faces.map(f=>({...f,points:f.points.map(v=>[v[0],v[1],v[2]-floor])}))}));
      }
      const id=String(next++),name=(meta.name||`Object ${oldId}`)+(operation==='colour'?' · coloured':` · part ${g+1}`);
      const components=[],partMeta=[];
      for(const p of group){const pid=String(next++);resources.push(meshXml(p,pid));components.push(`<component objectid="${pid}"/>`);partMeta.push(`<part id="${pid}" subtype="${esc(p.subtype)}"><metadata key="name" value="${esc(p.name)}"/><metadata key="extruder" value="${p.base}"/>${settingsXml(p.settings)}</part>`);}
      resources.push(`<object id="${id}" type="model"><components>${components.join('')}</components></object>`);
      newItems.push(`<item objectid="${id}" printable="1"/>`);
      newMeta.push(`<object id="${id}"><metadata key="name" value="${esc(name)}"/><metadata key="extruder" value="${meta.extruder||1}"/>${settingsXml(meta.settings)}${partMeta.join('')}</object>`);
      created.push({id,name});
    }
    changes.push({oldId:String(oldId),created});
  }
  const root=text(entries,MODEL_FILE).replace('</resources>',resources.join('')+'</resources>').replace('</build>',newItems.join('')+'</build>');
  entries.set(MODEL_FILE,encoder.encode(root));
  let config=text(entries,SRC_BBL_MODEL);
  if(!config){config='<config>'+[...project.meta.values()].map(m=>`<object id="${m.id}"><metadata key="name" value="${esc(m.name)}"/><metadata key="extruder" value="${m.extruder||1}"/>${settingsXml(m.settings)}</object>`).join('')+project.plates.map(p=>`<plate><metadata key="plater_name" value="${esc(p.name)}"/>${p.objectIds.map(id=>`<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance>`).join('')}</plate>`).join('')+'</config>';}
  let plateIndex=0;
  config=config.replace(/<plate>([\s\S]*?)<\/plate>/g,(full,body)=>++plateIndex===Number(plateId)?`<plate>${body}${changes.flatMap(c=>c.created).map(c=>`<model_instance><metadata key="object_id" value="${c.id}"/><metadata key="instance_id" value="0"/></model_instance>`).join('')}</plate>`:full).replace('</config>',newMeta.join('')+'</config>');
  entries.set(SRC_BBL_MODEL,encoder.encode(config));
  const cfg={...project.sourceSettings,...JSON.parse(text(entries,SRC_BBL_PROJECT)||'{}')};cfg.filament_colour=colours;cfg.filament_type=colours.map((_,i)=>project.types[i]||'PLA');entries.set(SRC_BBL_PROJECT,encoder.encode(JSON.stringify(cfg)));
  // Generated source is re-read before it can replace the live workspace.
  const checked=readProject(entries,{allowNegative:true});for(const c of changes)for(const n of c.created)if(!checked.objects.has(n.id))throw Error('The edit could not be validated.');
  return {entries,changes,colours};
}
