const paths={project:'<path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/>',colours:'<circle cx="8" cy="8" r="5"/><circle cx="16" cy="9" r="5"/><circle cx="12" cy="16" r="5"/>',paint:'<path d="m14 3 7 7-10 10H4v-7zM11 6l7 7M3 21h18"/>',split:'<path d="M3 4h7v6H3zM14 14h7v6h-7zM18 3 6 21"/>',layout:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',output:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'};
export function mountFeatureToolbox({view,choose}){
  const root=view.make('nav',{class:'feature-toolbox','aria-label':'Studio features'});
  for(const [id,label]of Object.entries({project:'Open & convert',colours:'Colours & filaments',paint:'Paint objects',split:'Split & connect',layout:'Plates & arrange',output:'Export project'})){
    const button=view.make('button',{type:'button','data-feature':id,'aria-pressed':'false'},`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[id]}</svg><span>${label}</span>`);
    button.onclick=()=>choose(id);root.append(button);
  }
  view.inspector.prepend(root);
  return {element:root,sync(panel,mode,busy){const active=panel==='edit'?({colour:'paint',split:'split'}[mode]||''):panel;for(const b of root.querySelectorAll('button')){b.setAttribute('aria-pressed',String(b.dataset.feature===active));b.disabled=busy;}}};
}
