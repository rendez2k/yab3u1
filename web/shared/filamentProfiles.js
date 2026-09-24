// Portable filament properties only. Printer compatibility and custom G-code
// never travel with a borrowed filament preset.
export const FILAMENT_FIELDS = {
  nozzle_temperature:['temperature',0,350],
  nozzle_temperature_initial_layer:['first_layer_temperature',0,350],
  hot_plate_temp:['bed_temperature',0,150],
  hot_plate_temp_initial_layer:['first_layer_bed_temperature',0,150],
  textured_plate_temp:['bed_temperature',0,150],
  textured_plate_temp_initial_layer:['first_layer_bed_temperature',0,150],
  filament_flow_ratio:['extrusion_multiplier',0.5,1.5],
  filament_max_volumetric_speed:['filament_max_volumetric_speed',0.1,100],
  filament_density:['filament_density',0.5,3],
  filament_diameter:['filament_diameter',1.7,1.8],
};
const at=(v,i)=>Array.isArray(v)?v[i]??(v.length===1?v[0]:undefined):v;
export function readFilamentProfiles(cfg,types) {
  return types.map((type,i)=>{
    const name=at(cfg.filament_settings_id,i) || at(cfg.name,i);
    if(!name) return null;
    const values={};
    for(const [key,[alias,min,max]] of Object.entries(FILAMENT_FIELDS)) {
      const raw=at(cfg[key] ?? cfg[alias],i);
      const value=Number(raw);
      if(raw!==undefined && String(raw).trim()!=='' && Number.isFinite(value) && value>=min && value<=max) values[key]=String(value);
    }
    return {name:String(name).slice(0,160),type:String(type),vendor:String(at(cfg.filament_vendor,i)||'Custom').slice(0,80),values};
  });
}
export function parseFilamentPreset(text) {
  const cfg=JSON.parse(text);
  const type=at(cfg.filament_type,0);
  if(!type) throw new Error('This JSON is not a filament preset: filament_type is missing.');
  const preset=readFilamentProfiles(cfg,[type])[0];
  if(!preset || !preset.values.nozzle_temperature) throw new Error('Export a resolved filament preset with a name and nozzle temperature; an inheritance-only preset is not enough.');
  return preset;
}
export function applyFilamentProfiles(cfg,reels,{u1=false}={}) {
  const profiles=reels.map(r=>r.profile || null), notes=[], keys=new Set();
  profiles.forEach((p,i)=>{
    if(!p) return;
    if(String(p.type).toUpperCase()!==String(reels[i].type).toUpperCase()) throw new Error(`Slot ${i+1}: filament preset material does not match the reel.`);
    cfg.filament_settings_id[i]=`${p.name} - YAB3D`;
    if(!cfg.filament_vendor) cfg.filament_vendor=reels.map(()=> 'Generic');
    cfg.filament_vendor[i]=p.vendor;
  });
  for(const [key,[,min,max]] of Object.entries(FILAMENT_FIELDS)) {
    if(!profiles.some(p=>p?.values[key]!==undefined)) continue;
    if(!u1 && !profiles.every(p=>p?.values[key]!==undefined)) {notes.push(`${key}: incomplete preset data; select destination filament presets in the slicer`);continue;}
    if(!cfg[key]) cfg[key]=reels.map(()=>null);
    profiles.forEach((p,i)=>{
      if(p?.values[key]===undefined) return;
      const value=Number(p.values[key]);
      if(!Number.isFinite(value)||value<min||value>max) throw new Error(`Invalid ${key} in slot ${i+1}.`);
      if(u1 && /nozzle_temperature/.test(key) && value>300) throw new Error(`Slot ${i+1}: source preset exceeds the U1's 300 °C nozzle limit.`);
      // https://www.snapmaker.com/snapmaker-u1/specs
      if(u1 && /plate_temp/.test(key) && value>100) throw new Error(`Slot ${i+1}: source preset exceeds the U1's 100 °C heated-bed limit.`);
      const cap=u1 && key==='filament_max_volumetric_speed' ? Number(cfg[key][i]) : Infinity;
      cfg[key][i]=String(Math.min(value,cap>0?cap:Infinity)); keys.add(key);
    });
  }
  return {keys:[...keys],notes};
}
export function prusaFilamentConfig(cfg) {
  const values={filament_settings_id:cfg.filament_settings_id,filament_type:cfg.filament_type,filament_colour:cfg.filament_colour};
  for(const [key,[alias]] of Object.entries(FILAMENT_FIELDS)) if(cfg[key] && !key.startsWith('textured_')) values[alias]=cfg[key];
  return Object.entries(values).filter(([,v])=>v).map(([k,v])=>`; ${k} = ${v.map(x=>String(x).replace(/[;\r\n]/g,' ')).join(';')}`).join('\n')+'\n';
}
