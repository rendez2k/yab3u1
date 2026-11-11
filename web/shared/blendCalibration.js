import {norm} from './colour.js';
import {mixFdmHex} from './fdmMix.js';
import {filamentIdentity,reelIdentity} from './filamentIdentity.js';

export const CALIBRATION_KEY = 'yab3d-blend-calibration-v1';
const material = r => String(r.type || 'PLA').trim().toUpperCase();
const reelKey = reelIdentity;
/** How a sample was made. Versions 1 and 2 predate the key and are always the slicer's own blend. */
export const CONSTRUCTIONS = ['slicer-blend', 'built-in'];
export const MAX_SEQUENCE = 40;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function sampleKey(first, second, percent) {
  const a = reelKey(first), b = reelKey(second);
  return a < b ? `${a}|${b}|${percent}` : `${b}|${a}|${100-percent}`;
}

/** Strict, bounded portable data. Importing never enables a profile. */
export function validateCalibration(value) {
  if (!value || ![1,2,3].includes(value.version) || !text(value.name,120) || !text(value.setup,500)
      || !text(value.context,20000) || !Array.isArray(value.reels) || value.reels.length<2 || value.reels.length>24
      || (value.version===1 && value.reels.length!==4)
      || (value.version>=2 && !['wall','top'].includes(value.surface))
      || (value.version===3 && !CONSTRUCTIONS.includes(value.construction))
      || !Array.isArray(value.samples) || value.samples.length > 828) throw Error('Choose a YAB3D calibration JSON with 2–24 named reels and a measured surface.');
  const reels = value.reels.map(r => {
    if (!r || !norm(r.color) || !text(r.type,40) || !text(r.name,120)) throw Error('Each calibration reel needs its colour, material and brand/reel name.');
    return {...filamentIdentity(r),color:norm(r.color),type:material(r),name:r.name.trim()};
  });
  if (new Set(reels.map(reelKey)).size !== reels.length) throw Error('Calibration needs distinct named reels.');
  const keys = new Set();
  const samples = value.samples.map(value.version === 3 ? s => {
    if (!s || !Array.isArray(s.sequence) || s.sequence.length < 1 || s.sequence.length > MAX_SEQUENCE
        || !s.sequence.every(n => Number.isInteger(n) && n >= 1 && n <= reels.length)
        || new Set(s.sequence.map(n => material(reels[n-1]))).size !== 1
        || typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color)) throw Error('A sample needs a sequence of 1–40 reel numbers from the same material and a measured six-digit hex colour.');
    const key = sequenceKey(reels, s.sequence);
    if (keys.has(key)) throw Error('The calibration contains duplicate blend samples.');
    keys.add(key);
    return {sequence:[...s.sequence],color:norm(s.color)};
  } : s => {
    if (!s || !Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a<1 || s.b>reels.length || s.a>=s.b
        || ![25,50,75].includes(s.percent) || !/^#[0-9a-f]{6}$/i.test(s.color)
        || material(reels[s.a-1]) !== material(reels[s.b-1])) throw Error('A sample needs two compatible reels, a 25/50/75% share and a measured six-digit hex colour.');
    const key = sampleKey(reels[s.a-1],reels[s.b-1],s.percent);
    if (keys.has(key)) throw Error('The calibration contains duplicate blend samples.');
    keys.add(key);
    return {a:s.a,b:s.b,percent:s.percent,color:norm(s.color)};
  });
  return {version:value.version,name:value.name.trim(),setup:value.setup.trim(),context:value.context,reels,samples,
    ...(value.version>=2?{surface:value.surface,revision:Number.isInteger(value.revision)&&value.revision>0?value.revision:1}:{} ),
    ...(value.version===3?{construction:value.construction}:{})};
}

/** A sequence in the reels' own identities, so it survives a different slot order. */
const sequenceKey = (reels, sequence) => sequence.map(n => reelKey(reels[n-1])).join('>');

export function matchesCalibration(profile, reels, surface=null) {
  return Boolean(profile && (!surface || (profile.surface || 'top')===surface) && reels.length===profile.reels.length && profile.reels.map(reelKey).sort().join('|')===reels.map(reelKey).sort().join('|'));
}

/** No extrapolation: only the recorded recipe on the explicitly enabled setup. */
export function calibratedPredictor(reels, profile) {
  const samples = new Map();
  if (matchesCalibration(profile,reels)) for (const s of profile.samples) {
    if (!('a' in s)) continue;   // version 3 samples are whole sequences, not two-reel shares
    samples.set(sampleKey(profile.reels[s.a-1],profile.reels[s.b-1],s.percent),s.color);
  }
  const measured = (a,b,percent) => samples.get(sampleKey(reels[a-1],reels[b-1],percent)) || null;
  const predict = (first,second,percent,a,b) => measured(a,b,percent) || mixFdmHex(first,second,percent);
  return {predict,measured};
}

/**
 * The measured colour of one built-in-colours sequence, or null. A colour is only ever measured when
 * the profile is for exactly these reels, was made with the built-in construction on the wall surface,
 * and holds this exact sequence (slot numbers are 1-based positions in `reels`). A two-reel slicer
 * blend, a top-surface sample or a different order is never a measurement of it.
 */
export function builtInMeasured(reels, profile, sequence) {
  if (!profile || profile.version !== 3 || profile.construction !== 'built-in' || !Array.isArray(reels)
      || !matchesCalibration(profile, reels, 'wall')) return null;
  if (!Array.isArray(sequence) || sequence.length < 1 || sequence.length > MAX_SEQUENCE
      || !sequence.every(n => Number.isInteger(n) && n >= 1 && n <= reels.length)) return null;
  const key = sequenceKey(reels, sequence);
  const hit = profile.samples.find(s => sequenceKey(profile.reels, s.sequence) === key);
  return hit ? hit.color : null;
}
