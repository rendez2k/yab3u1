import {norm} from './colour.js';
import {filamentIdentity,reelIdentity} from './filamentIdentity.js';

export const CATALOGUE_REVISION='2026-11-04.1';
const snap='https://www.snapmaker.com/blog/which-cmyk-filament-should-i-choose/';
const bambu='https://forum.bambulab.com/t/bambu-lab-h3c-our-full-reveal/261955';
const poly='https://shop.polymaker.com/products/translucent-pla';
const elegoo='https://eu.elegoo.com/products/pla-cmyk';
// These are display swatches, not measurements of printed mixtures. Missing
// manufacturer RGB values use nominal CMY; that provenance travels with exports.
const make=(brand,family,edition,names,colours,source,opticalClass='unknown',published=false)=>names.map((name,i)=>({
  productId:[brand,family,edition,name].join('/').toLowerCase().replace(/[^a-z0-9/]+/g,'-'),
  name:`${brand} ${name}`,brand,family,edition,type:'PLA',color:colours[i],opticalClass,
  catalogueRevision:CATALOGUE_REVISION,swatchSource:published?'manufacturer display colour':'nominal display colour',source,
}));
const cm=['Cyan','Magenta','Yellow'], nominal=['#00FFFF','#FF00FF','#FFFF00'];
const bundle=(id,name,brand,edition,kind,reels,source,note,application='model')=>({id,name,brand,edition,kind,reels:reels.map(r=>({...r,bundleId:id})),source,note,application,checked:'2026-11-04',calibration:'unmeasured'});
export const FILAMENT_BUNDLES=Object.freeze([
  bundle('bambu-palette-cmyw','PLA Palette · CMY + White','Bambu Lab','PLA Palette','curated',make('Bambu Lab','PLA Palette','2026', [...cm,'White'],[...nominal,'#FFFFFF'],bambu),bambu,'PLA Palette is supported by Bambu Studio 2.9.1. Select its official material preset in the slicer. Display colours are nominal; no measured YAB3D profile yet.'),
  bundle('bambu-palette-cmykw','PLA Palette · CMY + Key + White','Bambu Lab','PLA Palette','curated',make('Bambu Lab','PLA Palette','2026',[...cm,'Key','White'],[...nominal,'#000000','#FFFFFF'],bambu),bambu,'Five physical reels required. Key and White are separate products. This is a selected combination, not a claim about a retail pack.'),
  bundle('snapmaker-white','Full Spectrum · White Edition','Snapmaker','White Edition','retail',make('Snapmaker','PLA Full Spectrum','White Edition',[...cm,'White'],[...nominal,'#FFFFFF'],snap,'semi-translucent'),snap,'White Edition has reformulated CMY. Swapping the grey reel in Gray Edition does not recreate it. Manufacturer guidance: 0.4 mm nozzle or smaller, layers of 0.10 mm or less.'),
  bundle('snapmaker-gray','Full Spectrum · Gray Edition','Snapmaker','Gray Edition','retail',make('Snapmaker','PLA Full Spectrum','Gray Edition',[...cm,'Gray'],[...nominal,'#808080'],snap,'semi-translucent'),snap,'For muted colours. Its CMY formulation is distinct from White Edition. Nominal display swatches need printed calibration.'),
  bundle('polymaker-cmyg','Panchroma Translucent · CMY + Grey','Polymaker','Translucent','curated',make('Polymaker','Panchroma','Translucent',[...cm,'Grey'],['#08ABFB','#D93B90','#F9ED3D','#9199A4'],poly,'translucent',true),poly,'A combination of individual Panchroma Translucent products. Manufacturer display colours are not measured blends.'),
  bundle('elegoo-rilievo','Rilievo · CMY + White','ELEGOO','Rilievo CMYK','curated',make('ELEGOO','PLA CMYK','Rilievo',[...cm,'White'],[...nominal,'#FFFFFF'],elegoo,'translucent'),elegoo,'Marketed for colour lithophanes. Reflected-light model blends are unverified; not included in automatic model recommendations.','backlit'),
]);

export function validateBundle(value) {
  if(!value || typeof value.name!=='string' || !value.name.trim() || value.name.length>120 || !Array.isArray(value.reels) || value.reels.length<1 || value.reels.length>24)throw Error('A filament set needs a name and 1–24 reels.');
  const reels=value.reels.map(r=>{
    if(!r || !norm(r.color) || typeof r.type!=='string' || !/^[a-z0-9 +_-]{1,40}$/i.test(r.type))throw Error('Each reel needs a six-digit colour and material.');
    return {...filamentIdentity(r),name:String(r.name || r.productId || 'Custom reel').slice(0,120),color:norm(r.color),type:r.type.toUpperCase()};
  });
  return {id:typeof value.id==='string'?value.id.slice(0,120):'custom',name:value.name.trim(),kind:'custom',reels,calibration:'unmeasured',application:'model',note:'Custom set. Print and measure samples to calibrate its blends.'};
}
export function bundleFit(bundle,capacity,interfaceEnabled=false) {
  const available=capacity-(interfaceEnabled?1:0),required=bundle.reels.length;
  return {fits:required<=available,required,available,reason:required>available?`${required} model reels need ${required} inputs; ${available} available${interfaceEnabled?' after reserving PETG':''}. Choose a smaller set or increase printer capacity.`:''};
}
export function bundleReels(bundle,capacity,interfaceReel=null) {
  const fit=bundleFit(bundle,capacity,Boolean(interfaceReel));if(!fit.fits)throw Error(fit.reason);
  return [...bundle.reels.map(r=>({...r})),...(interfaceReel?[{...interfaceReel,role:'support-interface'}]:[])];
}
export function bundleOwned(bundle,stock=[]) {
  return bundle.reels.filter(r=>stock.some(s=>reelIdentity(r)===reelIdentity(s))).length;
}
