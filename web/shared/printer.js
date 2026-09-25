// U1 metadata only. Protocol reference: rendez2k/spool-studio/docs/send-to-printer.md.
export function printerOrigin(value) {
 const u=new URL(/^https?:\/\//.test(value)?value:'http://'+value);
 const ip=u.hostname.split('.').map(Number);
 const privateIp=ip.length===4 && ip.every(n=>Number.isInteger(n)&&n>=0&&n<=255) && (ip[0]===10 || ip[0]===192&&ip[1]===168 || ip[0]===172&&ip[1]>=16&&ip[1]<=31);
 if(!privateIp || !['http:','https:'].includes(u.protocol) || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw Error('Enter the printer’s private IPv4 address, with its port if needed.');
 return u.origin;
}
export function filamentSetup(reels,finishes=[]) {
 if(reels.length!==4) throw Error('Apply a four-slot palette first.');
 return reels.map((r,i)=>{
  const material=String(r.type||'').toUpperCase(), subtype=finishes[i]||'Basic';
  if(!['PLA','PETG','ABS','ASA','TPU','PA','PC','PVA','HIPS'].includes(material) || !['Basic','Matte','Silk'].includes(subtype) || !/^#[0-9a-f]{6}$/i.test(r.color)) throw Error('Each slot needs a supported material, finish and single colour.');
  return {vendor:'Generic',material,subtype,rgba:r.color.slice(1).toUpperCase()+'FF'};
 });
}
export const statusRoute='/printer/objects/query?gcode=commands&print_stats=state&idle_timeout=state&print_task_config=filament_vendor,filament_type,filament_sub_type,filament_color_rgba,filament_spool_id,filament_exist';
export function readSnapshot(info,query) {
 const s=query.result?.status,c=s?.print_task_config,commands=s?.gcode?.commands;
 if(!c || !commands) throw Error('This printer does not expose U1 filament metadata.');
 const slots=Array.from({length:4},(_,i)=>{
  const slot={vendor:c.filament_vendor?.[i],material:c.filament_type?.[i],subtype:c.filament_sub_type?.[i],rgba:c.filament_color_rgba?.[i]?.toUpperCase(),present:c.filament_exist?.[i],spoolId:c.filament_spool_id?.[i]??(info.result?.components?.includes('spoollink')?null:0)};
  if(!['vendor','material','subtype'].every(k=>typeof slot[k]==='string') || !/^[A-F0-9]{8}$/.test(slot.rgba||'') || typeof slot.present!=='boolean' || !Number.isSafeInteger(slot.spoolId) || slot.spoolId<0) throw Error('The printer returned incomplete slot data. No settings can be sent.');
  return slot;
 });
 return {slots,supported:Object.hasOwn(commands,'SET_PRINT_FILAMENT_CONFIG'),
  idle:info.result?.klippy_state==='ready'&&['standby','complete','cancelled'].includes(s.print_stats?.state)&&['Idle','Ready'].includes(s.idle_timeout?.state),state:s.print_stats?.state||'unknown'};
}
export async function inspectPrinter(request) {return readSnapshot(await request('/server/info'),await request(statusRoute));}
export function metadataCommand(channel,profile) {
 if(!Number.isInteger(channel)||channel<0||channel>3) throw Error('Invalid U1 slot.');
 const safe=filamentSetup(Array(4).fill({color:'#'+profile.rgba?.slice(0,6),type:profile.material}),Array(4).fill(profile.subtype))[0];
 if(JSON.stringify(safe)!==JSON.stringify(profile)) throw Error('Unsupported filament metadata.');
 return `SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=${channel} VENDOR='Generic' FILAMENT_TYPE='${safe.material}' FILAMENT_SUBTYPE='${safe.subtype}' FILAMENT_COLOR_RGBA=${safe.rgba}`;
}
export async function sendSetup(request,review,stillCurrent=()=>true,now=Date.now) {
 const verified=[];let attempted=null;
 try {
  if(!review.channels.length || new Set(review.channels).size!==review.channels.length) throw Error('Select at least one distinct slot.');
  for(const i of review.channels) metadataCommand(i,review.profiles[i]);
  let expected=review.before;
  for(const channel of review.channels) {
   if(!stillCurrent() || now()-review.created>60000) throw Error('The palette or review changed. Check the printer again.');
   const fresh=await inspectPrinter(request);
   if(!fresh.idle || !fresh.supported) throw Error('Printer must be ready and not printing or paused.');
   if(JSON.stringify(fresh.slots)!==JSON.stringify(expected.slots)) throw Error('Printer slots changed since review. Check again.');
   if(!fresh.slots[channel].present) throw Error(`Slot ${channel+1} has no detected filament. Load the physical reel first.`);
   if(fresh.slots[channel].spoolId!==0) throw Error(`Slot ${channel+1} has a linked Spoolman reel. Update that assignment in the printer’s filament manager first.`);
   if(!stillCurrent() || now()-review.created>60000) throw Error('Review expired. Check again.');
   attempted=channel;
   const reply=await request('/printer/gcode/script',{script:metadataCommand(channel,review.profiles[channel])});
   if(reply.result!=='ok') throw Error('Printer did not acknowledge the change.');
   expected=await inspectPrinter(request);
   if(expected.slots.some((slot,i)=>i!==channel && JSON.stringify(slot)!==JSON.stringify(fresh.slots[i]))) throw Error('Another slot changed during the send. Check all assignments before continuing.');
   if(!Object.entries(review.profiles[channel]).every(([k,v])=>expected.slots[channel][k]===v) || expected.slots[channel].spoolId!==0) throw Error('The requested settings could not be verified.');
   verified.push(channel+1);attempted=null;
  }
  return {verified,message:`Verified on U1: slot${verified.length===1?'':'s'} ${verified.join(', ')}.`,uncertain:false};
 } catch(error) {
  return {verified,uncertain:attempted!==null,message:`${verified.length?'Verified slots '+verified.join(', ')+'. ':''}${attempted!==null?'Slot '+(attempted+1)+' is uncertain; inspect the printer before sending again. ':''}${error.message}`};
 }
}
