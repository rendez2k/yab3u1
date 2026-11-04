// Product identity is independent of the colour displayed on screen.
// Never treat two manufacturers' cyan reels as the same calibration material.
import {norm} from './colour.js';
const fields=['productId','brand','family','edition','sku','catalogueRevision','bundleId','opticalClass','swatchSource'];
export function filamentIdentity(reel={}) {
  return Object.fromEntries(fields.flatMap(key=>typeof reel[key]==='string' && reel[key].length<=180 ? [[key,reel[key]]] : []));
}
export function reelIdentity(reel={}) {
  return [reel.productId || reel.stockId || reel.name || 'unnamed',reel.edition || '',String(reel.type || 'PLA').toUpperCase(),norm(reel.color)].join('|');
}
export function substituteReel(reel,changes) {
  const next={...reel,...changes};
  // A manually changed swatch or material is now a custom reel, not that SKU.
  for(const key of [...fields,'profile','name']) delete next[key];
  return next;
}
