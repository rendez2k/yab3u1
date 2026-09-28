import {bambuConfig} from './targets.js';
import {transferSettings} from './printSettings.js';
import {applyFilamentProfiles, FILAMENT_FIELDS} from './filamentProfiles.js';

// Public profiles only. No model, filename or printer address is sent to GitHub.
export const BAMBU_REVISION = 'da8b44ee34dd349f2ae0df3f1cbae366df482354';
export const BAMBU_PROFILE_URL = `https://raw.githubusercontent.com/bambulab/BambuStudio/${BAMBU_REVISION}/resources/profiles/`;
const metadata = new Set(['type','name','inherits','include','from','setting_id','filament_id',
  'instantiation','version','description','compatible_printers','compatible_printers_condition',
  'compatible_prints','compatible_prints_condition','renamed_from','alias']);
const settings = profile => Object.fromEntries(Object.entries(profile).filter(([key]) => !metadata.has(key)));

export class BambuProfiles {
  constructor(fetchJSON = async path => {
    const response = await fetch(BAMBU_PROFILE_URL + path.split('/').map(encodeURIComponent).join('/'),
      {credentials:'omit', signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`Official Bambu profiles could not be loaded (${response.status}).`);
    return response.json();
  }) { this.fetchJSON = fetchJSON; this.files = new Map(); }

  async json(path) {
    if (!this.files.has(path)) this.files.set(path, this.fetchJSON(path).catch(error => {
      this.files.delete(path); throw error;
    }));
    return this.files.get(path);
  }

  async catalogue() {
    const index = await this.json('BBL.json');
    this.index = index;
    return index.machine_list.flatMap(entry => {
      const match = /^(Bambu Lab .+) (0\.[2468]) nozzle$/.exec(entry.name);
      return match ? [{name:entry.name, model:match[1], nozzle:match[2]}] : [];
    });
  }

  async resolve(kind, name, ancestors = []) {
    if (!this.index) await this.catalogue();
    const key = `${kind}:${name}`;
    if (ancestors.includes(key)) throw new Error(`Circular Bambu profile: ${name}`);
    const entry = this.index[`${kind}_list`]?.find(item => item.name === name);
    if (!entry || entry.sub_path.includes('..')) throw new Error(`Missing official Bambu ${kind} profile: ${name}`);
    const own = await this.json('BBL/' + entry.sub_path);
    const chain = [...ancestors, key];
    const base = own.inherits ? await this.resolve(kind, own.inherits, chain) : {};
    const includes = await Promise.all((own.include || []).map(n => this.resolve(kind,n,chain)));
    return Object.assign({}, base, ...includes, own);
  }

  async setup(name, types) {
    const printers = await this.catalogue();
    if (!printers.some(p => p.name === name)) throw new Error('Choose a supported Bambu printer and nozzle.');
    const machine = await this.resolve('machine', name);
    const process = await this.resolve('process', machine.default_print_profile);
    const materials = {};
    for (const type of [...new Set(types.map(t => t || 'PLA'))]) {
      // Prefer the exact nozzle preset, then a compatible family preset.
      // Never silently substitute a different material.
      const candidates = this.index.filament_list.filter(e => e.name === `Generic ${type}` || e.name.startsWith(`Generic ${type} @`));
      const resolved = await Promise.all(candidates.map(e => this.resolve('filament', e.name)));
      const compatible = resolved.filter(p => p.instantiation === 'true' && p.compatible_printers?.includes(name)
        && p.filament_type?.[0] === type);
      compatible.sort((a,b) => b.name.includes(machine.printer_variant + ' nozzle') - a.name.includes(machine.printer_variant + ' nozzle'));
      if (!compatible.length) throw new Error(`No compatible official Generic ${type} preset for ${name}. Choose colour-model export or another printer.`);
      materials[type] = compatible[0];
    }
    const points = (machine.printable_area || []).map(p => p.split('x').map(Number));
    const width = Math.max(...points.map(p=>p[0])), depth = Math.max(...points.map(p=>p[1]));
    if (!(width > 0 && depth > 0 && Number(machine.printable_height) > 0)) throw new Error('This printer profile has no usable build volume.');
    // Reserve the hardware cutout, not a strip around every edge of the bed.
    const excluded = (machine.bed_exclude_area || []).map(p => p.split('x').map(Number));
    const keepoutBoxes = excluded.some(p=>p[0] || p[1]) ? [{
      min:[Math.min(...excluded.map(p=>p[0])),Math.min(...excluded.map(p=>p[1]))],
      max:[Math.max(...excluded.map(p=>p[0])),Math.max(...excluded.map(p=>p[1]))],
    }] : [];
    return {revision:BAMBU_REVISION, machine, process, materials,
      bed:{width,depth,maxHeight:Number(machine.printable_height),edgeMargin:0,keepoutBoxes}};
  }
}

export function nativeBambuConfig(setup, colours, types, source = {}, carry = true) {
  if (!setup?.machine?.name || !setup?.process?.name || !setup?.materials) throw new Error('Choose a Bambu printer and nozzle before exporting.');
  const {machine, process} = setup;
  const materials = types.map(t => {
    const p = setup.materials[t || 'PLA'];
    if (!p || !p.compatible_printers?.includes(machine.name)) throw new Error(`Missing compatible ${t} filament profile for ${machine.name}.`);
    return p;
  });
  const cfg = {...settings(machine), ...settings(process)};
  const materialSettings = materials.map(settings);
  for (const key of new Set(materialSettings.flatMap(p=>Object.keys(p)))) {
    const values = materialSettings.map(p => p[key]);
    if (values.some(v => v === undefined)) throw new Error(`Bambu filament presets disagree on ${key}; use colour-model export for this material combination.`);
    // Bambu's unsliced project stores all extruder variants per filament.
    // Taking just element zero would discard the H2 family's nozzle variants.
    cfg[key] = Array.isArray(values[0]) ? values.flatMap(v => v) : values[0];
  }
  const carried = carry ? transferSettings(source, 'bambu', {baseline:cfg}).values : {};
  Object.assign(cfg, carried, bambuConfig(colours, types, []), {
    printer_settings_id:machine.name, print_settings_id:process.name,
    filament_settings_id:materials.map(p=>p.name), filament_ids:materials.map(p=>p.filament_id || ''),
    printer_model:machine.printer_model, printer_variant:machine.printer_variant,
    inherits_group:[process.name, ...materials.map(p=>p.name), machine.name],
    different_settings_to_system:[Object.keys(carried).join(';'), ...materials.map(()=> 'filament_colour'), ''],
    curr_bed_type:'Textured PEI Plate',
    filament_self_index:materials.flatMap((p,i)=>(p.filament_extruder_variant || ['']).map(()=>String(i+1))),
  });
  // Nozzle arrays describe the selected hardware, never the number of colours.
  cfg.nozzle_diameter = machine.nozzle_diameter.slice();
  validateBambuLayers(carried, setup);
  return cfg;
}

export function validateBambuLayers(values, setup) {
  const machine = setup.machine;
  const nozzle = Math.min(...machine.nozzle_diameter.map(Number));
  const minimum = Math.max(...(machine.min_layer_height || [nozzle * 0.2]).map(Number));
  const maximum = Math.min(...(machine.max_layer_height || [nozzle * 0.75]).map(Number));
  for (const key of ['layer_height','initial_layer_print_height']) {
    if (values[key] !== undefined && (Number(values[key]) < minimum || Number(values[key]) > maximum)) {
      throw new Error(`Source ${key === 'layer_height' ? 'layer height' : 'first layer height'} (${values[key]} mm) is outside ${minimum}–${maximum} mm for ${machine.name}. Choose a suitable nozzle or turn off carrying source settings.`);
    }
  }
}

export function applyNativeBambuFilaments(cfg, reels) {
  const compact = structuredClone(cfg);
  const indices = cfg.filament_self_index.map(Number);
  for (const key of Object.keys(FILAMENT_FIELDS)) {
    if (Array.isArray(cfg[key]) && cfg[key].length === indices.length) {
      compact[key] = reels.map((_,i)=>cfg[key][indices.indexOf(i+1)]);
    }
  }
  const report = applyFilamentProfiles(compact,reels);
  for (const key of report.keys) {
    cfg[key] = Array.isArray(cfg[key]) && cfg[key].length === indices.length
      ? indices.map(i=>compact[key][i-1]) : compact[key];
  }
  cfg.filament_settings_id = compact.filament_settings_id;
  if (compact.filament_vendor) cfg.filament_vendor = compact.filament_vendor;
  return report;
}
