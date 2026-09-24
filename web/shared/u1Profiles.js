import { BASE_SETTINGS } from '../base_settings.js';
import { U1_PROFILES } from './u1ProfileData.js';

export const NOZZLES = ['0.2', '0.4', '0.6', '0.8'];
export const SPEED_ALIASES = {
  outer_wall_speed: 'external_perimeter_speed', inner_wall_speed: 'perimeter_speed',
  sparse_infill_speed: 'infill_speed', internal_solid_infill_speed: 'solid_infill_speed',
  top_surface_speed: 'top_solid_infill_speed', support_speed: 'support_material_speed',
  support_interface_speed: 'support_material_interface_speed', bridge_speed: 'bridge_speed',
  initial_layer_speed: 'first_layer_speed', travel_speed: 'travel_speed',
  default_acceleration: 'default_acceleration', outer_wall_acceleration: 'external_perimeter_acceleration',
  inner_wall_acceleration: 'perimeter_acceleration', sparse_infill_acceleration: 'infill_acceleration',
  internal_solid_infill_acceleration: 'solid_infill_acceleration', top_surface_acceleration: 'top_solid_infill_acceleration',
  initial_layer_acceleration: 'first_layer_acceleration', travel_acceleration: 'travel_acceleration',
};
export const PROFILE_SOURCE_KEYS = ['nozzle_diameter', 'printer_variant', 'print_settings_id',
  ...Object.keys(SPEED_ALIASES), ...Object.values(SPEED_ALIASES)];
const first = v => Array.isArray(v) ? v[0] : v;
const number = v => { const s=String(first(v) ?? '').trim(); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };
const clone = v => JSON.parse(JSON.stringify(v));

export function detectNozzle(source = {}) {
  const value = source?.nozzle_diameter;
  const entries = (Array.isArray(value) ? value : String(value ?? '').split(/[,;]/)).map(v=>String(Number(v)));
  const unique = [...new Set(entries)];
  if (unique.length === 1 && NOZZLES.includes(unique[0])) return unique[0];
  return null;
}

export function matchU1Profile(source = {}, nozzle = 'auto', { blends = false, carry = true, layerHeight = null } = {}) {
  const detected = detectNozzle(source);
  const diameter = nozzle === 'auto' ? (detected || '0.4') : String(nozzle);
  if (!NOZZLES.includes(diameter)) throw new Error('Choose a supported U1 nozzle: 0.2, 0.4, 0.6 or 0.8 mm.');
  const machine = U1_PROFILES.machines.find(m=>String(first(m.nozzle_diameter))===diameter);
  const candidates = U1_PROFILES.processes.filter(p=>p.compatible_printers?.includes(machine.name)
    && (blends && diameter==='0.4' ? p.name.includes('Color Mixing') : !p.name.includes('Color Mixing')));
  const height = layerHeight?.mode === 'preset' ? NaN : layerHeight?.mode === 'custom' ? number(layerHeight.value)
    : carry || layerHeight?.mode === 'preserve' ? number(source?.layer_height) : NaN;
  const wanted = blends ? 0.1 : Number.isFinite(height) && height>0 ? height : Number(diameter)/2;
  candidates.sort((a,b)=>Math.abs(number(a.layer_height)-wanted)-Math.abs(number(b.layer_height)-wanted));
  const process = candidates[0];
  if (!process) throw new Error(`No bundled U1 process for a ${diameter} mm nozzle.`);
  const notes = [];
  if (nozzle==='auto' && !detected) notes.push('Source nozzle is missing, unsupported or mixed; using 0.4 mm. Select the nozzle fitted to your U1.');
  else if (nozzle==='auto') notes.push(`Source uses ${diameter} mm. Check this matches the nozzle fitted to your U1.`);
  if (blends && diameter!=='0.4') throw new Error('Full Spectrum blend export currently requires a 0.4 mm U1 nozzle. Other nozzle sizes are available for solid-colour conversion.');
  return { nozzle:diameter, detected, machine, process, notes,
    minLayer:number(machine.min_layer_height), maxLayer:number(machine.max_layer_height),
    exact: number(process.layer_height)===wanted };
}

export function materialProfile(type, nozzle) {
  const material=String(type || 'PLA').trim().toUpperCase();
  const name=`Generic ${material}`;
  const printer=`Snapmaker U1 (${nozzle} nozzle)`;
  const profile=U1_PROFILES.filaments.find(p=>p.compatible_printers?.includes(printer)
    && (p.name.toUpperCase()===name.toUpperCase() || p.name.toUpperCase()===`${name} @U1 ${nozzle} nozzle`.toUpperCase()));
  if (!profile) throw new Error(`No verified Generic ${material} profile for a ${nozzle} mm U1 nozzle. Choose a supported material/nozzle combination; PLA settings will not be substituted.`);
  return profile;
}

export function buildU1Profile(source, types, nozzle='auto', options={}) {
  const match=matchU1Profile(source, nozzle, options);
  const cfg=clone(BASE_SETTINGS), processKeys=[];
  // Use only schema keys already understood by this exporter. Never import G-code.
  for (const [key,value] of Object.entries(match.process)) {
    if (!(key in BASE_SETTINGS) || /gcode|filament|printer|compatible|inherits|version|^name$|^print_settings_id$/.test(key)) continue;
    cfg[key]=clone(Array.isArray(BASE_SETTINGS[key]) ? value : first(value));
    processKeys.push(key);
  }
  cfg.printer_settings_id=match.machine.name;
  cfg.printer_model='Snapmaker U1'; cfg.printer_variant=match.nozzle;
  cfg.print_settings_id=match.process.name;
  cfg.default_print_profile=match.process.name;
  cfg.nozzle_diameter=types.map(()=>match.nozzle);
  cfg.min_layer_height=types.map(()=>String(match.minLayer));
  cfg.max_layer_height=types.map(()=>String(match.maxLayer));
  const profiles=types.map(t=>materialProfile(t,match.nozzle));
  const filamentKeys=[];
  const excluded=new Set(['compatible_printers','compatible_prints','filament_colour','filament_ids','filament_settings_id','filament_type','default_filament_profile']);
  for (const key of new Set(profiles.flatMap(p=>Object.keys(p)))) {
    if (!Array.isArray(BASE_SETTINGS[key]) || excluded.has(key) || /gcode/.test(key)) continue;
    if (!profiles.every(p=>p[key]!==undefined)) continue;
    cfg[key]=profiles.map(p=>clone(first(p[key]))); filamentKeys.push(key);
  }
  cfg.filament_settings_id=profiles.map(p=>p.name);
  cfg.filament_ids=profiles.map(p=>p.filament_id || '');
  cfg.filament_type=profiles.map(p=>first(p.filament_type));
  cfg.filament_vendor=profiles.map(p=>first(p.filament_vendor) || 'Generic');
  cfg.default_filament_profile=profiles.map(p=>p.name);
  return {cfg, match, processKeys, filamentKeys, materials:profiles.map(p=>p.name)};
}

export function conservativeSpeeds(source, baseline) {
  const values={}, notes=[];
  for (const [key,alias] of Object.entries(SPEED_ALIASES)) {
    const raw=source?.[key] ?? source?.[alias];
    if (raw===undefined) continue;
    const value=number(raw), own=number(baseline[key]);
    const cap=own>0 ? own : key.endsWith('acceleration') ? number(baseline.default_acceleration) : NaN;
    if (!(value>0) || !(cap>0)) { notes.push(`${key}: automatic, relative or unsupported value kept at U1 default`); continue; }
    values[key]=String(Math.min(value,cap));
    if (value>cap) notes.push(`${key}: capped from ${value} to ${cap}`);
  }
  return {values,notes};
}

export function constrainLayers(values, match) {
  const notes=[];
  for (const key of ['layer_height','initial_layer_print_height']) {
    if (values[key]===undefined) continue;
    const value=number(values[key]);
    if (!(value>=match.minLayer && value<=match.maxLayer)) {
      values[key]=String(first(match.process[key]));
      notes.push(`${key}: source value is outside ${match.minLayer}–${match.maxLayer} mm; using ${values[key]} mm for this nozzle`);
    }
  }
  return notes;
}

/** Shared by the pre-conversion review and exporter: never silently clamp a custom choice. */
export function resolveLayerHeight(source, match, choice = {mode:'preserve'}) {
  const mode=choice.mode || 'preserve', original=number(source?.layer_height);
  if (!['preserve','preset','custom'].includes(mode)) throw new Error('Choose a layer-height mode.');
  const fallback=number(match.process.layer_height);
  let height=mode==='custom' ? number(choice.value) : mode==='preset'
    ? number(matchU1Profile({},match.nozzle,{carry:false}).process.layer_height) : original;
  let reason=mode==='custom' ? 'custom batch height' : mode==='preset' ? 'standard nozzle preset' : 'designer height preserved';
  if (!(height>=match.minLayer && height<=match.maxLayer)) {
    if(mode==='custom') throw new Error(`Custom layer height must be ${match.minLayer}–${match.maxLayer} mm for the ${match.nozzle} mm nozzle.`);
    height=fallback;
    reason=Number.isFinite(original) ? `outside the ${match.minLayer}–${match.maxLayer} mm nozzle range` : 'source height unspecified; using nozzle preset';
  }
  return {mode,source:Number.isFinite(original)?original:null,height,reason,
    text:`Layer height: ${Number.isFinite(original)?original+' mm':'unspecified'} → ${height} mm (${reason}).`};
}

export function profileDescription(profile) {
  return `${profile.match.process.name}. Filaments: ${[...new Set(profile.materials)].join(', ')}. ${profile.match.notes.join(' ')}`;
}
