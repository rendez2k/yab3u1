// Open part of a large multi-plate project.
//
// A slicer project keeps each plate's objects in their own model files. Listing
// the plates needs only the small settings files, so a project far too large to
// load whole can still be opened a plate at a time. The trimmed project is a
// normal 3MF: unchosen plates, their objects and their model files are left out,
// and nothing in the kept objects is changed.
import {readZip,writeZip} from '../../web/zip.js';

const ROOT='3D/3dmodel.model',SETTINGS='Metadata/model_settings.config',RELS='3D/_rels/3dmodel.model.rels';
const enc=new TextEncoder(),dec=new TextDecoder();
export const PICKER_THRESHOLD_BYTES=40*1024*1024;
const isObjectFile=name=>/^3D\/Objects\/[^/]+\.model$/i.test(name);
const unescape=text=>String(text).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const meta=(body,key)=>{const m=new RegExp(`<metadata(?: type="[^"]*")? key="${key}" value="([^"]*)"`).exec(body);return m?unescape(m[1]):null;};

function describe(entries,sizes){
  const root=dec.decode(entries.get(ROOT)),settings=dec.decode(entries.get(SETTINGS));
  // Root objects: which model files (and which other root objects) each one is built from.
  const objects=new Map();
  for(const m of root.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)){
    const id=/\bid="([^"]+)"/.exec(m[1])?.[1];if(!id)continue;
    const paths=new Set(),inline=new Set();
    for(const c of m[2].matchAll(/<component\b([^>]*)\/>/g)){
      const path=/\bp:path="([^"]+)"/.exec(c[1])?.[1],ref=/\bobjectid="([^"]+)"/.exec(c[1])?.[1];
      if(path)paths.add(unescape(path).replace(/^\//,''));else if(ref)inline.add(ref);
    }
    objects.set(id,{id,paths,inline,mesh:/<mesh\b/.test(m[2])});
  }
  const names=new Map();
  for(const m of settings.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)){
    const id=/\bid="([^"]+)"/.exec(m[1])?.[1];if(id)names.set(id,meta(m[2].split(/<part\b/)[0],'name')||`Object ${id}`);
  }
  const plates=[];
  for(const m of settings.matchAll(/<plate>([\s\S]*?)<\/plate>/g)){
    const body=m[1],id=meta(body.split(/<model_instance>/)[0],'plater_id');if(id===null)continue;
    const objectIds=[...new Set([...body.matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)].map(i=>meta(i[1],'object_id')).filter(Boolean))];
    const files=new Set();for(const objectId of objectIds)for(const path of closure(objects,[objectId]).paths)files.add(path);
    const thumbnail=meta(body,'thumbnail_file');
    plates.push({id,name:meta(body,'plater_name')||'',objectIds,objectNames:objectIds.map(o=>names.get(o)||`Object ${o}`),
      bytes:[...files].reduce((sum,path)=>sum+(sizes.get(path)||0),0),thumbnail:thumbnail&&entries.has(thumbnail)?entries.get(thumbnail):null});
  }
  return {objects,plates};
}
/** Every root object and model file reachable from the given objects. */
function closure(objects,ids){
  const keep=new Set(),paths=new Set(),queue=[...ids];
  while(queue.length){const id=queue.pop();if(keep.has(id))continue;const object=objects.get(id);if(!object)continue;keep.add(id);for(const p of object.paths)paths.add(p);queue.push(...object.inline);}
  return {keep,paths};
}

/** List the plates of a project without reading its model files.
 * Returns null when the file is not a multi-plate slicer project this can split. */
export async function inspectPlates(bytes){
  const sizes=new Map();let entries;
  try{entries=await readZip(bytes,{include:name=>!isObjectFile(name)&&!/\.gcode$/i.test(name),onEntry:e=>sizes.set(e.name,e.size)});}catch{return null;}
  if(!entries.has(ROOT)||!entries.has(SETTINGS))return null;
  let found;try{found=describe(entries,sizes);}catch{return null;}
  const plates=found.plates.filter(p=>p.objectIds.length);
  if(plates.length<2)return null;
  // A project whose geometry sits inside the root file cannot be opened in parts.
  const external=[...sizes].filter(([name])=>isObjectFile(name)).reduce((sum,[,size])=>sum+size,0);
  if(!external)return null;
  return {plates,totalBytes:external};
}

/** Build a project holding only the chosen plates. */
export async function trimProject(bytes,plateIds){
  const wanted=new Set(plateIds.map(String)),sizes=new Map();
  const small=await readZip(bytes,{include:name=>!isObjectFile(name)&&!/\.gcode$/i.test(name),onEntry:e=>sizes.set(e.name,e.size)});
  const {objects,plates}=describe(small,sizes);
  const chosen=plates.filter(p=>wanted.has(String(p.id)));
  if(!chosen.length)throw Error('Choose at least one plate to open.');
  const {keep,paths}=closure(objects,chosen.flatMap(p=>p.objectIds));
  const root=dec.decode(small.get(ROOT))
    .replace(/[ \t]*<object\b([^>]*)>[\s\S]*?<\/object>\s*/g,(whole,attrs)=>keep.has(/\bid="([^"]+)"/.exec(attrs)?.[1])?whole:'')
    .replace(/[ \t]*<item\b([^>]*)\/>\s*/g,(whole,attrs)=>keep.has(/\bobjectid="([^"]+)"/.exec(attrs)?.[1])?whole:'');
  const settings=dec.decode(small.get(SETTINGS))
    .replace(/[ \t]*<object\b([^>]*)>[\s\S]*?<\/object>\s*/g,(whole,attrs)=>keep.has(/\bid="([^"]+)"/.exec(attrs)?.[1])?whole:'')
    .replace(/[ \t]*<plate>([\s\S]*?)<\/plate>\s*/g,(whole,body)=>wanted.has(String(meta(body.split(/<model_instance>/)[0],'plater_id')))?whole:'')
    // Assembly records for objects that are gone would dangle.
    .replace(/[ \t]*<assemble_item\b([^>]*)\/>\s*/g,(whole,attrs)=>keep.has(/\bobject_id="([^"]+)"/.exec(attrs)?.[1])?whole:'');
  const out=new Map(small);
  out.set(ROOT,enc.encode(root));out.set(SETTINGS,enc.encode(settings));
  if(out.has(RELS))out.set(RELS,enc.encode(dec.decode(out.get(RELS)).replace(/[ \t]*<Relationship\b([^>]*)\/>\s*/g,(whole,attrs)=>{const target=/\bTarget="([^"]+)"/.exec(attrs)?.[1];return !target||!isObjectFile(unescape(target).replace(/^\//,''))||paths.has(unescape(target).replace(/^\//,''))?whole:'';})));
  // Thumbnails and slice records of plates that were left out are not needed.
  const dropped=plates.filter(p=>!wanted.has(String(p.id)));
  for(const name of [...out.keys()])if(dropped.some(p=>new RegExp(`^Metadata/(?:plate|top|pick|plate_no_light)_${p.id}(?:_small)?\\.(?:png|json)$`).test(name)))out.delete(name);
  const models=await readZip(bytes,{include:name=>paths.has(name)});
  for(const path of paths)if(!models.has(path))throw Error(`${path} is used by a chosen plate but is not in the file.`);
  for(const [name,data]of models)out.set(name,data);
  return {bytes:await writeZip([...out].map(([name,data])=>({name,data}))),plates:chosen.length,objects:keep.size,files:paths.size};
}
