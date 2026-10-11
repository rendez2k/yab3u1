import {exportProject, SRC_BBL_PROJECT, SRC_BBL_MODEL, analyse, conversionUsage} from './project.js';
const encode=new TextEncoder(),decode=new TextDecoder();

export function exportComparisonJob(project,plateId,job,options) {
  if(!['bambu','snapmaker'].includes(options.target))throw Error('Timing comparisons currently support Bambu Studio and Snapmaker Orca.');
  if(options.target==='bambu'&&!options.bambuSetup)throw Error('Choose a native Bambu printer profile for comparable timings.');
  if(!job.objects?.length||!['by layer','by object'].includes(job.sequence))throw Error('Invalid comparison job.');
  if(options.target==='snapmaker' && (options.physical||options.reels||[]).length>4) {
    if(options.recipes?.length||options.supportInterface)throw Error('This U1 comparison has more than four physical filaments. Apply a compatible palette before comparing.');
    if(conversionUsage(project).uncertain)throw Error('Custom tool changes or uncertain filament references prevent safe U1 filament compaction.');
    const sources=[project.sourceSettings,...job.objects.flatMap(id=>{
      const meta=project.meta.get(String(id));return [meta?.settings,...(meta?.parts||[]).map(p=>p.settings)];
    })];
    if(sources.some(s=>Object.entries(s||{}).some(([key,value])=>/(?:support(?:_material)?(?:_interface)?|wall|sparse_infill|solid_infill|perimeter|infill)_(?:extruder|filament)$/.test(key)&&Number(value)>0)))
      throw Error('This U1 job has explicit support/infill filament assignments. Remap those in a four-slot project before comparing.');
    const report=analyse(project,plateId,job.objects);
    if(report.counts.undecodable_paint)throw Error('Unknown paint prevents safe U1 filament compaction.');
    const used=[...new Set(report.used.map(id=>Number(options.mapping?.[id]??id)))].sort((a,b)=>a-b);
    if(used.length>4)throw Error('This U1 plate uses more than four physical filaments.');
    const physical=options.physical||options.reels;
    if(used.some(id=>!physical[id-1]))throw Error('A selected filament is missing from the output palette.');
    const mapping=Object.fromEntries(project.colors.map((_,i)=>[i+1,Math.max(1,used.indexOf(Number(options.mapping?.[i+1]??i+1))+1)]));
    options={...options,physical:used.map(id=>physical[id-1]),mapping};
  }
  if(job.sequence==='by object') {
    if(options.supportInterface||options.recipes?.length)throw Error('Sequential comparison is not available with support interfaces or blends.');
    const report=analyse(project,plateId,job.objects);
    for(const o of report.objects.filter(o=>o.selected)) {
      if(o.undecodable || new Set(o.colours.map(c=>options.mapping?.[c.extruder]??c.extruder)).size!==1)
        throw Error('Sequential candidates require decoded, single-filament objects.');
    }
  }
  const built=exportProject(project,plateId,job.objects,{...options,layout:job.layout});
  if(built.problems.length)throw Error(built.problems[0]);
  const config=JSON.parse(decode.decode(built.entries.get(SRC_BBL_PROJECT)));
  config.print_sequence=job.sequence;
  const changes=config.different_settings_to_system || [];
  changes[0]=[...new Set([...(changes[0]||'').split(';').filter(Boolean),'print_sequence'])].join(';');
  config.different_settings_to_system=changes;
  built.entries.set(SRC_BBL_PROJECT,encode.encode(JSON.stringify(config,null,2)));
  // Keep plate-specific overrides consistent with the project process.
  if(built.entries.has(SRC_BBL_MODEL)) {
    const xml=decode.decode(built.entries.get(SRC_BBL_MODEL)).replace(/<plate>([\s\S]*?)<\/plate>/g,(_,body)=>
      `<plate>${body.replace(/<metadata\s+key="print_sequence"\s+value="[^"]*"\s*\/>/g,'')}<metadata key="print_sequence" value="${job.sequence}"/></plate>`);
    built.entries.set(SRC_BBL_MODEL,encode.encode(xml));
  }
  return built;
}
