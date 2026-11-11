const paths={paint:'<path d="m14 3 7 7-10 10H4v-7zM11 6l7 7M3 21h18"/>',split:'<path d="M3 4h7v6H3zM14 14h7v6h-7zM18 3 6 21"/>',layout:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'};
/** The four steps every model goes through, in order. The first three are panels; the last is the download itself. */
export const STEPS=[['project','Model','Open your model and choose the printer'],['colours','Colours','Choose how the colours print'],['output','Check','Check the result and settings'],['download','Download','Download the file for your slicer']];
const TOOLS={paint:['Paint','Paint objects'],split:['Split','Split & connect'],layout:['Plates','Plates & arrange']};
export function mountFeatureToolbox({view,choose}){
  const root=view.make('nav',{class:'feature-toolbox','aria-label':'Steps and tools'});
  const steps=view.make('ol',{class:'step-list','aria-label':'Steps'});
  STEPS.forEach(([id,label,name],index)=>{
    const item=view.make('li'),button=view.make('button',{type:'button','data-feature':id,'data-step':String(index+1),'aria-label':`Step ${index+1} of ${STEPS.length}: ${name}`,title:name},`<i class="step-dot" aria-hidden="true"><b>${index+1}</b><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></i><span>${label}</span>`);
    button.onclick=()=>choose(id);item.append(button);steps.append(item);
  });
  root.append(steps,view.make('span',{class:'rail-label','aria-hidden':'true'},'Edit'));
  const tools=view.make('div',{class:'tool-list',role:'group','aria-label':'Edit the model'});
  for(const [id,[label,name]]of Object.entries(TOOLS)){
    const button=view.make('button',{type:'button','data-feature':id,'aria-pressed':'false','aria-label':name,title:name},`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[id]}</svg><span>${label}</span>`);
    button.onclick=()=>choose(id);tools.append(button);
  }
  root.append(tools);
  // Explanatory paragraphs are optional; status and warning messages always stay visible.
  const doc=root.ownerDocument,tips=view.make('label',{class:'tips-toggle',title:'Show or hide explanations in the panels'},'<input type="checkbox" data-tips><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg><span>Tips</span>');
  const box=tips.querySelector('input'),read=()=>{try{return doc.defaultView.localStorage.getItem('yab3d-workbench-tips')==='on';}catch{return false;}};
  const applyTips=value=>{box.checked=value;if(doc.body)doc.body.dataset.tips=value?'on':'off';};
  box.addEventListener('change',()=>{applyTips(box.checked);try{doc.defaultView.localStorage.setItem('yab3d-workbench-tips',box.checked?'on':'off');}catch{}});
  doc.defaultView?.addEventListener?.('storage',event=>{if(event.key==='yab3d-workbench-tips')applyTips(read());});
  applyTips(read());root.append(tips);
  view.inspector.prepend(root);
  return {element:root,
    /** `progress`: {done:{project,colours,output}, loaded, download:{disabled}} */
    sync(panel,mode,busy,progress={}){
      const active=panel==='edit'?({colour:'paint',split:'split'}[mode]||''):panel;
      for(const b of root.querySelectorAll('button')){
        const id=b.dataset.feature,on=id===active;
        if(b.dataset.step){
          if(on)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');
          b.dataset.done=String(Boolean(progress.done?.[id]));
          b.disabled=busy||(id!=='project'&&!progress.loaded)||(id==='download'&&Boolean(progress.download?.disabled));
        }else{b.setAttribute('aria-pressed',String(on));b.disabled=busy;}
      }
    }};
}
