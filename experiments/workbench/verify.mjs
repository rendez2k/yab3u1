import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.argv[2]||'https://workbench-test--yab3u1.netlify.app';
const hash=b=>createHash('sha256').update(b).digest('hex');
const assets=['workbench.js','workbench.css','engine-view.js','engine-view.css','view-layout.js','object-tools.js','object-edits.js','convert-page.js','recolour.js','shared/preview.js','shared/modelHandoff.js','fonts/plex-sans.woff2','fonts/OFL.txt'];
assets.push('filament-tools.js','plate-history.js','shared/selectionUsage.js','shared/previewNormals.js','shared/convertSession.js','shared/project.js','shared/workerClient.js','shared/recolour-worker.js');
assets.push('studio.css','studio-tools.js','model-edit.js','model-edit-worker.js','mesh-cut.js','mesh-joint.js','joint-sample.js','vendor/earcut.js','vendor/EARCUT-LICENSE');
await Promise.all(assets.map(async name=>{
  const response=await fetch(`${base}/${name}`);
  if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
  const remote=new Uint8Array(await response.arrayBuffer());
  const local=await readFile(new URL(`../../dist-workbench/${name}`,import.meta.url));
  if(hash(remote)!==hash(local))throw Error(`${name}: deployed bytes differ`);
}));
for(const [route,marker]of [['/','data-initial="converter"'],['/recolour.html','data-initial="spectrum"'],['/converter-view.html','data-engine="converter"'],['/spectrum-view.html','data-engine="spectrum"']]) {
  const response=await fetch(base+route),body=await response.text();
  if(!response.ok||!body.includes(marker))throw Error(`${route}: wrong entry point`);
}
for(const url of ['https://yab3d.uk/','https://petg-interface-demo--yab3u1.netlify.app/']){
  const response=await fetch(url),html=await response.text();
  if(!response.ok||html.includes('workbench.js'))throw Error(`Unexpected established-site response: ${url}`);
}
console.log(`Verified ${assets.length} asset hashes, four workbench entry points and both established sites.`);
