/** Paint on retained objects, plus conservative support/custom-code references. */
export function selectionUsage(footprints,quantities,original,count) {
  if(!footprints?.length||!original||original.uncertain)return original;
  const retained=footprints.filter(o=>(quantities?.[o.objectId]??1)>0);
  if(retained.some(o=>o.undecodable||!o.colours?.length))return original;
  const used=new Set(retained.flatMap(o=>o.colours.map(c=>Number(c.extruder))));
  for(let i=1;i<=original.reservedThrough;i++)used.add(i);
  const all=Array.from({length:count},(_,i)=>i+1);
  return {...original,kept:all.filter(i=>used.has(i)),unused:all.filter(i=>!used.has(i))};
}
