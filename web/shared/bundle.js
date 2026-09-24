import {readZip, MAX_ARCHIVE_BYTES} from '../zip.js';

export async function unpackBundle(bytes) {
  const inventory=[];
  const entries=await readZip(bytes,{include:name=>/\.3mf$/i.test(name),onEntry:item=>inventory.push(item)});
  if(entries.size>50) throw new Error('This ZIP contains more than 50 projects. Split it into smaller bundles.');
  const files=[];
  for(const [name,data] of entries) {
    if(data.byteLength>MAX_ARCHIVE_BYTES) throw new Error(`${name} exceeds the 96 MB project limit.`);
    files.push({name,bytes:data});
  }
  return {files,ignored:inventory.filter(i=>!i.name.endsWith('/') && !/\.3mf$/i.test(i.name))};
}
