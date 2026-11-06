import {conversionPlanForPlate,conversionUsage,selectionFootprints,selectionBounds,
  selectionInstances,eligibleObjects,supportPaintPresent,exportProject,MODEL_FILE,MODEL_RELS,SRC_BBL_MODEL,SRC_BBL_PROJECT} from './project.js';
import {selectionUsage} from './selectionUsage.js';
import {SLOTS,identityRule} from './assignment.js';
import {targetLayout,planLayout} from './layout.js';
import {planningAllowance} from './printSettings.js';
import {colourLimit} from './targets.js';

const decode=new TextDecoder(),encode=new TextEncoder();
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const key=reel=>JSON.stringify([reel.color.toUpperCase(),reel.type,reel.profile || null,reel.role || null]);
const read=(entries,name)=>decode.decode(entries.get(name));
const modelMembers=entries=>[...entries].filter(([name])=>name.endsWith('.model')&&name!==MODEL_FILE);

/** Prepare exact per-plate colour plans, including facet paint and part overrides.
 * A large project palette is allowed; a print job never silently drops colours. */
export function planProjectPlates(project,jobs,options={}) {
  const original=conversionUsage(project),target=options.target || 'snapmaker';
  const seen=new Set();
  return jobs.map(job=>{
    const source=project.plates.find(p=>String(p.id)===String(job.plateId));
    if(!source||seen.has(String(job.plateId)))throw Error('Choose each source plate once.');
    seen.add(String(job.plateId));
    const name=job.name || source.name || `Plate ${source.id}`;
    try{
      const ids=eligibleObjects(project,source.id).filter(id=>(job.layout?.quantities?.[id]??1)>0);
      if(!source.objectIds?.length||!ids.length)throw Error('This plate is empty. Restore an object or delete the plate.');
      const footprints=selectionFootprints(project,source.id,ids);
      const usage=selectionUsage(footprints,job.layout?.quantities,original,project.colors.length);
      let mapping={...job.mapping};
      if(job.autoSlots && job.assignmentMode===SLOTS){
        const reserved=usage.reservedThrough || 0,active=usage.kept.filter(id=>id>reserved),all=project.colors.map((_,i)=>i+1);
        mapping=identityRule(all.length);
        [...active,...all.filter(id=>id>reserved&&!active.includes(id))].forEach((id,i)=>mapping[id]=reserved+i+1);
      }
      const sourceSettings=ids.map(id=>({...project.sourceSettings,...project.meta.get(String(id))?.settings}));
      const layout={...targetLayout(target,{copies:1,spacing:5,width:270,depth:270,tower:true,arrangement:'auto',...job.layout}),
        ...(target==='bambu'&&options.bambuSetup?options.bambuSetup.bed:{}),footprints,
        ...planningAllowance(sourceSettings,target,target==='snapmaker'?options.carrySettings!==false:options.preserveSourceSettings,options.supportMode,target==='snapmaker'&&supportPaintPresent(project,source.id,ids))};
      const bounds=selectionBounds(project,source.id,ids),fit=planLayout(bounds,layout);
      if(fit.blocked)throw Error('Objects do not fit. Auto arrange, reduce copies or choose a larger printer.');
      const settings={...options,...job,mapping,layout,selectionAware:true,removeUnused:true};
      const plan=conversionPlanForPlate(project,source.id,ids,settings);
      const activeSlots=[...new Set(usage.kept.map(id=>plan.mapping[id]).filter(Boolean))];
      const capacity=target==='snapmaker'?4:options.capacity;
      const blocked=capacity!=null&&(activeSlots.length>capacity || target==='snapmaker'&&Math.max(...activeSlots)>4);
      const instances=selectionInstances(project,source.id,ids);
      const objectCount=instances.reduce((n,[id])=>n+(layout.quantities?.[id]??1),0)*(layout.copies??1);
      return {...job,name,plateId:source.id,ids,settings,plan,fit,objectCount,activeSlots,
        problem:blocked?`${activeSlots.length} colours need review for ${capacity} printer inputs. Open Colours to merge or rearrange slots.`:'',blocked};
    }catch(error){return {...job,name,plateId:source.id,problem:error.message,blocked:true};}
  });
}

/** Combine native, already-validated one-plate exports. Mesh member paths and
 * root object IDs are namespaced, while local part IDs retain their semantics. */
export function mergeNativePlates(outputs,{title='Edited project',target='snapmaker',width=270,depth=270,notes=[]}={}) {
  if(!outputs.length)throw Error('Keep at least one plate to save.');
  if(target==='prusa')throw Error('Save separate print jobs for PrusaSlicer; its project format does not store this plate list.');
  const entries=new Map(),resources=[],build=[],settings=[],plates=[];
  let nextId=1,nextUuid=1;
  const uuid=s=>s.replace(/p:UUID="[^"]*"/g,()=>`p:UUID="00000000-0000-4000-8000-${String(nextUuid++).padStart(12,'0')}"`);
  const columns=Math.ceil(Math.sqrt(outputs.length));
  outputs.forEach(({built,name},index)=>{
    if(built.problems?.length)throw Error(`${name}: ${built.problems.join(' ')}`);
    const root=read(built.entries,MODEL_FILE),config=read(built.entries,SRC_BBL_MODEL);
    const idMap=new Map([...root.matchAll(/<object\b[^>]*\bid="([^"]+)"/g)].map(m=>[m[1],String(nextId++)]));
    const paths=new Map(modelMembers(built.entries).map(([path])=>[path,`3D/Plates/plate_${index+1}/${path.slice(3)}`]));
    const rewritePaths=text=>text.replace(/p:path="\/?([^"]+)"/g,(all,path)=>{
      if(!paths.has(path))throw Error(`Cannot resolve mesh member ${path}.`);
      return `p:path="/${paths.get(path)}"`;
    });
    const resourceBody=/<resources>([\s\S]*?)<\/resources>/.exec(root)?.[1];
    if(!resourceBody)throw Error('The plate has no native mesh resources.');
    resources.push(uuid(rewritePaths(resourceBody.replace(/<object\b([^>]*?)\bid="([^"]+)"/g,(all,attrs,id)=>`<object${attrs}id="${idMap.get(id)}"`))));
    const offset=[index%columns*width*1.2,-Math.floor(index/columns)*depth*1.2];
    const instanceIds=new Map(),instances=[];
    const items=/<build\b[^>]*>([\s\S]*?)<\/build>/.exec(root)?.[1] || '';
    build.push(uuid(items.replace(/<item\b([^>]+)\/>/g,(all,attrs)=>{
      const sourceId=/objectid="([^"]+)"/.exec(attrs)?.[1],id=idMap.get(sourceId);
      if(!id)throw Error('The plate contains an unresolved build object.');
      const instanceId=instanceIds.get(id)||0;instanceIds.set(id,instanceId+1);instances.push({id,instanceId});
      let rewritten=attrs.replace(/objectid="[^"]+"/,`objectid="${id}"`);
      const transform=/transform="([^"]+)"/.exec(attrs)?.[1]?.split(/\s+/).map(Number) || [1,0,0,0,1,0,0,0,1,0,0,0];
      if(transform.length!==12||transform.some(n=>!Number.isFinite(n)))throw Error('The plate contains an invalid placement.');
      transform[9]+=offset[0];transform[10]+=offset[1];
      rewritten=rewritten.replace(/\s*transform="[^"]*"/,'');
      return `<item${rewritten} transform="${transform.join(' ')}"/>`;
    })));
    for(const object of config.matchAll(/<object\b[^>]*>[\s\S]*?<\/object>/g))settings.push(object[0].replace(/^<object\b([^>]*?)\bid="([^"]+)"/,(all,attrs,id)=>`<object${attrs}id="${idMap.get(id)}"`));
    for(const [path,data]of modelMembers(built.entries))entries.set(paths.get(path),encode.encode(uuid(rewritePaths(decode.decode(data)))));
    for(const [path,data]of built.entries)if(/^Metadata\/plate_1(?:_small)?\.png$/.test(path))entries.set(path.replace('plate_1',`plate_${index+1}`),data);
    plates.push(`<plate><metadata key="plater_id" value="${index+1}"/><metadata key="plater_name" value="${xml(name)}"/><metadata key="thumbnail_file" value="Metadata/plate_${index+1}.png"/>${instances.map(({id,instanceId})=>`<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="${instanceId}"/></model_instance>`).join('')}</plate>`);
  });
  const first=outputs[0].built.entries,root=read(first,MODEL_FILE);
  entries.set(MODEL_FILE,encode.encode(root.replace(/<metadata name="Title">[^<]*<\/metadata>/,()=>`<metadata name="Title">${xml(title)}</metadata>`).replace(/<resources>[\s\S]*?<\/resources>/,()=>`<resources>${resources.join('\n')}</resources>`).replace(/<build\b[^>]*>[\s\S]*?<\/build>/,()=>`<build>${build.join('\n')}</build>`)));
  entries.set(SRC_BBL_MODEL,encode.encode(`<?xml version="1.0" encoding="UTF-8"?><config>${settings.join('\n')}${plates.join('\n')}</config>`));
  entries.set(MODEL_RELS,encode.encode(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...entries.keys()].filter(p=>p.endsWith('.model')&&p!==MODEL_FILE).map((p,i)=>`<Relationship Target="/${p}" Id="mesh-${i}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`).join('')}</Relationships>`));
  for(const path of ['[Content_Types].xml','_rels/.rels',SRC_BBL_PROJECT])if(first.has(path))entries.set(path,first.get(path));
  if(first.has(SRC_BBL_PROJECT)){
    const cfg=JSON.parse(read(first,SRC_BBL_PROJECT));
    for(const k of ['wipe_tower_x','wipe_tower_y'])if(Array.isArray(cfg[k]))cfg[k]=outputs.map(()=>cfg[k][0]);
    entries.set(SRC_BBL_PROJECT,encode.encode(JSON.stringify(cfg,null,2)));
  }
  entries.set('Metadata/YAB3D_project_plates.json',encode.encode(JSON.stringify({version:1,title,notes,plates:outputs.map((o,i)=>({id:i+1,name:o.name,sourcePlate:o.plateId}))},null,2)));
  return {entries,problems:[],target,notes};
}

export function projectPalette(project,prepared,target) {
  // Keep numbered support/infill references fixed; only unreserved entries can
  // be shared between independently arranged plate palettes.
  const reserved=conversionUsage(project).reservedThrough || 0,physical=[];
  for(let i=0;i<reserved;i++)physical.push({color:project.colors[i],type:project.types[i]||'PLA',profile:prepared[0]?.settings.filamentProfiles?.[i]||null});
  const mappings=prepared.map(job=>{
    if(!job.plan)throw Error(`${job.name}: ${job.problem}`);
    const local=new Map();
    job.plan.physical.forEach((reel,i)=>{
      if(i<reserved){if(key(physical[i])!==key(reel))throw Error(`${job.name}: a support or infill filament assignment changed. Restore its original slot before saving all plates.`);local.set(i+1,i+1);return;}
      let index=physical.findIndex(r=>key(r)===key(reel));
      if(index<0){index=physical.length;physical.push(reel);}local.set(i+1,index+1);
    });
    return Object.fromEntries(Object.entries(job.plan.mapping).map(([source,id])=>[source,local.get(id)]));
  });
  if(physical.length>colourLimit(target))throw Error(`The complete project has ${physical.length} filaments, above this format's ${colourLimit(target)} limit. Export separate print jobs.`);
  return {physical,mappings};
}

export function buildProjectPlate(project,job,physical,mapping,thumbnails) {
  return exportProject(project,job.plateId,job.ids,{...job.settings,physical,mapping,recipes:[],
    convert:true,nativeProject:true,thumbnails,title:job.name});
}
