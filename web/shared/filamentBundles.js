import {norm} from './colour.js';
import {filamentIdentity,reelIdentity} from './filamentIdentity.js';

export const CATALOGUE_REVISION='2026-11-05.1';
const snap='https://www.snapmaker.com/blog/which-cmyk-filament-should-i-choose/';
const bambu='https://uk.store.bambulab.com/products/pla-palette-cmykw';
export const BAMBU_PALETTE_SWATCH_SOURCE='https://store.bblcdn.com/s7/default/8a89cc11c9ce4421a9593f9ee9580982/Bambu_PLA_Palette_Hex_Code.pdf';
const poly='https://shop.polymaker.com/products/translucent-pla';
const elegoo='https://eu.elegoo.com/products/pla-cmyk';
const esun='https://www.amazon.co.uk/dp/B0CV7GD5YB';
// These are display swatches, not measurements of printed mixtures. Missing
// manufacturer RGB values use nominal CMY; that provenance travels with exports.
const make=(brand,family,edition,names,colours,source,opticalClass='unknown',published=false)=>names.map((name,i)=>({
  productId:[brand,family,edition,name].join('/').toLowerCase().replace(/[^a-z0-9/]+/g,'-'),
  name:`${brand} ${name}`,brand,family,edition,type:'PLA',color:colours[i],opticalClass,
  catalogueRevision:CATALOGUE_REVISION,swatchSource:published?'manufacturer display colour':'nominal display colour',source,
}));
// Where a maker publishes no RGB values, these stand in. They are estimates of typical
// cyan, magenta and yellow filament, not the pure screen primaries: a pure cyan is so
// light that a slicer matching reels by colour pairs it with a white slot, and blends
// predicted from pure primaries come out far more vivid than any print.
const cm=['Cyan','Magenta','Yellow'], nominal=['#0086D6','#D9308A','#F7E400'];
const bundle=(id,name,brand,edition,kind,reels,source,note,application='model')=>({id,name,brand,edition,kind,reels:reels.map(r=>({...r,bundleId:id})),source,note,application,checked:'2026-11-04',calibration:'unmeasured'});
const bambuReels=make('Bambu Lab','PLA Palette','2026',[...cm,'Key','White'],['#0090DA','#E24585','#FCE300','#000000','#FFFFFF'],bambu,'opaque',true)
  .map(r=>({...r,opticalClass:r.name==='Bambu Lab Key'?'translucent':'opaque'}));
export const FILAMENT_BUNDLES=Object.freeze([
  bundle('bambu-palette-cmykw','PLA Palette · CMYKW','Bambu Lab','PLA Palette','retail',bambuReels,bambu,'Five 1 kg reels in the official pack. CMYW is opaque; Key (black) is translucent. Official display swatches; YAB3D blends are unmeasured.'),
  bundle('bambu-palette-cmyw','PLA Palette · CMY + White','Bambu Lab','PLA Palette','curated',bambuReels.filter(r=>r.name!=='Bambu Lab Key'),bambu,'Four-reel subset of the five-reel CMYKW pack. Leaves out Key (black). Official display swatches; YAB3D blends are unmeasured.'),
  bundle('bambu-palette-cmyk','PLA Palette · CMY + Key','Bambu Lab','PLA Palette','curated',bambuReels.filter(r=>r.name!=='Bambu Lab White'),bambu,'Four-reel subset of the five-reel CMYKW pack. Leaves out White. Key (black) is translucent. Official display swatches; YAB3D blends are unmeasured.'),
  bundle('snapmaker-white','Full Spectrum · White Edition','Snapmaker','White Edition','retail',make('Snapmaker','PLA Full Spectrum','White Edition',[...cm,'White'],[...nominal,'#FFFFFF'],snap,'semi-translucent'),snap,'White Edition has reformulated CMY. Swapping the grey reel in Gray Edition does not recreate it. Manufacturer guidance: 0.4 mm nozzle or smaller, layers of 0.10 mm or less.'),
  bundle('snapmaker-gray','Full Spectrum · Gray Edition','Snapmaker','Gray Edition','retail',make('Snapmaker','PLA Full Spectrum','Gray Edition',[...cm,'Gray'],[...nominal,'#808080'],snap,'semi-translucent'),snap,'For muted colours. Its CMY formulation is distinct from White Edition. Nominal display swatches need printed calibration.'),
  bundle('polymaker-cmyg','Panchroma Translucent · CMY + Grey','Polymaker','Translucent','curated',make('Polymaker','Panchroma','Translucent',[...cm,'Grey'],['#08ABFB','#D93B90','#F9ED3D','#9199A4'],poly,'translucent',true),poly,'A combination of individual Panchroma Translucent products. Manufacturer display colours are not measured blends.'),
  {...bundle('elegoo-rilievo','Rilievo PLA CMYK · 4 × 1 kg','ELEGOO','Rilievo CMYK','retail',make('ELEGOO','PLA CMYK','Rilievo',[...cm,'White'],[...nominal,'#FFFFFF'],elegoo,'translucent'),'https://www.amazon.co.uk/dp/B0GZVPJMB2','Cyan, magenta, yellow and white (no black). Sold for colour lithophanes; reflected-light model blends are unmeasured.','backlit'),checked:'2026-11-05'},
  {...bundle('esun-pla-plus-cmyk','PLA+ CMYK · 4 × 1 kg','eSUN','Lithophane CMYK','retail',make('eSUN','PLA+','Lithophane CMYK',[...cm,'White'],[...nominal,'#FFFFFF'],esun),esun,'Cyan, magenta, yellow and white (no black). Sold for colour lithophanes; nominal display swatches, not measured model blends. Use the appropriate PLA+ filament profile in your slicer.','backlit'),checked:'2026-11-05'},
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
  return {fits:required<=available,required,available,reason:required>available?`${required} model reels need ${required} inputs; ${available} available${interfaceEnabled?' after reserving PETG':''}. ${interfaceEnabled?'Choose fewer model reels, or turn off PETG support to use all four.':'Choose a smaller set or increase printer capacity.'}`:''};
}
export function bundleReels(bundle,capacity,interfaceReel=null) {
  const fit=bundleFit(bundle,capacity,Boolean(interfaceReel));if(!fit.fits)throw Error(fit.reason);
  return [...bundle.reels.map(r=>({...r})),...(interfaceReel?[{...interfaceReel,role:'support-interface'}]:[])];
}
export function bundleOwned(bundle,stock=[]) {
  return bundle.reels.filter(r=>stock.some(s=>reelIdentity(r)===reelIdentity(s))).length;
}

/** A draft subset never mutates the retail pack or the applied reel assignment. */
export function selectBundleReels(bundle,indices) {
  if(!bundle?.reels?.length || !Array.isArray(indices) || !indices.length || indices.some(i=>!Number.isInteger(i)||i<0||i>=bundle.reels.length) || new Set(indices).size!==indices.length)
    throw Error('Select at least one reel from this set.');
  const selected=new Set(indices), omitted=bundle.reels.filter((_,i)=>!selected.has(i));
  const reels=bundle.reels.filter((_,i)=>selected.has(i)).map(r=>({...r}));
  const short=r=>r.brand&&r.name.startsWith(r.brand+' ')?r.name.slice(r.brand.length+1):r.name;
  return {...bundle,reels,parentBundleId:bundle.parentBundleId||bundle.id,
    id:omitted.length?`${bundle.id}:reels:${[...indices].sort((a,b)=>a-b).join('-')}`:bundle.id,
    name:omitted.length?`${bundle.name} · without ${omitted.map(short).join(', ')}`:bundle.name,
    omittedReels:[...(bundle.omittedReels||[]),...omitted].map(r=>({...r})),
    kind:omitted.length?'subset':bundle.kind};
}

/** Exhaustive only for small sets. Large collections need an explicit selection. */
export function smallerBundleOptions(bundle,count) {
  if(!Number.isInteger(count)||count<1||count>bundle.reels.length)throw Error('Choose a valid number of model inputs.');
  if(count===bundle.reels.length)return [selectBundleReels(bundle,bundle.reels.map((_,i)=>i))];
  let combinations=1;
  for(let i=1;i<=Math.min(count,bundle.reels.length-count);i++)combinations=combinations*(bundle.reels.length-i+1)/i;
  if(combinations>64)throw Error('Too many combinations. Select fewer reels first, then compare again.');
  const result=[],chosen=[];
  const visit=start=>{
    if(chosen.length===count){result.push(selectBundleReels(bundle,chosen));return;}
    for(let i=start;i<=bundle.reels.length-(count-chosen.length);i++){chosen.push(i);visit(i+1);chosen.pop();}
  };
  visit(0);return result;
}

export function compatibleBundleOptions(bundles,capacity,supportInterface=false) {
  const count=capacity-(supportInterface?1:0), unique=new Map();
  if(count<1)return [];
  for(const b of bundles.filter(b=>b.application!=='backlit')) {
    let candidates=[];
    try{candidates=smallerBundleOptions(b,Math.min(count,b.reels.length));}catch{continue;}
    for(const candidate of candidates){const key=candidate.reels.map(reelIdentity).sort().join(';');if(!unique.has(key))unique.set(key,candidate);}
  }
  return [...unique.values()];
}
