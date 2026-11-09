export function noSplitReason(reports=[]){
  const repair=reports.find(r=>r.needsRepair)?.retained?.find(r=>!r.informational)?.reason;
  if(repair)return repair;
  const blocking=reports.flatMap(r=>r.retained||[]).find(r=>!r.informational)?.reason;
  return blocking||'No suitable join was found for larger parts. Use Plane cut or Draw boundary to choose where to separate the model.';
}
