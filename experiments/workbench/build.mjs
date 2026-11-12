import {readFile, writeFile, mkdir, cp, rm, lstat, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'../..');
const studioStyle='studio.css?v='+createHash('sha256').update(await readFile(path.join(here,'studio.css'))).digest('hex').slice(0,12);
execFileSync(process.platform==='win32'?'python':'python3',['tools/build_site.py'],{cwd:root,stdio:'inherit'});
const out=path.join(root,'dist-workbench');
// Clean only this fixed generated folder so removed assets cannot be published.
if ((await lstat(out).catch(error=>{if(error.code!=='ENOENT')throw error;}))?.isSymbolicLink())throw Error('Workbench output must not be a symbolic link.');
if(path.dirname(out)!==root||path.basename(out)!=='dist-workbench')throw Error('Unexpected Workbench output path.');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(path.join(root,'dist'),out,{recursive:true});
await cp(path.join(root,'web/extension-privacy.html'),path.join(out,'extension-privacy.html'));
await cp(path.join(root,'web/downloads/makerworld-yab3d-1.5.3.7.zip'),path.join(out,'downloads/makerworld-yab3d-1.5.3.7.zip'));
for(const [source,controller,kind] of [['index.html','convert-page.js','converter'],['recolour.html','recolour.js','spectrum']]) {
  let html=await readFile(path.join(root,'dist',source),'utf8');
  const script=new RegExp(`<script type="module" src="(?:\\./)?${controller.replace('.','\\.')}"></script>`);
  if(!script.test(html))throw Error(`Missing engine entry: ${controller}`);
  html=html.replace(script,'<script type="module" src="./engine-view.js"></script>')
    .replace('</head>',`<link rel="stylesheet" href="engine-view.css"><link rel="stylesheet" href="${studioStyle}"><style>body[data-engine]:not([data-mounted]){visibility:hidden}</style></head>`)
    .replace('<body',`<body data-engine="${kind}"`);
  await writeFile(path.join(out,`${kind}-view.html`),html);
}
for(const name of ['workbench.css','workbench.js','session-store.js','engine-view.css','engine-view.js','view-layout.js','project-plates.js','file-drop.js','object-edits.js','object-tools.js','plate-history.js','filament-tools.js','studio.css','mesh-cut.js','mesh-joint.js','orientation.js'])await cp(path.join(here,name),path.join(out,name));
await writeFile(path.join(out,'studio-tools.js'),(await readFile(path.join(here,'studio-tools.js'),'utf8')).replaceAll('../../web/','./'));
await writeFile(path.join(out,'prepared-preview.js'),(await readFile(path.join(here,'prepared-preview.js'),'utf8')).replaceAll('../../web/','./'));
for(const name of ['move-tool.js','project-trim.js','painted-cut.js','conform-cut.js','neck-candidates.js','split-result.js','model-colours.js','feature-toolbox.js','model-edit.js','model-edit-worker.js','mesh-repair.js','joint-sample.js','joint-tool.js','auto-split.js','assembly-split.js','auto-layout.js','shape-parts.js','shape-preview.js','shape-tool.js','surface-boundary.js','boundary-worker.js','boundary-tool.js','split-inspection.js','inspection-view.js','split-preview-tool.js'])await writeFile(path.join(out,name),(await readFile(path.join(here,name),'utf8')).replaceAll('../../web/','./'));
await writeFile(path.join(out,'shared/sequentialPanel.js'),(await readFile(path.join(here,'plate-workflow.js'),'utf8')).replaceAll('../../web/shared/','./').replaceAll('../../web/','../').replaceAll("'./auto-layout.js'","'../auto-layout.js'"));
await cp(path.join(here,'vendor'),path.join(out,'vendor'),{recursive:true});
await mkdir(path.join(out,'fonts'),{recursive:true});
await cp(path.join(here,'node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2'),path.join(out,'fonts/plex-sans.woff2'));
await cp(path.join(here,'node_modules/@fontsource-variable/ibm-plex-sans/LICENSE'),path.join(out,'fonts/OFL.txt'));
const shell=(await readFile(path.join(here,'index.html'),'utf8')).replace('href="studio.css"',`href="${studioStyle}"`);
await writeFile(path.join(out,'index.html'),shell);
await writeFile(path.join(out,'recolour.html'),shell.replace('data-initial="converter"','data-initial="spectrum"'));
// Version the complete module graph, including workers. A cached dependency
// must never combine an old editing controller with a new workspace shell.
const assets=(await readdir(out,{recursive:true})).filter(name=>/\.(js|html)$/.test(name)).sort();
const contents=await Promise.all(assets.map(name=>readFile(path.join(out,name),'utf8')));
const revision=createHash('sha256').update(contents.join('\n')).digest('hex').slice(0,12);
await Promise.all(assets.map((name,i)=>writeFile(path.join(out,name),contents[i].replace(/(['"])(\.{1,2}\/[^'"\s]+\.js)\1/g,(_,quote,url)=>`${quote}${url}?v=${revision}${quote}`))));
console.log(`Workbench 2.6.93: ${out}`);
