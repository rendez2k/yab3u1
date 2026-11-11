// Editable recipes. Ratios describe native slicer layers, not validated optics.
import {norm} from './colour.js';
import {FDM_MODEL, mixFdmHex} from './fdmMix.js';
import {mixFilaments} from './vendor/prusa-fdm/prusa-fdm-mixer.js';

export const blendCapabilities = target => ({third:['bambu','orca','snapmaker'].includes(target), gradient:target==='orca'});
export function recipeParts(r) {
  return [{slot:r.a,percent:100-r.percent-(r.c ? r.percentC : 0)},
    {slot:r.b,percent:r.percent},...(r.c ? [{slot:r.c,percent:r.percentC}] : [])];
}
export function validateRecipe(r, physical, target) {
  const parts=recipeParts(r), slots=parts.map(p=>p.slot);
  if(parts.some(p=>!Number.isInteger(p.slot)||p.slot<1||p.slot>physical)||new Set(slots).size!==slots.length)
    throw Error('Choose different physical filaments for each ingredient.');
  if(parts.some(p=>!Number.isInteger(p.percent)||p.percent<1||p.percent>99))
    throw Error('Use whole percentages above zero that add up to 100%.');
  if(r.c && target && !blendCapabilities(target).third)
    throw Error('Three-filament blends are not available for this output. Use two filaments.');
  if(r.gradient) {
    if(target && !blendCapabilities(target).gradient)throw Error('Gradients need OrcaSlicer 2.5 output. Choose that format or remove the gradient.');
    if(r.c)throw Error('A gradient uses two filaments. Remove the third ingredient first.');
    const {start,end,curve,perPart}=r.gradient;
    if(![start,end].every(p=>Number.isInteger(p)&&p>=10&&p<=90)||start===end)
      throw Error('Choose different bottom and top shares between 10% and 90%.');
    if(!['linear','smooth'].includes(curve)||typeof perPart!=='boolean')throw Error('Choose a supported gradient curve and part setting.');
  }
  return r;
}
export function gradientShare(r, t) {
  const g=r.gradient;
  if(!g)return 100-r.percent;
  const progress=g.curve==='smooth' ? t*t*(3-2*t) : t;
  return g.start+(g.end-g.start)*progress;
}
export function recipeColour(r, colours, t=.5) {
  if(r.gradient)return mixFdmHex(colours[r.a-1],colours[r.b-1],100-gradientShare(r,t));
  if(!r.c)return mixFdmHex(colours[r.a-1],colours[r.b-1],r.percent);
  return mixFilaments(recipeParts(r).map(p=>({hex:norm(colours[p.slot-1]),ratio:p.percent/100}))).hex.toUpperCase();
}
export function recipeLabel(r) {
  return r.gradient ? `Slot ${r.a}: ${r.gradient.start}% at bottom → ${r.gradient.end}% at top · slot ${r.b}: remainder`
    : recipeParts(r).map(p=>`${p.percent}% slot ${p.slot}`).join(' + ');
}
export function recipeData(r) {
  return {a:r.a,b:r.b,percent:r.percent,model:r.model||FDM_MODEL,
    ...(r.c?{c:r.c,percentC:r.percentC}:{}),...(r.gradient?{gradient:{...r.gradient}}:{}),
    ...(!r.c&&!r.gradient&&norm(r.measuredColor)?{measuredColor:norm(r.measuredColor)}:{})};
}
export function gradientCurve(r) {
  if(!r.gradient)return '';
  const {start,end,curve}=r.gradient;
  // Orca 2.5's Hermite endpoint slopes: zero gives smoothstep; linear uses range.
  return curve==='smooth'?`0,${start/100},0,0|1,${end/100},0,0`:'';
}
export function applyManualRecipes(base, edits, reels, target, limit) {
  const kept=[...base.kept], mapping={...base.mapping};
  for(const [source,r]of Object.entries(edits||{})) {
    if(!(source in mapping))continue;
    validateRecipe(r,reels.length,target);
    const parts=recipeParts(r), type=String(reels[r.a-1]?.type||'PLA').toUpperCase();
    if(parts.some(p=>reels[p.slot-1]?.role==='support-interface'||String(reels[p.slot-1]?.type||'PLA').toUpperCase()!==type))
      throw Error('Blend ingredients must use the same material. Reserved support filament cannot be mixed.');
    const recipe={...recipeData(r),manual:true,color:recipeColour(r,reels.map(r=>r.color))};
    // Identical manual recipes share a virtual slot, independently of source order.
    let index=kept.findIndex(k=>JSON.stringify(recipeData(k))===JSON.stringify(recipeData(recipe)));
    if(index<0){index=kept.length;kept.push(recipe);}
    mapping[source]=reels.length+index+1;
  }
  const used=new Set(Object.values(mapping)), remap=new Map(), compact=[];
  kept.forEach((r,i)=>{const id=reels.length+i+1;if(used.has(id)){remap.set(id,reels.length+compact.length+1);compact.push(r);}});
  for(const key of Object.keys(mapping))if(remap.has(mapping[key]))mapping[key]=remap.get(mapping[key]);
  if(reels.length+compact.length>limit)throw Error(`These blends exceed this format's ${limit} colour slots. Reuse a recipe or remove a blend.`);
  return {...base,mapping,kept:compact,recipes:compact.map(recipeData)};
}
