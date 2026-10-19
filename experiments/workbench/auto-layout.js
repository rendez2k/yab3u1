import {planLayout} from '../../web/shared/layout.js';

// Spectrum's assessment starts measurement asynchronously. Await the new
// revision's measured footprints before planning, without blocking the UI.
export async function waitForMeasuredState(getState,{timeout=60000,yieldTurn=()=>new Promise(resolve=>setTimeout(resolve,40))}={}){
  const key=getState().key,start=Date.now();
  for(;;){
    const state=getState();
    if(state.key!==key)throw Error('The model changed while its parts were being measured. Try filling again.');
    if(!state.busy&&state.bounds&&state.layout?.footprints?.length)return state;
    if(Date.now()-start>=timeout)throw Error('The new parts could not be measured in time. The separation is kept; try filling from Arrange.');
    await yieldTurn();
  }
}

/** Add complete sets of the chosen pieces, keeping every other quantity fixed.
 * Test explicit counts because packing is a heuristic, not a monotonic formula. */
export async function fitCompleteSets(context,ids,validate,yieldTurn=async()=>{}){
  const quantities=Object.fromEntries(context.objects.map(o=>[String(o.objectId),(context.quantities[o.objectId]??1)*Number(context.copies??context.layout.copies??1)]));
  const weights={};for(const id of ids){if(!(id in quantities)||quantities[id]<1)throw Error('The separated pieces are no longer on this plate.');weights[id]=(weights[id]||0)+1;}
  if(!ids.length)throw Error('Choose at least one piece to duplicate.');
  if(Object.values(quantities).some(n=>!Number.isInteger(n)||n<0||n>64))throw Error('Use whole quantities from 0 to 64 before filling.');
  const limit=Math.min(...Object.entries(weights).map(([id,n])=>1+Math.floor((64-quantities[id])/n)));
  let lastError;
  for(let sets=limit;sets>=1;sets--){
    await yieldTurn(sets);
    const next={...quantities};for(const [id,n]of Object.entries(weights))next[id]+=n*(sets-1);
    try{const result=validate({...context,quantities:next,layout:{...context.layout,footprints:context.layout.footprints||context.objects,copies:1,quantities:next,capacityLimit:1,arrangement:'objects'}});return {sets,quantities:next,result,limit:sets===limit};}catch(error){lastError=error;}
  }
  throw lastError||Error('Even one complete set does not fit. Reduce spacing or use a larger plate.');
}

export function fitOnOnePlate(context){
  if(!context.bounds)throw Error('Wait for the parts to finish being measured before filling.');
  const plan=planLayout(context.bounds,context.layout);
  if(plan.blocked||plan.capped)throw Error('One complete set does not fit on this plate. Try separate colour plates or a larger printer.');
  return plan;
}
