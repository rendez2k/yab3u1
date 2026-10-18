import {interfaceDemoFile} from './shared/supportInterfaceDemo.js';
import {receiveModel} from './shared/modelHandoff.js';
const $=id=>document.getElementById(id),frames=new Map();
const menu=document.createElement('details');menu.className='project-menu';menu.innerHTML='<summary>App menu</summary><div></div>';document.querySelector('.topbar').append(menu);for(const id of ['open','batch','help','theme'])menu.querySelector('div').append($(id));menu.addEventListener('click',e=>{if(e.target.closest('button'))menu.open=false;});
document.querySelector('.topbar').append($('primary'));
const projects=new WeakMap();let nextProject=0;
const projectId=f=>{if(!f)return null;if(!projects.has(f))projects.set(f,++nextProject);return projects.get(f);};
let active=document.body.dataset.initial||'converter',panel='project',file=null,theme='light',changing=false;
try{theme=localStorage.getItem('yab3d-workbench-theme')||'light';}catch{}
if(!['light','dark'].includes(theme))theme='light';
function setTheme(value){theme=value;document.documentElement.dataset.theme=value;$('theme').textContent=value==='light'?'Dark':'Light';$('theme').setAttribute('aria-label',`Switch to ${value==='light'?'dark':'light'} interface`);for(const f of frames.values())f.api?.theme(value);try{localStorage.setItem('yab3d-workbench-theme',value);}catch{}}
function nav(value){panel=value;for(const b of document.querySelectorAll('[data-panel]')){if(b.dataset.panel===value)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}}
function modeButtons(){for(const b of document.querySelectorAll('[data-engine]'))b.setAttribute('aria-pressed',String(b.dataset.engine===active));}
function showReport(r){if(r.kind!==active)return;$('project-title').textContent=r.title;$('workspace-status').textContent=r.status;$('primary').textContent=r.action;$('primary').disabled=r.disabled;}
function ensure(kind){
  if(frames.has(kind))return frames.get(kind).promise;
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const frame=document.createElement('iframe');frame.title=kind==='converter'?'Conversion workspace':'Full Spectrum workspace';frame.src=`${kind}-view.html`;frame.hidden=kind!==active;
  if(kind==='spectrum'&&new URLSearchParams(location.search).get('interface')==='petg')frame.src+='?interface=petg';
  const timer=setTimeout(()=>reject(Error('The workspace took too long to open. Reload the page to retry.')),30000);
  frames.set(kind,{frame,promise,resolve,reject,timer,api:null,file:null,report:null});$('engines').append(frame);return promise;
}
async function guard(task){try{await task();}catch(error){$('workspace-status').textContent=error.message;$('primary').disabled=true;}}
window.workbench={
  ready(kind,api){const record=frames.get(kind);if(!record)return;clearTimeout(record.timer);record.api=api;api.theme(theme);api.setPanel(panel);record.resolve(api);$('engines').querySelector('.boot')?.remove();},
  failed(kind,message){const record=frames.get(kind);if(record){clearTimeout(record.timer);record.reject(Error(message));}},
  panelChanged(kind,value){if(kind===active)nav(value);},
  report(r){const record=frames.get(r.kind);if(record)record.report=r;showReport(r);},
  sourceChanged(kind,next){const record=frames.get(kind);if(record){record.file=next;record.project=projectId(next);}if(kind===active)file=next;},
  async switchMode(kind,purpose){
    if(changing)return;
    if(kind===active){if(purpose){const api=await ensure(kind);api.setPanel('output');}return;}
    const previous=frames.get(active);if(previous?.report?.busy){$('workspace-status').textContent='Wait for the current operation to finish before switching colour workflow.';return;}
    if(kind==='spectrum'&&previous?.api?.context().target==='orca'){
      previous.api.setPanel('project');$('workspace-status').textContent='Full Spectrum exports to Snapmaker, Bambu or Prusa. Choose one of these destinations in Project before switching.';return;
    }
    changing=true;
    await guard(async()=>{
      const options=previous?.api?.context()||{},original=previous?.api?.source()||file;
      if(previous){previous.view=previous.api.captureView();previous.file=original;previous.project=projectId(original);}
      $('workspace-status').textContent=`Opening ${kind==='spectrum'?'Full Spectrum':'Convert'}…`;
      const api=await ensure(kind);active=kind;modeButtons();
      for(const [key,r]of frames)r.frame.hidden=key!==kind;
      const destination=frames.get(kind);
      if(original&&destination.project!==projectId(original)){
        if(await api.load(original,{...options,fromMode:true,purpose})){
          const loaded=api.source();if(loaded)projects.set(loaded,projectId(original));destination.project=projectId(original);destination.file=loaded;
        }
      }else api.restoreView(destination.view);
      const r=frames.get(kind).report;if(r)showReport(r);
    });changing=false;
  },
  async sample(){await guard(async()=>{const api=await ensure(active);await api.load(new File([await interfaceDemoFile()],'Four-colour support arch.3mf'));});},
};
for(const b of document.querySelectorAll('[data-panel]'))b.addEventListener('click',()=>guard(async()=>{nav(b.dataset.panel);(await ensure(active)).setPanel(panel);}));
for(const b of document.querySelectorAll('[data-engine]'))b.addEventListener('click',()=>window.workbench.switchMode(b.dataset.engine));
$('open').addEventListener('click',()=>guard(async()=>(await ensure(active)).open()));
$('batch').addEventListener('click',()=>guard(async()=>{await window.workbench.switchMode('converter');if(active!=='converter')return;(await ensure('converter')).batch();$('primary').disabled=true;}));
$('primary').addEventListener('click',()=>frames.get(active)?.api?.primary());
$('help').addEventListener('click',()=>$('help-dialog').showModal());
$('integrations').addEventListener('click',()=>{$('help-dialog').close();frames.get(active)?.api?.setPanel('help');});
$('theme').addEventListener('click',()=>setTheme(theme==='light'?'dark':'light'));
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='o'){event.preventDefault();$('open').click();}else frames.get(active)?.api?.key?.(event);});
setTheme(theme);modeButtons();
await guard(()=>ensure(active));
receiveModel({mount:document.body,canReceive:()=>!file,load:async(incoming,context)=>(await ensure(active)).load(incoming,context)});
