// Review demo: three PLA model reels and a dedicated PETG interface in any slot.
// The reserved role travels with the palette; it is never a model colour.
export const interfaceSlot = reels => reels.findIndex(r=>r.role==='support-interface')+1;
export const modelSlots = reels => reels.flatMap((r,i)=>r.role==='support-interface' ? [] : [i+1]);

export function interfacePalette(reels, enabled) {
  if (!enabled) return reels;
  const reserved=interfaceSlot(reels) || reels.findIndex(r=>String(r.type).toUpperCase()==='PETG')+1 || 4;
  return reels.map((r,i)=>i===reserved-1
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
  const reserved=interfaceSlot(reels);
  if(reels.length!==4 || reels.filter(r=>r.role==='support-interface').length!==1
      || reels.some((r,i)=>String(r.type).toUpperCase()!==(i===reserved-1?'PETG':'PLA')))
    throw Error('Use three PLA model reels and one reserved PETG interface reel for the interface demo.');
  if(supportMode==='off') throw Error('PETG interface mode requires supports to be enabled.');
  if(Object.values(mapping).some(id=>Number(id)===reserved) || recipes.some(r=>Number(r.a)===reserved || Number(r.b)===reserved))
    throw Error(`Slot ${reserved} is reserved for PETG support interfaces and cannot colour the model or a blend.`);
}

export function applyInterfaceSettings(cfg, {global=false,reels}={}) {
  const reserved=interfaceSlot(reels), base=modelSlots(reels)[0];
  if(!reserved || !base) throw Error('Choose a PETG interface slot and PLA model reels before exporting.');
  Object.assign(cfg, INTERFACE_SETTINGS,{support_filament:String(base),support_interface_filament:String(reserved)});
  if(global) Object.assign(cfg,{enable_prime_tower:'1',wipe_tower_filament:String(base)});
  return [...Object.keys(INTERFACE_SETTINGS), ...(global?['enable_prime_tower','wipe_tower_filament']:[])];
}
