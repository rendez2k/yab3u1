// Workbench-only editing. Source objects and archive members remain intact.
// Each edited copy gets new resources so shared meshes cannot repaint siblings.
import {readProject,selectionInstances,matrixFromText,matmul,applyMatrix,isHiddenPart,isPrintablePart,MODEL_FILE,SRC_BBL_MODEL,SRC_BBL_PROJECT,MAX_SOURCE_COLOURS} from '../../web/shared/project.js';
import {decode,encode} from '../../web/shared/paint.js';
import {leafTriangles} from '../../web/shared/standard.js';
import {cutMesh,connectedParts} from './mesh-cut.js';
import {closeInterface,separateColour} from './mesh-joint.js';
import {orientPinUp} from './orientation.js';
import {autoSeparate} from './auto-split.js';
const decoder=new TextDecoder(),encoder=new TextEncoder();
const text=(entries,name)=>decoder.decode(entries.get(name)||new Uint8Array());
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const attr=(s,k)=>new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s)?.[1];
const paintRE=/(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9a-f]*)"/i;
const paintLeaf=n=>` paint_color="${encode({kind:'leaf',state:n})}"`;
const stripPaint=s=>s.replace(/\s*(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="[^"]*"/g,'');

function objectBlock(entries,member,id){const found=[...text(entries,member).matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)].find(m=>attr(m[1],'id')===String(id));if(!found)throw Error('A referenced part is missing from the source file.');return found[2];}
export function sourceParts(project,plateId,id){
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
      parts.push({name:part.name||meta.name||`Object ${id}`,base,settings:part.settings||{},subtype:isPrintablePart(part.subtype)?'normal_part':part.subtype,faces});
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

function cutPart(part,axis,height,connector){
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
  const cut=cutMesh(faces,axis,height,paintLeaf(part.base));
  const joined=connector?closeInterface(...cut.openHalves,cut.loops,{normal:[0,1,2].map(i=>i===axis?1:0),attrsA:paintLeaf(part.base),attrsB:paintLeaf(part.base),connector}):{halves:cut.halves};
  const pinSide=connector?.side==='base'?0:1;
  return joined.halves.map((f,i)=>({...part,faces:f,pinDirections:joined.joint&&i===pinSide?[joined.joint.normal.map(v=>v*(pinSide===0?1:-1))]:[]}));
}

function colourFaces(part){
  return part.faces.flatMap(f=>{
    const code=paintRE.exec(f.attrs)?.[1],node=code?decode(code):{kind:'leaf',state:part.base};
    if(node.kind==='split')for(const a of f.attrs.matchAll(/(?:support|seam)[\w:]*="([0-9a-f]+)"/gi))if(decode(a[1]).kind!=='leaf')throw Error('This object has overlapping subdivided colour and support/seam painting. Separate it in the slicer to preserve both.');
    return leafTriangles(f.points,node).map(leaf=>({points:leaf.triangle,attrs:node.kind==='leaf'?f.attrs:stripPaint(f.attrs)+paintLeaf(leaf.state||part.base),colour:leaf.state||part.base}));
  });
}

export function inspectRegions(input,{plateId=1,objectIds=[],from}={},progress=()=>{}){
  if(objectIds.length!==1)throw Error('Select one object to choose a painted region.');
  const project=readProject(input,{allowNegative:true,allowModifiers:true}),{parts}=sourceParts(project,plateId,objectIds[0]),regions=[];
  if(parts.some(p=>isHiddenPart(p.subtype)))throw Error('This object contains a negative or settings modifier. Split it in your slicer to preserve its roles.');
  for(const [partIndex,part] of parts.entries()){
    const faces=colourFaces(part),groups=connectedParts(faces.filter(f=>f.colour===Number(from)));
    if(groups.length>32)throw Error('This colour has more than 32 disconnected patches. Separate it in your slicer or use a plane cut.');
    for(const [index,group] of groups.entries()){
      progress(`Checking colour region ${regions.length+1}…`);
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(const f of group)for(const p of f.points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
      let error='';try{separateColour(faces,Number(from),{region:index,capAttributes:paintLeaf});}catch(e){error=e.message;}
      regions.push({id:`${partIndex}:${index}`,size:max.map((v,i)=>v-min[i]),bounds:{min,max},error,triangles:group.length});
    }
  }
  return regions;
}

function meshXml(part,id){
  const vertices=[],triangles=[],indices=new Map();
  const add=p=>{const key=p.map(n=>Number(n.toFixed(7))).join(',');if(indices.has(key))return indices.get(key);const index=vertices.length;indices.set(key,index);vertices.push(`<vertex x="${+p[0].toFixed(7)}" y="${+p[1].toFixed(7)}" z="${+p[2].toFixed(7)}"/>`);return index;};
  for(const f of part.faces){const ids=f.points.map(add);if(new Set(ids).size<3)continue;triangles.push(`<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"${f.attrs}/>`);}
  return `<object id="${id}" type="model"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
}
const settingsXml=settings=>Object.entries(settings||{}).map(([k,v])=>`<metadata key="${esc(k)}" value="${esc(v)}"/>`).join('');

export function editProject(input,{plateId=1,objectIds=[],operation,from='all',colour,axis=2,position=50,connector=null,region=null,orientPins=true}={},progress=()=>{}){
  const entries=new Map(input),project=readProject(entries,{allowNegative:true,allowModifiers:true});
  if(!objectIds.length)throw Error('Select an object first.');
  if(!['colour','cut','separate','separate-colour','remove-colour','auto-separate'].includes(operation))throw Error('Choose Colour or Split.');
  if(operation==='auto-separate'&&connector&&connector.side==='base')throw Error('Automatic separation places pins on the detached pieces.');
  if(operation.endsWith('-colour')&&(!Number.isInteger(Number(from))||Number(from)<1||Number(from)>project.colors.length))throw Error('Choose a source colour to separate.');
  const colours=project.colors.slice();let target=0;
  if(operation==='colour'){
    if(!/^#[0-9a-f]{6}$/i.test(colour||''))throw Error('Choose a valid filament colour.');
    target=colours.findIndex(c=>c.toUpperCase()===colour.toUpperCase())+1;
    if(!target){if(colours.length>=MAX_SOURCE_COLOURS)throw Error(`This file already contains ${MAX_SOURCE_COLOURS} colours. Choose an existing filament.`);colours.push(colour.toUpperCase());target=colours.length;}
  }
  let next=Math.max(1,...[...project.objects.keys()].map(Number))+1;
  const resources=[],newItems=[],newMeta=[],changes=[],reports=[];
  for(const oldId of objectIds){
    if(operation==='colour' && project.meta.get(String(oldId))?.parts?.some(p=>p.subtype==='modifier_part'))
      throw Error('This object contains a settings modifier. Reassign its filament in Colours, or edit it in your slicer to preserve the modifier.');
    const {parts,meta}=sourceParts(project,plateId,oldId);let groups=[],names=[];
    if(operation==='colour')groups=[parts.map(p=>recolour(p,from,target))];
    else {
      if(parts.some(p=>isHiddenPart(p.subtype))){
        if(operation==='auto-separate'){reports.push({objectId:String(oldId),name:meta.name,parts:1,separated:[],retained:[{count:1,reason:'Contains modifier or negative volumes. Use your slicer to preserve their roles.'}]});continue;}
        throw Error('This object contains a negative or modifier volume. Split it in your slicer so its cutouts stay correct.');
      }
      if(operation==='auto-separate'){
        let result;
        try{result=autoSeparate(parts.map(p=>({...p,faces:colourFaces(p)})),{connector,progress});}
        catch(error){reports.push({objectId:String(oldId),name:meta.name,parts:1,separated:[],retained:[{count:1,reason:error.message}]});continue;}
        reports.push({objectId:String(oldId),name:meta.name,...result.report});
        if(result.groups.length<2)continue;
        groups=result.groups;names=result.names;
      }else if(operation.endsWith('-colour')){
        const rest=[],detached=[];let found=false;
        for(const [partIndex,part] of parts.entries()){
          const faces=colourFaces(part);
          if(!faces.some(f=>f.colour===Number(from))){rest.push(part);continue;}
          if(region&&Number(region.split(':')[0])!==partIndex){rest.push(part);continue;}
          found=true;
          const result=separateColour(faces,Number(from),{connector:operation==='remove-colour'?null:connector,capAttributes:paintLeaf,region:region?Number(region.split(':')[1]):null});
          if(result.remaining.length)rest.push({...part,faces:result.remaining,pinDirections:connector?.side==='base'?result.joints.filter(Boolean).map(j=>j.normal):[]});
          detached.push(...result.parts.map((faces,i)=>[{...part,base:Number(from),faces,pinDirections:connector&&connector.side!=='base'&&result.joints[i]?[result.joints[i].normal.map(v=>-v)]:[]}]));
        }
        if(!found)throw Error('This colour is not painted on one of the selected objects. Select only objects that use it.');
        if(rest.length){groups.push(rest);names.push('remainder');}
        if(operation==='separate-colour')for(let i=0;i<detached.length;i++){groups.push(detached[i]);names.push(`colour ${from}${detached.length>1?` · ${i+1}`:''}`);}
      }else if(operation==='separate'){
        groups=parts.flatMap(p=>connectedParts(p.faces).map(faces=>[{...p,faces}]));
        if(groups.length<2)throw Error('This is one connected piece. Use a plane cut to make separate parts.');
        if(groups.length>64)throw Error('This object contains more than 64 disconnected shells. Repair or group them in your slicer first.');
      } else {
        if(!Number.isFinite(position)||position<=0||position>=100)throw Error('Place the cut between 1% and 99% of the object.');
        let lo=Infinity,hi=-Infinity;for(const p of parts)for(const f of p.faces)for(const v of f.points){lo=Math.min(lo,v[axis]);hi=Math.max(hi,v[axis]);}
        const height=lo+(hi-lo)*position/100;groups=[[],[]];for(const part of parts){const split=cutPart(part,axis,height,connector);split.forEach((p,i)=>{if(p)groups[i].push(p);});}
        if(groups.some(g=>!g.length))throw Error('The cut leaves an empty part. Change the cut position.');
      }
    }
    const created=[];
    for(let g=0;g<groups.length;g++){
      let group=groups[g];
      if(operation!=='colour'){
        if(connector&&orientPins)group=orientPinUp(group,group.flatMap(p=>p.pinDirections||[]));
        let floor=Infinity;for(const p of group)for(const f of p.faces)for(const v of f.points)floor=Math.min(floor,v[2]);
        group=group.map(p=>({...p,faces:p.faces.map(f=>({...f,points:f.points.map(v=>[v[0],v[1],v[2]-floor])}))}));
      }
      const id=String(next++),name=(meta.name||`Object ${oldId}`)+(operation==='colour'?' · coloured':` · ${names[g]||`part ${g+1}`}`);
      const components=[],partMeta=[];
      for(const p of group){const pid=String(next++);resources.push(meshXml(p,pid));components.push(`<component objectid="${pid}"/>`);partMeta.push(`<part id="${pid}" subtype="${esc(p.subtype)}"><metadata key="name" value="${esc(p.name)}"/><metadata key="extruder" value="${p.base}"/>${settingsXml(p.settings)}</part>`);}
      resources.push(`<object id="${id}" type="model"><components>${components.join('')}</components></object>`);
      newItems.push(`<item objectid="${id}" printable="1"/>`);
      newMeta.push(`<object id="${id}"><metadata key="name" value="${esc(name)}"/><metadata key="extruder" value="${meta.extruder||1}"/>${settingsXml(meta.settings)}${partMeta.join('')}</object>`);
      created.push({id,name});
    }
    changes.push({oldId:String(oldId),created});
  }
  if(!changes.length)return {entries,changes,colours,reports};
  const root=text(entries,MODEL_FILE).replace('</resources>',resources.join('')+'</resources>').replace('</build>',newItems.join('')+'</build>');
  entries.set(MODEL_FILE,encoder.encode(root));
  let config=text(entries,SRC_BBL_MODEL);
  if(!config){config='<config>'+[...project.meta.values()].map(m=>`<object id="${m.id}"><metadata key="name" value="${esc(m.name)}"/><metadata key="extruder" value="${m.extruder||1}"/>${settingsXml(m.settings)}</object>`).join('')+project.plates.map(p=>`<plate><metadata key="plater_name" value="${esc(p.name)}"/>${p.objectIds.map(id=>`<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance>`).join('')}</plate>`).join('')+'</config>';}
  let plateIndex=0;
  config=config.replace(/<plate>([\s\S]*?)<\/plate>/g,(full,body)=>++plateIndex===Number(plateId)?`<plate>${body}${changes.flatMap(c=>c.created).map(c=>`<model_instance><metadata key="object_id" value="${c.id}"/><metadata key="instance_id" value="0"/></model_instance>`).join('')}</plate>`:full).replace('</config>',newMeta.join('')+'</config>');
  entries.set(SRC_BBL_MODEL,encoder.encode(config));
  const cfg={...project.sourceSettings,...JSON.parse(text(entries,SRC_BBL_PROJECT)||'{}')};cfg.filament_colour=colours;cfg.filament_type=colours.map((_,i)=>project.types[i]||'PLA');entries.set(SRC_BBL_PROJECT,encoder.encode(JSON.stringify(cfg)));
  // Generated source is re-read before it can replace the live workspace.
  const checked=readProject(entries,{allowNegative:true,allowModifiers:true});for(const c of changes)for(const n of c.created)if(!checked.objects.has(n.id))throw Error('The edit could not be validated.');
  return {entries,changes,colours,reports};
}
