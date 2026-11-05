import {emptyBox,addBox,fillLayout,planLayout} from './layout.js';
import {recipeParts} from './blendRecipes.js';

export function outputTools(object, mapping={}, recipes=[]) {
  if(object.undecodable || !object.colours?.length)return null;
  const tools=new Set();
  for(const colour of object.colours) {
    const id=Number(mapping[colour.extruder] ?? colour.extruder);
    const mix=recipes.find(r=>r.id===id);
    if(mix){recipeParts(mix).forEach(p=>tools.add(p.slot));}else tools.add(id);
  }
  return [...tools].sort((a,b)=>a-b);
}

/** Prepare the visible objects: single-filament groups first, mixed parts last.
 * This deliberately does not score time or infer complete assembly sets. */
export function sequentialPlates(context) {
  const groups=new Map(),copies=Number(context.layout.copies||1);
  if(!Number.isInteger(copies)||copies<1)throw Error('Choose a valid plate copy count.');
  for(const o of context.objects){
    const count=(context.quantities[o.objectId]??1)*copies;if(count===0)continue;
    if(!Number.isInteger(count)||count<0||count>64)throw Error('Sequential preparation supports 1–64 copies of each object per plate.');
    const tools=outputTools(o,context.mapping,context.recipes);
    const key=tools?.length===1&&!context.options.supportInterface?tools[0]:'multi';
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...o,count});
  }
  if(!groups.size)throw Error('Keep at least one object on the plate.');
  const singles=[...groups].filter(([key])=>key!=='multi').sort(([a],[b])=>a-b);
  const batches=[];
  if(singles.length)batches.push({key:'single',rows:singles.flatMap(([,rows])=>rows),mergeGroups:singles.map(([filament,rows])=>({
    label:`Filament ${filament} group`,objects:rows.map(o=>String(o.objectId))}))});
  if(groups.has('multi'))batches.push({key:'multi',rows:groups.get('multi')});
  return batches.map(({key,rows,mergeGroups},index)=>{
    const quantities=Object.fromEntries(rows.map(o=>[o.objectId,o.count]));
    const extraSupport=Boolean(context.options.supportInterface);
    const sequence=key!=='multi'?'by object':'by layer';
    const layout={...context.layout,arrangement:'objects',copies:1,quantities,footprints:rows,colourGroups:mergeGroups};
    const box=emptyBox();rows.forEach(o=>addBox(box,o.bounds));
    const plan=planLayout(box,layout);
    if(plan.blocked||plan.capped)throw Error(`${key==='multi'?'The by-layer parts':'The separated colour groups'} do not fit one plate. Reduce their quantity before preparing plates.`);
    return {id:`plate-${index+1}`,objects:rows.map(o=>o.objectId),names:rows.map(o=>o.name),
      label:key==='multi'?'By-layer parts':'Merged colour groups',
      count:rows.reduce((n,o)=>n+o.count*(o.instances||1),0),sequence,quantities,layout,extraSupport,mergeGroups};
  });
}

/** Compare fixed quantities and quality. Packing is a bounded heuristic; time
 * ranking is deliberately impossible until every required slice has evidence. */
export function buildStrategies(context, {objective='order',sets=1,turnaround=10,parallel=false,sequential=false}={}) {
  if(!['order','rate'].includes(objective))throw Error('Choose an optimisation objective.');
  if(!Number.isInteger(sets)||sets<1||sets>1000)throw Error('Choose 1–1000 complete sets.');
  if(!Number.isFinite(turnaround)||turnaround<0||turnaround>1440)throw Error('Choose 0–1440 minutes for plate changes.');
  const objects=context.objects.filter(o=>(context.quantities[o.objectId]??1)>0);
  if(!objects.length)throw Error('Keep at least one object in the set.');
  for(const object of objects) {
    const n=context.quantities[object.objectId]??1;
    if(!Number.isInteger(n)||n<1||n>64)throw Error('Use whole object quantities from 0–64.');
  }
  const groups=new Map();
  for(const o of objects) {
    const tools=outputTools(o,context.mapping,context.recipes);
    const key=tools?.length===1 ? `tool-${tools[0]}` : 'multi';
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(o);
  }
  const specs=[{id:'mixed-one',label:'Together · one set per plate',groups:[['all',objects]],fill:false},
    {id:'mixed-batch',label:'Together · batch the sets',groups:[['all',objects]],fill:true}];
  if(groups.size>1) specs.push({id:'split',label:'Separate single-colour parts',groups:[...groups],fill:true});
  if(parallel && groups.size>1)specs.push({id:'parallel',label:'Single-colour parts on printer 2',groups:[...groups],fill:true,parallel:true});
  if(sequential && [...groups.keys()].some(k=>k!=='multi'))specs.push({id:'sequential',label:'Sequential singles, layered multicolour',groups:[...groups],fill:true,sequential:true});
  const jobs=[], strategies=[];
  const addJob=(rows,machine,batch,sequence,capacity)=>{
    const quantities=Object.fromEntries(rows.map(o=>[o.objectId,context.quantities[o.objectId]??1]));
    const key=JSON.stringify([rows.map(o=>o.objectId),machine,batch,sequence,quantities]);
    let job=jobs.find(j=>j.key===key);
    if(!job){
      const config=machine===1?context.secondary:context.primary;
      job={id:`job-${jobs.length+1}`,key,objects:rows.map(o=>o.objectId),names:rows.map(o=>o.name),machine,batch,sequence,capacity,
        target:config.target,quantities,layout:{...config.layout,arrangement:'objects',copies:batch,quantities,footprints:rows}};
      jobs.push(job);
    }
    return job;
  };
  for(const spec of specs) {
    const runs=[],capacities=[];let blocked='';
    const prepared=[];
    for(const [key,rows] of spec.groups) {
      const machine=spec.parallel&&key!=='multi'?1:0;
      const config=machine===1?context.secondary:context.primary;
      if(!config){blocked='Configure the second printer.';break;}
      if(config.problem){blocked=config.problem;break;}
      const tools=new Set(rows.flatMap(o=>outputTools(o,context.mapping,context.recipes)||[]));
      if(config.maxPhysical && tools.size>config.maxPhysical){blocked=`This plate uses ${tools.size} physical filaments; printer ${machine+1} has ${config.maxPhysical} inputs. Split the colours or apply a compatible palette.`;break;}
      const quantities=Object.fromEntries(rows.map(o=>[o.objectId,context.quantities[o.objectId]??1]));
      const box=emptyBox();rows.forEach(o=>addBox(box,o.bounds));
      const layout={...config.layout,arrangement:'objects',copies:1,quantities,footprints:rows};
      const sequence=spec.sequential&&key!=='multi'?'by object':'by layer';
      // Leave sequential arrangement to the slicer; a dense layered fill is
      // not a useful starting point for its much larger clearance envelopes.
      const fit=spec.fill&&sequence==='by layer'?fillLayout(box,layout):{copies:planLayout(box,layout).blocked?0:1};
      if(!fit.copies){blocked=`${rows.map(o=>o.name).join(', ')}: one set does not fit. Reduce its quantities or adjust the layout.`;break;}
      if(sequence==='by object' && context.additionalMaterials){blocked='Sequential candidates are unavailable with blends or additional support filaments. Compare layered and split plates.';break;}
      capacities.push(fit.copies);prepared.push({rows,machine,capacity:fit.copies,sequence});
    }
    // Production-rate comparisons each produce a complete, balanced cycle.
    // Order comparisons produce exactly the requested number, including tails.
    const outputSets=objective==='rate'?Math.min(...capacities,64):sets;
    if(!blocked)for(const part of prepared) {
      const full=Math.floor(outputSets/part.capacity),tail=outputSets%part.capacity;
      if(full)runs.push({jobId:addJob(part.rows,part.machine,part.capacity,part.sequence,part.capacity).id,count:full});
      if(tail)runs.push({jobId:addJob(part.rows,part.machine,tail,part.sequence,part.capacity).id,count:1});
    }
    strategies.push({id:spec.id,label:spec.label,outputSets:Number.isFinite(outputSets)?outputSets:0,runs,blocked,
      sequential:Boolean(spec.sequential),parallel:Boolean(spec.parallel)});
  }
  return {schema:'yab3d-comparison-v1',objective,requestedSets:sets,turnaround,strategies,jobs};
}

export function rankStrategies(comparison, timings={}) {
  const ranked=comparison.strategies.map(strategy=>{
    if(strategy.blocked)return {...strategy,status:strategy.blocked,seconds:null};
    const lanes=[{seconds:0,plates:0},{seconds:0,plates:0}];let changes=0,knownChanges=true,manual=false;
    for(const run of strategy.runs) {
      const job=comparison.jobs.find(j=>j.id===run.jobId),timing=timings[job.id];
      if(!timing||!Number.isFinite(timing.seconds)||timing.seconds<=0||timing.error)return {...strategy,status:timing?.error||'Awaiting slice timings',seconds:null};
      if(job.sequence==='by object'&&!timing.clearanceChecked)return {...strategy,status:'Sequential clearance still needs a successful slicer check',seconds:null};
      const lane=lanes[job.machine];lane.seconds+=timing.seconds*run.count;lane.plates+=run.count;
      if(Number.isInteger(timing.toolChanges)&&timing.toolChanges>=0)changes+=timing.toolChanges*run.count;else knownChanges=false;
      manual ||= timing.source==='manual';
    }
    const turnaround=comparison.turnaround*60;
    const seconds=Math.max(...lanes.map(l=>l.seconds+Math.max(0,l.plates-1)*turnaround));
    // A repeating production cycle includes the last-to-first plate change.
    const cycleSeconds=Math.max(...lanes.map(l=>l.seconds+l.plates*turnaround));
    return {...strategy,seconds,cycleSeconds,setsPerHour:strategy.outputSets*3600/cycleSeconds,
      plates:lanes.reduce((n,l)=>n+l.plates,0),toolChanges:knownChanges?changes:null,
      status:manual?'Includes manually entered slicer estimates':'Slicer estimates',lanes};
  });
  ranked.sort((a,b)=>a.seconds===null?(b.seconds===null?0:1):b.seconds===null?-1:
    comparison.objective==='rate'?b.setsPerHour-a.setsPerHour:a.seconds-b.seconds);
  return ranked;
}

export function durationSeconds(text) {
  const value=String(text).trim();
  if(/^\d+(?:\.\d+)?$/.test(value))return Number(value);
  let seconds=0,found=false;
  for(const m of value.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) {
    seconds+=Number(m[1])*({d:86400,h:3600,m:60,s:1}[m[2].toLowerCase()]);found=true;
  }
  return found&&seconds>0?seconds:null;
}

/** Header/footer metadata only; never simulate proprietary tool-change macros. */
export function readTiming(text) {
  const total=[...text.matchAll(/(?:^\s*;\s*|;\s*)(?:total estimated time|estimated printing time(?:\s*\(normal mode\))?)\s*[:=]\s*([^;\r\n]+)/gim)].at(-1);
  const seconds=total?durationSeconds(total[1]):null;
  if(!seconds)throw Error('No recognised total printing time found. Enter the slicer’s total time in minutes.');
  const changes=/^\s*;\s*(?:total filament change|filament change times|total toolchanges)\s*[:=]\s*(\d+)/im.exec(text);
  return {seconds,toolChanges:changes?Number(changes[1]):null,source:'slicer'};
}

export function validateReport(report,pack) {
  if(report?.schema!=='yab3d-timings-v1'||report.packId!==pack.packId||!Array.isArray(report.jobs))throw Error('This report belongs to a different comparison pack.');
  const result={};
  for(const row of report.jobs) {
    const job=pack.jobs.find(j=>j.id===row.id);
    if(!job||row.sha256!==job.sha256||result[row.id])throw Error('The report has an unknown, changed or duplicate job.');
    if(row.error){result[row.id]={error:String(row.error).slice(0,500)};continue;}
    if(!Number.isFinite(row.seconds)||row.seconds<=0||row.seconds>366*86400)throw Error('The report contains an invalid duration.');
    if(row.toolChanges!=null&&(!Number.isInteger(row.toolChanges)||row.toolChanges<0))throw Error('The report contains an invalid tool-change count.');
    result[row.id]={seconds:row.seconds,toolChanges:row.toolChanges??null,source:'slicer',clearanceChecked:row.clearanceChecked===true};
  }
  return result;
}
