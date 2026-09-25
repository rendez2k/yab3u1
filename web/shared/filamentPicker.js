import {parseFilamentPreset, readFilamentProfiles} from './filamentProfiles.js';
import {U1_PROFILES} from './u1ProfileData.js';
import {detectNozzle} from './u1Profiles.js';
const imported=[];
export function renderFilamentPicker(host,{types,source=[],selected=[],target,nozzle='auto',sourceSettings,onChange}) {
  host.replaceChildren();
  const note=document.createElement('p');note.className='hint';
  note.textContent='Choose presets for the actual reels you will use. Presets in your 3MF can be from Bambu, eSUN, Sunlu or any other brand. Import a resolved filament JSON to add another. Only reviewed material properties travel; machine commands do not.';
  host.append(note);
  const label=document.createElement('label');label.className='filament-preset-control';label.textContent='Import filament preset (.json)';
  const input=document.createElement('input');input.type='file';input.accept='.json';input.setAttribute('aria-label','Import filament preset JSON');
  input.onchange=async()=>{
    try {
      const file=input.files[0];if(!file)return;
      if(file.size>1048576)throw new Error('Filament preset exceeds 1 MB.');
      const preset=parseFilamentPreset(await file.text());
      imported.push(preset);onChange(null,null);
      host.querySelector('p').textContent=`Added ${preset.name} (${preset.type}). Select it beside a matching material below.`;
    } catch(error){note.textContent=error.message;}
  };label.append(input);host.append(label);
  const diameter=nozzle==='auto'?(detectNozzle(sourceSettings)||'0.4'):nozzle;
  types.forEach((type,index)=>{
    const row=document.createElement('div');row.className='field';
    const title=document.createElement('label');title.className='filament-preset-control';title.textContent=`Filament ${index+1} · ${type}`;
    const select=document.createElement('select');select.setAttribute('aria-label',`Filament ${index+1} preset`);
    const candidates=[...source,...imported].filter(p=>p && p.type.toUpperCase()===type.toUpperCase());
    if(target==='snapmaker') for(const cfg of U1_PROFILES.filaments.filter(p=>p.compatible_printers?.includes(`Snapmaker U1 (${diameter} nozzle)`)
      && p.filament_type?.[0]?.toUpperCase()===type.toUpperCase())) candidates.push(readFilamentProfiles({...cfg,filament_settings_id:[cfg.name]},[type])[0]);
    if(selected[index])candidates.unshift(selected[index]);
    const unique=[...new Map(candidates.map(p=>[JSON.stringify(p),p])).values()];
    const fallback=document.createElement('option');fallback.value='';fallback.textContent=target==='snapmaker'?`Generic ${type} · matched U1 profile`:`Choose Generic ${type} in the destination slicer`;
    select.append(fallback);
    unique.forEach((p,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=p.name;select.append(option);});
    const chosen=unique.findIndex(p=>JSON.stringify(p)===JSON.stringify(selected[index]));
    select.value=chosen<0?'':String(chosen);
    select.onchange=()=>onChange(index,select.value===''?null:unique[Number(select.value)]);
    title.append(select);row.append(title);host.append(row);
  });
}
