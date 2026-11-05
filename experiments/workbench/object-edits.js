// Flatten the set multiplier once so an individual edit never changes siblings.
export function editCopies(state,id,amount) {
  if(!state.objects.some(o=>String(o.objectId)===String(id)))throw Error('Select an object first.');
  if(!Number.isInteger(amount)||!Number.isInteger(state.copies)||state.copies<1)throw Error('Use a whole number of copies.');
  const quantities=Object.fromEntries(state.objects.map(o=>[o.objectId,(state.quantities[o.objectId]??1)*state.copies]));
  quantities[id]+=amount;
  if(Object.values(quantities).some(n=>!Number.isInteger(n)||n<0||n>64))throw Error('Choose quantities between 0 and 64 per object.');
  return {quantities,copies:1,arrangement:'objects'};
}

export function editSelection(state,selection,amount){
  const quantities=Object.fromEntries(state.objects.map(o=>[o.objectId,(state.quantities[o.objectId]??1)*state.copies]));
  if(!selection.length)throw Error('Select one or more objects first.');
  for(const id of selection){if(!(id in quantities))throw Error('This selection is no longer on the plate.');quantities[id]+=amount;}
  if(Object.values(quantities).some(n=>!Number.isInteger(n)||n<0||n>64))throw Error('Choose quantities between 0 and 64 per object.');
  return {quantities,copies:1,arrangement:'objects'};
}

export function arrangeObjects(state,planLayout) {
  if(!state.bounds||!state.layout?.footprints?.length)throw Error('Wait for the object sizes to finish loading.');
  const patch={copies:state.copies,quantities:{...state.quantities},arrangement:'objects'};
  const plan=planLayout(state.bounds,{...state.layout,...patch,capacityLimit:state.copies});
  if(plan.blocked||plan.capped)throw Error('These quantities do not fit with the current spacing and reserved areas. Reduce copies or spacing, or choose a larger printer. Nothing has been removed.');
  return {patch,plan};
}

export async function fillObject(state,id,planLayout,yieldTurn=()=>Promise.resolve()) {
  const base=editCopies(state,id,0),current=base.quantities[id];
  if(!state.bounds||!state.layout?.footprints?.length)throw Error('Wait for the object sizes to finish loading.');
  // Search all larger counts: greedy packing is not guaranteed to be monotonic.
  // Existing tower, hardware, support and bed allowances travel into each plan.
  for(let count=64;count>current;count--) {
    await yieldTurn(count);
    const next={...base,quantities:{...base.quantities,[id]:count}};
    const plan=planLayout(state.bounds,{...state.layout,...next,capacityLimit:1});
    if(!plan.blocked&&!plan.capped)return {patch:next,added:count-current,limit:count===64};
  }
  return {patch:null,added:0,limit:current===64};
}
