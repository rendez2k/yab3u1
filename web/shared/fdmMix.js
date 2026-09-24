// Layer-interleaved optical prediction, calibrated upstream on Prusament PLA.
// Other filaments and printer settings remain uncalibrated estimates.
import { mixFilaments } from './vendor/prusa-fdm/prusa-fdm-mixer.js';
import { norm } from './colour.js';
import { hexToLab } from './vendor/prusa-fdm/color.js';
import { deltaE2000 } from './vendor/prusa-fdm/delta-e.js';

export function approximateDistance(first,second) {
  const lab=value=>Array.isArray(value) ? {L:value[0],a:value[1],b:value[2]} : hexToLab(value);
  return deltaE2000(lab(first),lab(second));
}

export const FDM_MODEL = 'prusa-fdm-v7';
export function mixFdmHex(first, second, percent) {
  const a=norm(first), b=norm(second);
  if(!a || !b || !Number.isFinite(percent) || percent<0 || percent>100) return '';
  if(a===b || percent===0) return a;
  if(percent===100) return b;
  return mixFilaments([{hex:a,ratio:1-percent/100},{hex:b,ratio:percent/100}]).hex.toUpperCase();
}
