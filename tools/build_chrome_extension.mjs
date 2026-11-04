import {readFile, writeFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {writeZip} from '../web/zip.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'extensions/makerworld-yab3d');
const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));
const files=[];
async function add(relative=''){
  for(const entry of await readdir(path.join(source,relative),{withFileTypes:true})){
    const name=relative ? `${relative}/${entry.name}` : entry.name;
    if(entry.isSymbolicLink())throw Error(`Extension package cannot include a symbolic link: ${name}`);
    if(entry.isDirectory()){
      if(['assets','lib'].includes(name)||name.startsWith('assets/'))await add(name);
    } else if(/\.(?:js|html|json|png)$/.test(name)||['LICENSE','LICENSE-POLYFORM','THIRD_PARTY_NOTICES.md','PRIVACY.md'].includes(name)){
      files.push({name,data:await readFile(path.join(source,name))});
    }
  }
}
await add();
const target=path.join(root,`web/downloads/makerworld-yab3d-${manifest.version}.zip`);
await writeFile(target,await writeZip(files.sort((a,b)=>a.name.localeCompare(b.name))));
console.log(`${manifest.name} ${manifest.version}: ${files.length} files → ${target}`);
