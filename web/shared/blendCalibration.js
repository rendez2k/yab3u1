import {norm} from './colour.js';
import {mixFdmHex} from './fdmMix.js';

export const CALIBRATION_KEY = 'yab3d-blend-calibration-v1';
const material = r => String(r.type || 'PLA').trim().toUpperCase();
const reelKey = r => `${material(r)}:${norm(r.color)}`;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function sampleKey(first, second, percent) {
  const a = reelKey(first), b = reelKey(second);
  return a < b ? `${a}|${b}|${percent}` : `${b}|${a}|${100-percent}`;
}

/** Strict, bounded portable data. Importing never enables a profile. */
export function validateCalibration(value) {
  if (!value || value.version !== 1 || !text(value.name,120) || !text(value.setup,500)
      || !text(value.context,20000) || !Array.isArray(value.reels) || value.reels.length !== 4
      || !Array.isArray(value.samples) || value.samples.length > 18) throw Error('Choose a YAB3D calibration JSON with a named four-reel setup.');
  const reels = value.reels.map(r => {
    if (!r || !norm(r.color) || !text(r.type,40) || !text(r.name,120)) throw Error('Each calibration reel needs its colour, material and brand/reel name.');
    return {color:norm(r.color),type:material(r),name:r.name.trim()};
  });
  if (new Set(reels.map(reelKey)).size !== 4) throw Error('Calibration needs four distinct reel colours/materials.');
  const keys = new Set();
  const samples = value.samples.map(s => {
    if (!s || !Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a<1 || s.b>4 || s.a>=s.b
        || ![25,50,75].includes(s.percent) || !/^#[0-9a-f]{6}$/i.test(s.color)
        || material(reels[s.a-1]) !== material(reels[s.b-1])) throw Error('A sample needs two compatible reels, a 25/50/75% share and a measured six-digit hex colour.');
    const key = sampleKey(reels[s.a-1],reels[s.b-1],s.percent);
    if (keys.has(key)) throw Error('The calibration contains duplicate blend samples.');
    keys.add(key);
    return {a:s.a,b:s.b,percent:s.percent,color:norm(s.color)};
  });
  return {version:1,name:value.name.trim(),setup:value.setup.trim(),context:value.context,reels,samples};
}

export function matchesCalibration(profile, reels) {
  return Boolean(profile && reels.length===4 && profile.reels.map(reelKey).sort().join('|')===reels.map(reelKey).sort().join('|'));
}

/** No extrapolation: only the recorded recipe on the explicitly enabled setup. */
export function calibratedPredictor(reels, profile) {
  const samples = new Map();
  if (matchesCalibration(profile,reels)) for (const s of profile.samples) {
    samples.set(sampleKey(profile.reels[s.a-1],profile.reels[s.b-1],s.percent),s.color);
  }
  const measured = (a,b,percent) => samples.get(sampleKey(reels[a-1],reels[b-1],percent)) || null;
  const predict = (first,second,percent,a,b) => measured(a,b,percent) || mixFdmHex(first,second,percent);
  return {predict,measured};
}
