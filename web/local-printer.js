/* Run with Node.js 22+: node yab3d-local.cjs http://YOUR-U1-IP
   Serves the review app locally and permits only U1 metadata operations. */
const http=require('node:http'),crypto=require('node:crypto');
const printer=new URL(process.argv[2]||'http://invalid');
const ip=printer.hostname.split('.').map(Number);
if(!['http:','https:'].includes(printer.protocol)||printer.username||printer.password||printer.pathname!=='/'||printer.search||printer.hash||ip.length!==4||!ip.every(n=>Number.isInteger(n)&&n>=0&&n<=255)||!(ip[0]===10||ip[0]===192&&ip[1]===168||ip[0]===172&&ip[1]>=16&&ip[1]<=31))throw Error('Supply the U1 private IPv4 address, for example http://192.168.1.100');
const token=crypto.randomBytes(32).toString('hex'),port=Number(process.env.YAB3D_LOCAL_PORT||8786),origin='http://127.0.0.1:'+port;
const site='https://u1-reel-changes--yab3u1.netlify.app';
const statusRoute='/printer/objects/query?gcode=commands&print_stats=state&idle_timeout=state&print_task_config=filament_vendor,filament_type,filament_sub_type,filament_color_rgba,filament_spool_id,filament_exist';
const headers=process.env.YAB3D_PRINTER_API_KEY?{'X-Api-Key':process.env.YAB3D_PRINTER_API_KEY}:{};
let writing=false;
async function printerRequest(route,body){const res=await fetch(printer.origin+route,{redirect:'error',signal:AbortSignal.timeout(8000),method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!res.ok)throw Error('Printer request failed: '+res.status);return res.json();}
const server=http.createServer(async(req,res)=>{
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try {
  if(req.headers.host!=='127.0.0.1:'+port)return reply(403,{error:'Invalid host'});
  if(req.headers.origin&&req.headers.origin!==origin)return reply(403,{error:'Origin not allowed'});
  if(req.url==='/__printer/session'&&req.method==='GET')return reply(200,{token,printer:printer.origin});
  if(req.url.startsWith('/__printer/')) {
   if(req.headers.authorization!=='Bearer '+token)return reply(403,{error:'Local session required'});
   const route=req.url.slice('/__printer'.length);
   if(req.method==='GET'&&['/server/info',statusRoute].includes(route))return reply(200,await printerRequest(route));
   if(req.method!=='POST'||route!=='/printer/gcode/script'||req.headers['content-type']!=='application/json'||writing)return reply(409,{error:'Unsupported or busy request'});
   writing=true;
   try {
    let text='';for await(const chunk of req){text+=chunk;if(text.length>1024)throw Error('Request too large');}
    const body=JSON.parse(text),match=/^SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=([0-3]) VENDOR='Generic' FILAMENT_TYPE='(PLA|PETG|ABS|ASA|TPU|PA|PC|PVA|HIPS)' FILAMENT_SUBTYPE='(Basic|Matte|Silk)' FILAMENT_COLOR_RGBA=[A-F0-9]{6}FF$/.exec(body.script);
    if(!match)throw Error('Only supported U1 filament metadata commands are accepted');
    const info=await printerRequest('/server/info'),snapshot=await printerRequest(statusRoute),s=snapshot.result?.status,c=s?.print_task_config,slot=Number(match[1]);
    if(info.result?.klippy_state!=='ready'||!['standby','complete','cancelled'].includes(s?.print_stats?.state)||!['Idle','Ready'].includes(s?.idle_timeout?.state)||!Object.hasOwn(s?.gcode?.commands||{},'SET_PRINT_FILAMENT_CONFIG')||c?.filament_exist?.[slot]!==true||(c?.filament_spool_id?.[slot]??(info.result?.components?.includes('spoollink')?null:0))!==0)throw Error('Printer is busy, unavailable or the slot has a Spoolman assignment');
    return reply(200,await printerRequest(route,{script:body.script}));
   }finally{writing=false;}
  }
  if(req.method!=='GET')return reply(405,{error:'Read only'});
  const url=new URL(req.url,origin);
  if(!/^\/[a-zA-Z0-9_./-]*$/.test(url.pathname)||url.pathname.includes('..')||!(/\.(html|js|css|png|ico|txt)$/.test(url.pathname)||url.pathname==='/'))return reply(404,{error:'Unknown asset'});
  const file=await fetch(site+(url.pathname==='/'?'/recolour.html':url.pathname),{signal:AbortSignal.timeout(15000)});
  res.writeHead(file.status,{'Content-Type':file.headers.get('content-type')||'application/octet-stream','Cache-Control':'no-store'});res.end(Buffer.from(await file.arrayBuffer()));
 }catch{reply(502,{error:'Request failed. Check the printer and connection; a write may be uncertain.'});}
});
server.listen(port,'127.0.0.1',()=>console.log('Open '+origin+'/recolour.html — keep this terminal running. Ctrl+C stops it.'));
