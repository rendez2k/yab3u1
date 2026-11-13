// A file copy of what YAB3D keeps in this browser: loaded reels, reel TD values, printed blend
// samples and saved filament sets. Nothing here leaves the browser except through this file.
import { CALIBRATION_KEY, validateCalibration } from './blendCalibration.js';
import { validateBundle } from './filamentBundles.js';

export const SETTINGS_APP = 'yab3d-settings', SETTINGS_VERSION = 1, SETTINGS_MAX_BYTES = 2 * 1024 * 1024;
const HEX = /^#[0-9a-f]{6}$/i;

function reels(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) throw Error('Loaded reels must list 1 to 24 reels.');
  for (const reel of value) if (!reel || typeof reel !== 'object' || !HEX.test(String(reel.color))) throw Error('Every loaded reel needs a colour such as #FFFFFF.');
  return value;
}
function td(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Reel TD values must be a list of filaments.');
  const entries = Object.entries(value);
  if (entries.length > 500) throw Error('Too many reel TD values.');
  for (const [key, number] of entries)
    if (!key || key.length > 200 || !(Number(number) >= 0.1 && Number(number) <= 100)) throw Error('Every reel TD value must be from 0.1 to 100 mm.');
  return Object.fromEntries(entries.map(([key, number]) => [key, Math.round(Number(number) * 10) / 10]));
}
function sets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Saved filament sets are not readable.');
  return { custom: (value.custom || []).slice(0, 40).map(validateBundle), owned: (value.owned || []).filter(x => typeof x === 'string').slice(0, 100) };
}

/** Each part: where it lives in browser storage, what to call it, and how to check it. */
export const SETTINGS_PARTS = [
  { id: 'reels', key: 'yab3u1-web-reels', label: 'loaded reels', check: reels, count: v => v.length },
  { id: 'td', key: 'yab3d-reel-td', label: 'reel TD values', check: td, count: v => Object.keys(v).length },
  { id: 'samples', key: CALIBRATION_KEY, label: 'printed blend samples', check: validateCalibration, count: v => (v.samples || []).length },
  { id: 'sets', key: 'yab3d-filament-sets-v1', label: 'saved filament sets', check: sets, count: v => (v.custom || []).length },
];

/** What is saved now. Damaged parts are left out and named, never copied into the file. */
export function collectSettings(storage) {
  const data = {}, skipped = [];
  for (const part of SETTINGS_PARTS) {
    let raw = null; try { raw = storage.getItem(part.key); } catch { /* storage unavailable */ }
    if (raw == null) continue;
    try { data[part.id] = part.check(JSON.parse(raw)); } catch { skipped.push(part.label); }
  }
  return { file: { app: SETTINGS_APP, version: SETTINGS_VERSION, saved: new Date().toISOString(), data }, skipped };
}

/** Checks a settings file completely before anything is written. */
export function readSettings(text) {
  if (typeof text !== 'string' || text.length > SETTINGS_MAX_BYTES) throw Error('Settings file must be smaller than 2 MB.');
  let file; try { file = JSON.parse(text); } catch { throw Error('This is not a YAB3D settings file.'); }
  if (!file || file.app !== SETTINGS_APP || !file.data || typeof file.data !== 'object') throw Error('This is not a YAB3D settings file.');
  if (file.version !== SETTINGS_VERSION) throw Error('This settings file was made by a different version of YAB3D.');
  const data = {};
  for (const part of SETTINGS_PARTS) if (file.data[part.id] != null) data[part.id] = part.check(file.data[part.id]);
  if (!Object.keys(data).length) throw Error('This settings file is empty.');
  return data;
}

/** Replaces only the parts the file holds. */
export function applySettings(storage, data) {
  for (const part of SETTINGS_PARTS) if (data[part.id] != null) storage.setItem(part.key, JSON.stringify(data[part.id]));
}

export const describeSettings = data => SETTINGS_PARTS.filter(p => data[p.id] != null).map(p => `${p.count(data[p.id])} ${p.label}`).join(', ');
