const paths={project:'<path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/>',colours:'<circle cx="8" cy="8" r="5"/><circle cx="16" cy="9" r="5"/><circle cx="12" cy="16" r="5"/>',paint:'<path d="m14 3 7 7-10 10H4v-7zM11 6l7 7M3 21h18"/>',split:'<path d="M3 4h7v6H3zM14 14h7v6h-7zM18 3 6 21"/>',layout:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',output:'<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'};
export function mountFeatureToolbox({view,choose}){
  const root=view.make('nav',{class:'feature-toolbox','aria-label':'Studio features'});
  // Short labels keep the rail slim; the full name is the tooltip and accessible name.
  for(const [id,[label,name]]of Object.entries({project:['Project','Open & convert'],colours:['Colours','Colours & filaments'],paint:['Paint','Paint objects'],split:['Split','Split & connect'],layout:['Plates','Plates & arrange'],output:['Settings','Print settings & printer']})){
    const button=view.make('button',{type:'button','data-feature':id,'aria-pressed':'false','aria-label':name,title:name},`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[id]}</svg><span>${label}</span>`);
    button.onclick=()=>choose(id);root.append(button);
  }
  // Explanatory paragraphs are optional; status and warning messages always stay visible.
  const doc=root.ownerDocument,tips=view.make('label',{class:'tips-toggle',title:'Show or hide explanations in the panels'},'<input type="checkbox" data-tips><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg><span>Tips</span>');
  const box=tips.querySelector('input'),read=()=>{try{return doc.defaultView.localStorage.getItem('yab3d-workbench-tips')==='on';}catch{return false;}};
  const applyTips=value=>{box.checked=value;if(doc.body)doc.body.dataset.tips=value?'on':'off';};
  box.addEventListener('change',()=>{applyTips(box.checked);try{doc.defaultView.localStorage.setItem('yab3d-workbench-tips',box.checked?'on':'off');}catch{}});
  doc.defaultView?.addEventListener?.('storage',event=>{if(event.key==='yab3d-workbench-tips')applyTips(read());});
  applyTips(read());root.append(tips);
  view.inspector.prepend(root);
  return {element:root,sync(panel,mode,busy){const active=panel==='edit'?({colour:'paint',split:'split'}[mode]||''):panel;for(const b of root.querySelectorAll('button')){b.setAttribute('aria-pressed',String(b.dataset.feature===active));b.disabled=busy;}}};
}
