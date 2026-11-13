import {norm} from './colour.js';
import {mixFdmHex} from './fdmMix.js';
import {filamentIdentity,reelIdentity} from './filamentIdentity.js';

export const CALIBRATION_KEY = 'yab3d-blend-calibration-v1';
const material = r => String(r.type || 'PLA').trim().toUpperCase();
const reelKey = reelIdentity;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function sampleKey(first, second, percent) {
  const a = reelKey(first), b = reelKey(second);
  return a < b ? `${a}|${b}|${percent}` : `${b}|${a}|${100-percent}`;
}

/** Strict, bounded portable data. Importing never enables a profile. */
export function validateCalibration(value) {
  if (!value || ![1,2].includes(value.version) || !text(value.name,120) || !text(value.setup,500)
      || !text(value.context,20000) || !Array.isArray(value.reels) || value.reels.length<2 || value.reels.length>24
      || (value.version===1 && value.reels.length!==4)
      || (value.version===2 && !['wall','top'].includes(value.surface))
      || !Array.isArray(value.samples) || value.samples.length > 828) throw Error('Choose a YAB3D calibration JSON with 2–24 named reels and a measured surface.');
  const reels = value.reels.map(r => {
    if (!r || !norm(r.color) || !text(r.type,40) || !text(r.name,120)) throw Error('Each calibration reel needs its colour, material and brand/reel name.');
    return {...filamentIdentity(r),color:norm(r.color),type:material(r),name:r.name.trim()};
  });
  if (new Set(reels.map(reelKey)).size !== reels.length) throw Error('Calibration needs distinct named reels.');
  const keys = new Set();
  const samples = value.samples.map(s => {
    if (!s || !Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a<1 || s.b>reels.length || s.a>=s.b
        || ![25,50,75].includes(s.percent) || !/^#[0-9a-f]{6}$/i.test(s.color)
        || material(reels[s.a-1]) !== material(reels[s.b-1])) throw Error('A sample needs two compatible reels, a 25/50/75% share and a measured six-digit hex colour.');
    const key = sampleKey(reels[s.a-1],reels[s.b-1],s.percent);
    if (keys.has(key)) throw Error('The calibration contains duplicate blend samples.');
    keys.add(key);
    return {a:s.a,b:s.b,percent:s.percent,color:norm(s.color)};
  });
  // Optional: each reel's own colour as read from its pure tile, in reel order.
  let pure=null;
  if(value.pure!==undefined&&value.pure!==null){
    if(!Array.isArray(value.pure)||value.pure.length!==reels.length||value.pure.some(c=>c!==null&&!/^#[0-9a-f]{6}$/i.test(String(c))))throw Error('Pure reel readings must be one six-digit colour, or nothing, for each reel.');
    pure=value.pure.map(c=>c===null?null:norm(c));
  }
  return {version:value.version,name:value.name.trim(),setup:value.setup.trim(),context:value.context,reels,samples,...(pure&&pure.some(Boolean)?{pure}:{}),
    ...(value.version===2?{surface:value.surface,revision:Number.isInteger(value.revision)&&value.revision>0?value.revision:1}:{} )};
}

export function matchesCalibration(profile, reels, surface=null) {
  return Boolean(profile && (!surface || (profile.surface || 'top')===surface) && reels.length===profile.reels.length && profile.reels.map(reelKey).sort().join('|')===reels.map(reelKey).sort().join('|'));
}

const linear=v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
const srgb=v=>{const c=Math.min(1,Math.max(0,v));return Math.round(255*(c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055));};
const channels=hex=>[1,3,5].map(i=>linear(parseInt(hex.slice(i,i+2),16)));
const between=(first,second,t)=>'#'+channels(first).map((v,i)=>srgb(v+(channels(second)[i]-v)*t).toString(16).padStart(2,'0')).join('').toUpperCase();

/**
 * Predictions for the explicitly enabled setup. A recorded recipe is used as measured.
 * A share that lies between two readings on the same pair is read off the straight line
 * between them; a reel's pure tile, when recorded, is the reading at 0% or 100%. Nothing
 * is carried beyond the readings: outside them, and for unrecorded pairs, the estimate stands.
 */
export function calibratedPredictor(reels, profile) {
  const samples = new Map(), pures = new Map();
  if (matchesCalibration(profile,reels)) {
    for (const s of profile.samples) samples.set(sampleKey(profile.reels[s.a-1],profile.reels[s.b-1],s.percent),s.color);
    (profile.pure || []).forEach((colour, i) => { if (colour) pures.set(reelKey(profile.reels[i]), colour); });
  }
  const measured = (a,b,percent) => samples.get(sampleKey(reels[a-1],reels[b-1],percent)) || null;
  const interpolated = (a,b,percent) => {
    // Only between two readings: a recorded share, or a reel's own pure tile. Nothing is
    // carried past the readings, and a nominal reel colour is never used as an end point.
    const line = [[0, pures.get(reelKey(reels[a-1])) || null], ...[25,50,75].map(p => [p, measured(a,b,p)]), [100, pures.get(reelKey(reels[b-1])) || null]]
      .filter(([, colour]) => colour);
    // Two pure tiles alone say nothing about how the pair blends: at least one blend must be recorded.
    if (!line.some(([share]) => share > 0 && share < 100)) return null;
    for (let i = 1; i < line.length; i += 1)
      if (percent >= line[i-1][0] && percent <= line[i][0]) return between(line[i-1][1], line[i][1], (percent - line[i-1][0]) / (line[i][0] - line[i-1][0]));
    return null;
  };
  // `seen` is the share the eye is expected to see once opacity is counted; readings are keyed by the layer share.
  const predict = (first,second,percent,a,b,seen=percent) => measured(a,b,percent) || interpolated(a,b,percent) || mixFdmHex(first,second,seen);
  return {predict,measured,interpolated};
}
