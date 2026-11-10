import {interfaceDemoFile} from './shared/supportInterfaceDemo.js';
import {receiveModel} from './shared/modelHandoff.js';
import {installModelDrop} from './file-drop.js';
import {createSessionStore,describeAge,plainContext,sameFile} from './session-store.js';
const $=id=>document.getElementById(id),frames=new Map();
const menu=document.createElement('details');menu.className='project-menu';menu.innerHTML='<summary>App menu</summary><div></div>';document.querySelector('.topbar').append(menu);for(const id of ['batch','help','theme'])menu.querySelector('div').append($(id));
// Open stays one click away on wide screens; narrow screens keep it in the menu.
menu.before($('open'));const menuOpen=document.createElement('button');menuOpen.type='button';menuOpen.className='menu-open';menuOpen.textContent='Open model';menuOpen.onclick=()=>$('open').click();menu.querySelector('div').prepend(menuOpen);menu.addEventListener('click',e=>{if(e.target.closest('button'))menu.open=false;});
document.querySelector('.topbar').append($('primary'));
const projects=new WeakMap();let nextProject=0;
const projectId=f=>{if(!f)return null;if(!projects.has(f))projects.set(f,++nextProject);return projects.get(f);};
let active=document.body.dataset.initial||'converter',panel='project',file=null,theme='light',changing=false;
let workspaceMode='studio',chosen=false;
try{const saved=localStorage.getItem('yab3d-workspace-choice');if(['quick','studio'].includes(saved)){workspaceMode=saved;chosen=true;}}catch{}
if(active==='spectrum'){workspaceMode='studio';chosen=true;}
const workspacePicker=document.createElement('select');workspacePicker.id='workspace-mode';workspacePicker.setAttribute('aria-label','Workspace');workspacePicker.innerHTML='<option value="">Choose workspace</option><option value="quick">Quick conversion</option><option value="studio">Full studio</option>';document.querySelector('.topbar .brand').after(workspacePicker);
function showWorkspace(){document.body.dataset.workspaceMode=workspaceMode;document.body.dataset.launch=String(!chosen);$('launch').hidden=chosen;$('engines').inert=!chosen;workspacePicker.value=chosen?workspaceMode:'';}
showWorkspace();
const dropOverlay=document.createElement('div');dropOverlay.className='workspace-drop-overlay';dropOverlay.hidden=true;dropOverlay.setAttribute('role','status');dropOverlay.innerHTML='<div><strong>Drop to open your model</strong><span>3MF · GLB · OBJ + textures in a ZIP</span></div>';document.body.append(dropOverlay);
const dropError=document.createElement('div');dropError.className='workspace-drop-error';dropError.hidden=true;dropError.innerHTML='<p role="alert"></p><button type="button" aria-label="Dismiss file import message">Dismiss</button>';document.body.append(dropError);
const clearDropError=()=>{dropError.hidden=true;dropError.querySelector('p').textContent='';};
dropError.querySelector('button').onclick=clearDropError;
const showDrop=value=>{dropOverlay.hidden=!value;if(value)clearDropError();};
const showDropError=message=>{dropError.hidden=false;dropError.querySelector('p').textContent=message.message || message;};
installModelDrop(document,{show:showDrop,load:async incoming=>{if(!chosen)await window.workbench.chooseWorkspace('quick');return (await ensure(active)).load(incoming);},error:showDropError});
try{theme=localStorage.getItem('yab3d-workbench-theme')||'light';}catch{}
if(!['light','dark'].includes(theme))theme='light';
function setTheme(value){theme=value;document.documentElement.dataset.theme=value;$('theme').textContent=value==='light'?'Dark':'Light';$('theme').setAttribute('aria-label',`Switch to ${value==='light'?'dark':'light'} interface`);for(const f of frames.values())f.api?.theme(value);try{localStorage.setItem('yab3d-workbench-theme',value);}catch{}}
function nav(value){panel=value;for(const b of document.querySelectorAll('[data-panel]')){if(b.dataset.panel===value)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}}
function modeButtons(){for(const b of document.querySelectorAll('[data-engine]'))b.setAttribute('aria-pressed',String(b.dataset.engine===active));}
const exportMenu=document.createElement('div');exportMenu.className='export-menu';exportMenu.id='export-menu';exportMenu.hidden=true;exportMenu.setAttribute('role','menu');exportMenu.setAttribute('aria-label','Export');document.body.append(exportMenu);
let exportChoices=[];
function closeExport(){if(exportMenu.hidden)return;exportMenu.hidden=true;$('primary').setAttribute('aria-expanded','false');}
function drawExport(){
  exportMenu.replaceChildren(...exportChoices.map(choice=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.disabled=choice.disabled;const label=document.createElement('strong'),hint=document.createElement('span');label.textContent=choice.label;hint.textContent=choice.hint;b.append(label,hint);b.onclick=()=>{closeExport();$('primary').focus();frames.get(active)?.api?.export(choice.id);};return b;}));
}
function showReport(r){
  if(r.kind!==active)return;$('project-title').textContent=r.title;$('workspace-status').textContent=r.status;$('primary').textContent=r.action;$('primary').disabled=r.disabled;workspacePicker.disabled=r.busy||r.pending;
  const serial=JSON.stringify(r.exports||[]),menu=(r.exports||[]).length>1;
  if(menu){$('primary').setAttribute('aria-haspopup','menu');$('primary').setAttribute('aria-controls','export-menu');if(!$('primary').hasAttribute('aria-expanded'))$('primary').setAttribute('aria-expanded','false');}
  else{closeExport();for(const name of ['aria-haspopup','aria-controls','aria-expanded'])$('primary').removeAttribute(name);}
  if(r.disabled)closeExport();
  if(serial!==JSON.stringify(exportChoices)){exportChoices=r.exports||[];if(!exportMenu.hidden)drawExport();}
}
function ensure(kind){
  if(frames.has(kind))return frames.get(kind).promise;
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const frame=document.createElement('iframe');frame.title=kind==='converter'?'Conversion workspace':'Full Spectrum workspace';frame.src=`${kind}-view.html`;frame.dataset.mounting='true';
  if(kind==='spectrum'&&new URLSearchParams(location.search).get('interface')==='petg')frame.src+='?interface=petg';
  const timer=setTimeout(()=>reject(Error('The workspace took too long to open. Reload the page to retry.')),30000);
  frames.set(kind,{frame,promise,resolve,reject,timer,api:null,file:null,report:null});$('engines').append(frame);return promise;
}
async function guard(task){try{await task();}catch(error){$('workspace-status').textContent=error.message;$('primary').disabled=true;}}
// Session restore: the last model is copied into this browser so a reload can reopen it.
const session=createSessionStore();let savedMeta=null,savedContext='';
const resume=document.createElement('div');resume.className='session-resume';resume.hidden=true;resume.setAttribute('role','region');resume.setAttribute('aria-label','Reopen your last model');resume.innerHTML='<div><strong></strong><span></span></div><button type="button" class="primary" data-resume>Reopen</button><button type="button" data-forget>Forget</button><button type="button" data-later aria-label="Not now">×</button>';document.body.append(resume);
const readContext=()=>{try{const record=frames.get(active);return record?.report?.busy||record?.report?.pending?null:plainContext(record?.api?.context());}catch{return null;}};
function rememberSource(next){
  if(!session.enabled()||!next?.size||sameFile(savedMeta,next))return;
  savedMeta={name:next.name,size:next.size,lastModified:next.lastModified};
  const context=readContext()||{};savedContext=JSON.stringify(context);
  session.save({blob:next,name:next.name,type:next.type,lastModified:next.lastModified,displayName:next.yab3dDisplayName||'',workspace:workspaceMode,context,savedAt:Date.now()});
}
setInterval(()=>{
  if(!file||!savedMeta||!session.enabled())return;
  const context=readContext();if(!context)return;
  const serial=JSON.stringify(context);if(serial===savedContext)return;
  savedContext=serial;session.saveContext(context);
},4000);
async function offerResume(){
  const record=await session.read();if(!record||file)return;
  resume.querySelector('strong').textContent=`Reopen ${record.displayName||record.name}?`;
  resume.querySelector('span').textContent=`Saved in this browser ${describeAge(record.savedAt)}. Colour assignments are not restored.`;
  resume.hidden=false;
  resume.querySelector('[data-later]').onclick=()=>{resume.hidden=true;};
  resume.querySelector('[data-forget]').onclick=async()=>{resume.hidden=true;savedMeta=null;await session.clear();$('workspace-status').textContent='Saved model removed from this browser.';};
  resume.querySelector('[data-resume]').onclick=()=>guard(async()=>{
    resume.hidden=true;
    const restored=new File([record.blob],record.name,{type:record.type||'',lastModified:record.lastModified});
    if(record.displayName)restored.yab3dDisplayName=record.displayName;
    savedMeta={name:restored.name,size:restored.size,lastModified:restored.lastModified};savedContext=JSON.stringify(record.context||{});
    if(!chosen)await window.workbench.chooseWorkspace(record.workspace==='quick'?'quick':'studio');
    const api=await ensure(active);
    // Saved settings are a convenience: if they no longer apply, open the model without them.
    try{await api.load(restored,record.context||{});}catch{await api.load(restored);}
  });
}
window.workbench={
  drag:showDrop,
  dropError:showDropError,
  ready(kind,api){const record=frames.get(kind);if(!record)return;clearTimeout(record.timer);record.api=api;api.theme(theme);api.setPanel(panel);api.setWorkspaceMode(workspaceMode);record.frame.hidden=kind!==active;delete record.frame.dataset.mounting;record.resolve(api);$('engines').querySelector('.boot')?.remove();},
  failed(kind,message){const record=frames.get(kind);if(record){clearTimeout(record.timer);record.reject(Error(message));}},
  panelChanged(kind,value){if(kind===active)nav(value);},
  report(r){const record=frames.get(r.kind);if(record)record.report=r;showReport(r);},
  sourceChanged(kind,next){const record=frames.get(kind);if(record){record.file=next;record.project=projectId(next);}if(kind===active){file=next;chosen=true;showWorkspace();clearDropError();resume.hidden=true;rememberSource(next);}},
  async chooseWorkspace(value,{open=false,remember=false}={}){
    if(!['quick','studio'].includes(value))return;
    const current=frames.get(active);if(current?.report?.busy||current?.report?.pending){$('workspace-status').textContent='Finish or cancel the current edit before changing workspace.';showWorkspace();return false;}
    if(value==='quick'&&active!=='converter'){await window.workbench.switchMode('converter');if(active!=='converter')return false;}
    workspaceMode=value;chosen=true;showWorkspace();
    if(remember)try{localStorage.setItem('yab3d-workspace-choice',value);}catch{}
    const api=await ensure(active);api.setWorkspaceMode(value);if(open)api.open();return true;
  },
  async switchMode(kind,purpose){
    if(changing)return;
    if(kind===active){if(purpose){const api=await ensure(kind);api.setPanel('output');}return;}
    const previous=frames.get(active);if(previous?.report?.busy){$('workspace-status').textContent='Wait for the current operation to finish before switching colour workflow.';return;}
    if(previous?.report?.pending){$('workspace-status').textContent='Apply or cancel the current edit before switching colour workflow.';return;}
    if(kind==='spectrum'&&previous?.api?.context().target==='orca'){
      previous.api.setPanel('project');$('workspace-status').textContent='Full Spectrum exports to Snapmaker, Bambu or Prusa. Choose one of these destinations in Project before switching.';return;
    }
    changing=true;
    await guard(async()=>{
      const options=previous?.api?.context()||{},original=previous?.api?.source()||file;
      if(previous){previous.view=previous.api.captureView();previous.file=original;previous.project=projectId(original);}
      $('workspace-status').textContent=`Opening ${kind==='spectrum'?'Full Spectrum':'Convert'}…`;
      const api=await ensure(kind);active=kind;modeButtons();
      if(kind==='spectrum'){workspaceMode='studio';chosen=true;showWorkspace();}api.setWorkspaceMode(workspaceMode);
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
  async sample(kind){await guard(async()=>{const api=await ensure(active),joint=kind==='joint';const bytes=joint?await (await import('./joint-sample.js')).jointSampleFile():await interfaceDemoFile();await api.load(new File([bytes],joint?'Colour split sample.3mf':'Four-colour support arch.3mf'));});},
};
for(const b of document.querySelectorAll('[data-panel]'))b.addEventListener('click',()=>guard(async()=>{nav(b.dataset.panel);(await ensure(active)).setPanel(panel);}));
for(const b of document.querySelectorAll('[data-engine]'))b.addEventListener('click',()=>window.workbench.switchMode(b.dataset.engine));
$('open').addEventListener('click',()=>guard(async()=>(await ensure(active)).open()));
workspacePicker.onchange=()=>guard(()=>window.workbench.chooseWorkspace(workspacePicker.value));
for(const button of document.querySelectorAll('[data-start]'))button.onclick=()=>guard(()=>window.workbench.chooseWorkspace(button.dataset.start,{open:button.dataset.start==='quick',remember:$('remember-workspace').checked}));
$('batch').addEventListener('click',()=>guard(async()=>{await window.workbench.switchMode('converter');if(active!=='converter')return;(await ensure('converter')).batch();$('primary').disabled=true;}));
$('primary').addEventListener('click',()=>{
  if(exportChoices.length<2){frames.get(active)?.api?.primary();return;}
  if(!exportMenu.hidden){closeExport();return;}
  drawExport();exportMenu.hidden=false;$('primary').setAttribute('aria-expanded','true');exportMenu.querySelector('button:not(:disabled)')?.focus();
});
// Clicks inside the workspace frame never reach this document, so blur closes the menu too.
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#export-menu,#primary'))closeExport();});
window.addEventListener('blur',closeExport);
exportMenu.addEventListener('keydown',event=>{
  const items=[...exportMenu.querySelectorAll('button:not(:disabled)')],at=items.indexOf(document.activeElement);
  if(event.key==='Escape'){event.stopPropagation();closeExport();$('primary').focus();}
  else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();items[(at+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
});
$('help').addEventListener('click',()=>$('help-dialog').showModal());
$('keep-session').checked=session.enabled();
$('keep-session').addEventListener('change',async()=>{await session.setEnabled($('keep-session').checked);if(!$('keep-session').checked){savedMeta=null;resume.hidden=true;}else if(file)rememberSource(file);});
$('integrations').addEventListener('click',()=>{$('help-dialog').close();frames.get(active)?.api?.setPanel('help');});
$('theme').addEventListener('click',()=>setTheme(theme==='light'?'dark':'light'));
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='o'){event.preventDefault();$('open').click();}else frames.get(active)?.api?.key?.(event);});
setTheme(theme);modeButtons();
await guard(()=>ensure(active));
receiveModel({mount:document.body,canReceive:()=>!file,load:async(incoming,context)=>{if(!chosen)await window.workbench.chooseWorkspace('quick');return (await ensure(active)).load(incoming,context);}});
offerResume();
