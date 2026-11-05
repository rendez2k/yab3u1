import {filamentIdentity} from './filamentIdentity.js';
import {norm} from './colour.js';
import {validateCalibration} from './blendCalibration.js';
import {validateRecipe,recipeData} from './blendRecipes.js';
export const EXPORT_PLAN_PATH='Metadata/YAB3D_colour_plan.json';
/** Portable provenance, never printer commands. It cannot authorise calibration. */
export function colourExportPlan({target,reels,recipes=[],mapping={},layerHeight=null,subdivideMixLayer=false,supportInterface=false,calibration=null}) {
  if(!['snapmaker','bambu','orca','prusa'].includes(target)||!Array.isArray(reels)||!reels.length||reels.length>24||!Array.isArray(recipes)||recipes.length>24)throw Error('Invalid colour plan.');
  const physical=reels.map(r=>{
    if(!norm(r.color))throw Error('Invalid colour plan reel.');
    return {...filamentIdentity(r),color:norm(r.color),type:String(r.type||'PLA').slice(0,40),name:String(r.name||'').slice(0,120),...(r.role==='support-interface'?{role:r.role}:{})};
  });
  const blends=recipes.map(r=>{
    validateRecipe(r,reels.length,target);
    return {...recipeData(r),model:String(r.model||'').slice(0,80)};
  });
  const map=Object.fromEntries(Object.entries(mapping).slice(0,256).filter(([k,v])=>/^\d+$/.test(k)&&Number.isInteger(v)&&v>0&&v<=reels.length+blends.length));
  const layer=layerHeight && ['custom','preset','preserve'].includes(layerHeight.mode)?{mode:layerHeight.mode,...(layerHeight.mode==='custom'?{value:String(layerHeight.value).slice(0,12)}:{})}:null;
  return {version:1,target,reels:physical,recipes:blends,mapping:map,layerHeight:layer,subdivideMixLayer:Boolean(subdivideMixLayer),supportInterface:Boolean(supportInterface),calibration:calibration?validateCalibration(calibration):null};
}
export function readColourExportPlan(bytes) {
  if(!bytes||bytes.length>131072)return null;
  try{const raw=JSON.parse(new TextDecoder().decode(bytes));return raw.version===1?colourExportPlan(raw):null;}catch{return null;}
}
