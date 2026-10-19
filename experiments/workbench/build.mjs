import {readFile, writeFile, mkdir, cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'../..');
execFileSync('python',['tools/build_site.py'],{cwd:root,stdio:'pipe'});
const out=path.join(root,'dist-workbench');
await mkdir(out,{recursive:true});
await cp(path.join(root,'dist'),out,{recursive:true});
for(const [source,controller,kind] of [['index.html','convert-page.js','converter'],['recolour.html','recolour.js','spectrum']]) {
  let html=await readFile(path.join(root,'dist',source),'utf8');
  const script=new RegExp(`<script type="module" src="(?:\\./)?${controller.replace('.','\\.')}"></script>`);
  if(!script.test(html))throw Error(`Missing engine entry: ${controller}`);
  html=html.replace(script,'<script type="module" src="./engine-view.js"></script>')
    .replace('</head>','<link rel="stylesheet" href="engine-view.css"><link rel="stylesheet" href="studio.css"><style>body[data-engine]:not([data-mounted]){visibility:hidden}</style></head>')
    .replace('<body',`<body data-engine="${kind}"`);
  await writeFile(path.join(out,`${kind}-view.html`),html);
}
for(const name of ['workbench.css','workbench.js','engine-view.css','engine-view.js','view-layout.js','object-edits.js','object-tools.js','plate-history.js','filament-tools.js','studio.css','mesh-cut.js','mesh-joint.js','orientation.js'])await cp(path.join(here,name),path.join(out,name));
await writeFile(path.join(out,'studio-tools.js'),(await readFile(path.join(here,'studio-tools.js'),'utf8')).replaceAll('../../web/','./'));
await writeFile(path.join(out,'prepared-preview.js'),(await readFile(path.join(here,'prepared-preview.js'),'utf8')).replaceAll('../../web/','./'));
for(const name of ['model-edit.js','model-edit-worker.js','joint-sample.js','auto-split.js','auto-layout.js'])await writeFile(path.join(out,name),(await readFile(path.join(here,name),'utf8')).replaceAll('../../web/','./'));
await writeFile(path.join(out,'shared/sequentialPanel.js'),(await readFile(path.join(here,'plate-workflow.js'),'utf8')).replaceAll('../../web/shared/','./').replaceAll('../../web/','../').replaceAll("'./auto-layout.js'","'../auto-layout.js'"));
await cp(path.join(here,'vendor'),path.join(out,'vendor'),{recursive:true});
await mkdir(path.join(out,'fonts'),{recursive:true});
await cp(path.join(here,'node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2'),path.join(out,'fonts/plex-sans.woff2'));
await cp(path.join(here,'node_modules/@fontsource-variable/ibm-plex-sans/LICENSE'),path.join(out,'fonts/OFL.txt'));
const shell=await readFile(path.join(here,'index.html'),'utf8');
await writeFile(path.join(out,'index.html'),shell);
await writeFile(path.join(out,'recolour.html'),shell.replace('data-initial="converter"','data-initial="spectrum"'));
console.log(`Workbench 2.6.36-test: ${out}`);
