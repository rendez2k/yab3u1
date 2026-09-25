import {filamentSetup} from './printer.js';

// Only palette colours travel between tabs. Authentication and printer access stay in Spool Studio.
export function openPrinterBridge({host=window,reels,status,done=()=>{}}) {
 const origin='https://spool-studio.uk';
 const allowed=['https://yab3d.uk','https://yab3u1.netlify.app','https://u1-reel-changes--yab3u1.netlify.app'];
 if(!allowed.includes(host.location.origin)){status('Connection unavailable','Open the YAB3D website or review build to use Spool Studio Bridge.');done();return ()=>{};}
 let palette;
 try{palette=filamentSetup(reels).map(p=>({color:'#'+p.rgba.slice(0,6),material:p.material}));}
 catch(error){status('Palette needed',error.message);done();return ()=>{};}
 const token=Array.from(host.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
 const url=new URL('/printer.html',origin);url.hash=new URLSearchParams({'yab3d-printer':token,sender:host.location.origin});
 const popup=host.open(url.href,'_blank');
 if(!popup){status('Allow pop-ups','Allow this site to open Spool Studio, then try again.');done();return ()=>{};}
 let active=true,received=false,timer,poll;const results=new Map();
 const post=(type,extra={})=>popup.postMessage({type:'yab3d-printer:'+type,version:1,token,...extra},origin);
 function finish(title,message,cancel=false){
  if(!active)return;active=false;host.removeEventListener('message',listener);host.removeEventListener('pagehide',pagehide);host.clearTimeout(timer);host.clearInterval(poll);
  if(cancel)try{post('cancel')}catch{}
  status(title,message);done();
 }
 function listener(event){
  const data=event.data;
  if(!active||event.source!==popup||event.origin!==origin||data?.version!==1||data.token!==token)return;
  if(data.type==='yab3d-printer:ready'&&!received){post('palette',{palette});}
  if(data.type==='yab3d-printer:received'&&!received){
   received=true;host.clearTimeout(timer);timer=host.setTimeout(()=>finish('Review session ended','Reopen Spool Studio to review again. Check its Latest request for any pending result.',true),20*60*1000);
   status('Palette opened in Spool Studio','Your four slots are ready to review through the existing bridge. Choose each slot and confirm its actual reel there. Nothing has been sent by this handoff.');
  }
  if(data.type==='yab3d-printer:progress'&&received&&Number.isInteger(data.slot)&&data.slot>=1&&data.slot<=4&&['queued','executing','verified','blocked','uncertain','cancelled','expired'].includes(data.state)&&typeof data.exact==='boolean'){
   results.set(data.slot,data);
   const descriptions={queued:'waiting for bridge',executing:'sending; awaiting verification',verified:'verified on U1',blocked:'blocked; check Spool Studio',uncertain:'not verified; check printer before retrying',cancelled:'cancelled',expired:'expired'};
   const allExact=results.size===4&&[...results.values()].every(r=>r.state==='verified'&&r.exact);
   status(allExact?'All four slots verified on U1':'Spool Studio printer updates',[...results.values()].sort((a,b)=>a.slot-b.slot).map(r=>`Slot ${r.slot}: ${descriptions[r.state]}${!r.exact?' (different library colour or material)':''}.`).join(' '));
  }
  if(data.type==='yab3d-printer:error')finish('Spool Studio connection ended',typeof data.message==='string'?data.message.slice(0,240):'Reopen Spool Studio and try again.');
 }
 const pagehide=()=>finish('Review session ended','Check Spool Studio for any already-submitted requests.',true);
 host.addEventListener('message',listener);host.addEventListener('pagehide',pagehide);
 timer=host.setTimeout(()=>finish('Spool Studio did not connect','Sign in to Spool Studio, then reopen this connection. Nothing was sent by the handoff.',true),120000);
 poll=host.setInterval(()=>{if(popup.closed)finish('Spool Studio tab closed','Check Spool Studio’s Latest request for any pending result. Reopen it to review more slots.');},1000);
 status('Opening your existing bridge','Sign in to Spool Studio if needed. Your palette will appear there for review; no new launcher or printer key is needed.');
 return ()=>finish('Palette handoff cancelled','Reopen with your current palette. Any request already confirmed in Spool Studio may still finish.',true);
}
