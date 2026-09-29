// Review demo: three PLA model reels and a dedicated PETG interface in slot 4.
// The reserved role travels with the palette; it is never a model colour.
export function interfacePalette(reels, enabled) {
  if (!enabled) return reels;
  return reels.map((r,i)=>i===3
    ? String(r.type).toUpperCase()==='PETG' ? {...r,role:'support-interface',name:r.name || 'PETG interface'} : {color:'#FFFFFF',type:'PETG',name:'PETG interface',role:'support-interface'}
    : {...r,role:undefined});
}

export const INTERFACE_SETTINGS = Object.freeze({
  enable_support:'1', support_filament:'1', support_interface_filament:'4',
  support_interface_top_layers:'3', support_interface_bottom_layers:'3',
  support_top_z_distance:'0', support_bottom_z_distance:'0',
  support_interface_spacing:'0', support_bottom_interface_spacing:'0',
});

export function validateInterfaceExport({target, reels, mapping={}, recipes=[], supportMode}) {
  if(target!=='snapmaker') throw Error('The PETG interface demo requires Snapmaker U1 output.');
  if(reels.length!==4 || reels.slice(0,3).some(r=>String(r.type).toUpperCase()!=='PLA')
      || String(reels[3].type).toUpperCase()!=='PETG')
    throw Error('Use PLA in slots 1–3 and PETG in slot 4 for the interface demo.');
  if(supportMode==='off') throw Error('PETG interface mode requires supports to be enabled.');
  if(Object.values(mapping).some(id=>Number(id)===4) || recipes.some(r=>r.a===4 || r.b===4))
    throw Error('Slot 4 is reserved for PETG support interfaces and cannot colour the model or a blend.');
}

export function applyInterfaceSettings(cfg, {global=false}={}) {
  Object.assign(cfg, INTERFACE_SETTINGS);
  if(global) Object.assign(cfg,{enable_prime_tower:'1',wipe_tower_filament:'1'});
  return [...Object.keys(INTERFACE_SETTINGS), ...(global?['enable_prime_tower','wipe_tower_filament']:[])];
}
