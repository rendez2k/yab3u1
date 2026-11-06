import {readFileSync,writeFileSync} from 'node:fs';
const root='deliverables/elegoo-ordered-wall-test-2026-11-07';
const spec=JSON.parse(readFileSync(`${root}/test-settings.json`));
const gcode=readFileSync('.impeccable/review/ordered-wall-v1/plate_1.gcode','utf8');
const observations=spec.samples.map(s=>Array.from({length:s.wallLayers},()=>({outer:{},inner:{}})));
const expected={C:0,Y:2};let x=0,y=0,z=0,tool=-1,width=0,type='',relative=true,lastE=0;
const tower={min:[Infinity,Infinity],max:[-Infinity,-Infinity]},tools=new Set(),widths=new Set();
for(const line of gcode.split('\n')){
  if(line.startsWith(';Z:'))z=Number(line.slice(3));
  if(line.startsWith(';WIDTH:'))width=Number(line.slice(7));
  if(line.startsWith(';TYPE:'))type=line.slice(6).trim();
  if(/^T\d+\s*$/.test(line))tool=Number(line.slice(1));
  if(/^M83\b/.test(line))relative=true;if(/^M82\b/.test(line))relative=false;
  if(/^G92\s+E/.test(line))lastE=Number(/E([\d.-]+)/.exec(line)?.[1]||0);
  if(!/^G[01]\s/.test(line))continue;
  const values=Object.fromEntries([...line.split(';')[0].matchAll(/([XYE])([-\d.]+)/g)].map(m=>[m[1],Number(m[2])]));
  const nx=values.X??x,ny=values.Y??y,e=values.E==null?0:relative?values.E:values.E-lastE;
  if(values.E!=null)lastE=values.E;
  const distance=Math.hypot(nx-x,ny-y);
  if(e>0&&distance>0&&tool>=0){
    tools.add(tool);
    if(/prime tower/i.test(type)){for(const [a,b]of [[x,y],[nx,ny]]){tower.min[0]=Math.min(tower.min[0],a-width/2);tower.min[1]=Math.min(tower.min[1],b-width/2);tower.max[0]=Math.max(tower.max[0],a+width/2);tower.max[1]=Math.max(tower.max[1],b+width/2);}}
    for(const [i,s]of spec.samples.entries()){
      const layer=Math.round((z-s.baseHeight)/s.layerHeight)-1;
      if(layer<0||layer>=s.wallLayers)continue;
      const radius=Math.hypot((nx+x)/2-s.centre[0],(ny+y)/2-s.centre[1]);
      if(radius<3.7||radius>5.1)continue;
      const region=radius>s.radius-s.outerWidth?'outer':'inner',observed=observations[i][layer][region];
      observed[tool]=(observed[tool]||0)+distance;widths.add(Number(width.toFixed(3)));
    }
  }
  x=nx;y=ny;
}
const failures=[];
const samples=spec.samples.map((s,i)=>{
  for(let layer=0;layer<s.wallLayers;layer++)for(const region of ['outer','inner']){
    const wanted=expected[s[region][layer%s[region].length]],lengths=observations[i][layer][region];
    if((lengths[wanted]||0)<20||Object.entries(lengths).some(([t,l])=>Number(t)!==wanted&&l>1))failures.push({sample:s.number,layer:layer+1,region,wanted,lengths});
  }
  return {sample:s.number,label:s.label,layersChecked:s.wallLayers,outer:s.outer,inner:s.inner,firstSixLayers:observations[i].slice(0,6)};
});
const stats=gcode.split('\n').filter(line=>/^; (estimated printing time|total filament|filament used|total toolchanges|nozzle_temperature|hot_plate_temp|layer_height|initial_layer_print_height)/.test(line));
const report={checkedAt:new Date().toISOString(),slicer:'Snapmaker Orca 2.4.1',passed:!failures.length,samples,failures,wallPathWidths:[...widths].sort(),tools:[...tools].sort(),primeTower:tower,stats};
writeFileSync(`${root}/toolpath-check.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,failures:failures.slice(0,5),widths:report.wallPathWidths,tower,stats},null,2));
if(failures.length)process.exitCode=1;
