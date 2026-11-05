import {blendCapabilities,validateRecipe,recipeParts,recipeColour,recipeLabel} from './blendRecipes.js';
import {colourName} from './assignment.js';
import {FDM_MODEL} from './fdmMix.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mountBlendEditor(host, api) {
  host.innerHTML=`<summary>Create or edit a blend</summary><div class="blend-editor-body">
    <p class="hint">Choose a painted colour to replace. Your physical filaments stay in their slots.</p>
    <label>Model colour<select data-blend-source aria-label="Model colour"></select></label>
    <div data-blend-fields></div>
    <p class="hint" data-blend-capability></p>
    <p class="blend-feedback" data-blend-error role="status" aria-live="polite"></p>
    <div class="blend-actions"><button type="button" class="primary" data-blend-apply>Apply blend</button><button type="button" data-blend-reset>Use suggestion</button><button type="button" data-blend-undo>Undo blend</button></div>
    <p class="hint" data-blend-status role="status" aria-live="polite"></p></div>`;
  const $=q=>host.querySelector(q);let signature='',source='',draft=null;
  const context=()=>api.read();
  const choices=()=>context().reels.map((r,i)=>({...r,slot:i+1})).filter(r=>r.role!=='support-interface');
  function selectSource() {
    const c=context(),saved=c.manual[source]||c.current[source];
    const first=choices()[0],second=choices().find(r=>r.slot!==first?.slot&&r.type===first.type);
    draft=saved?structuredClone(saved):{a:first?.slot||1,b:second?.slot||2,percent:50,model:FDM_MODEL};
    delete draft.measuredColor;draw();
  }
  function draw() {
    if(!draft)return;
    const c=context(),caps=blendCapabilities(c.target),parts=recipeParts(draft);
    $('[data-blend-fields]').innerHTML=`<div class="blend-ingredients">${parts.map((p,i)=>`<div class="blend-ingredient${draft.gradient?' gradient-ingredient':''}"><label>Filament ${i+1}<select data-ingredient="${i}" aria-label="Filament ${i+1}">${choices().map(r=>`<option value="${r.slot}"${r.slot===p.slot?' selected':''}>${r.slot} · ${esc(r.name||colourName(r.color))}</option>`).join('')}</select></label><label${draft.gradient?' hidden':''}>Share (%)<input aria-label="Filament ${i+1} share (%)" type="number" min="1" max="99" step="1" data-share="${i}" value="${p.percent}"${draft.gradient?' disabled':''}></label></div>`).join('')}</div>
      <button type="button" data-third${!caps.third&&!draft.c?' disabled':''}${draft.gradient?' hidden':''}>${draft.c?'Remove third filament':'Add third filament'}</button>
      <label class="check blend-gradient"><input type="checkbox" data-gradient${draft.gradient?' checked':''}${(!caps.gradient&&!draft.gradient)||draft.c?' disabled':''}>Gradient from bottom to top</label>
      ${draft.gradient?`<div class="blend-gradient-settings"><p class="hint">Share of slot ${draft.a}; slot ${draft.b} supplies the remainder.</p><div class="blend-endpoints"><label>Bottom (%)<input data-gradient-start type="number" min="10" max="90" value="${draft.gradient.start}"></label><label>Top (%)<input data-gradient-end type="number" min="10" max="90" value="${draft.gradient.end}"></label></div><button type="button" data-reverse>Reverse direction</button><label>Transition<select data-curve><option value="linear"${draft.gradient.curve==='linear'?' selected':''}>Linear</option><option value="smooth"${draft.gradient.curve==='smooth'?' selected':''}>Smooth start and finish</option></select></label><label class="check"><input data-per-part type="checkbox"${draft.gradient.perPart?' checked':''}>Restart for each part</label><p class="hint">Mixed Colour Sublayer will be enabled. The model preview shows the midpoint shade; inspect the vertical transition in OrcaSlicer.</p></div>`:''}
      <div class="blend-estimate"><span data-blend-swatch></span><div><strong>${draft.gradient?'Estimated transition · bottom → top':'Estimated blend'}</strong><p data-blend-description></p></div></div>
      <p class="hint">Not measured for your reels. Opacity, wall thickness and layer height affect the printed colour.</p>`;
    $('[data-blend-capability]').textContent=caps.gradient?'OrcaSlicer 2.5 RC: two or three filaments; gradients use two.':caps.third?'Bambu Studio: two or three filaments. Choose OrcaSlicer 2.5 for gradient controls.':'This output supports two-filament recipes. Choose OrcaSlicer 2.5 in Project for three filaments and gradients.';
    update();
  }
  function readFields() {
    const slots=[...host.querySelectorAll('[data-ingredient]')].map(el=>Number(el.value));
    const shares=[...host.querySelectorAll('[data-share]')].map(el=>Number(el.value));
    draft={a:slots[0],b:slots[1],percent:shares[1],model:FDM_MODEL,...(slots.length===3?{c:slots[2],percentC:shares[2]}:{}),...(draft.gradient?{gradient:{start:Number($('[data-gradient-start]').value),end:Number($('[data-gradient-end]').value),curve:$('[data-curve]').value,perPart:$('[data-per-part]').checked}}:{})};
    return shares;
  }
  function update() {
    if(!draft)return;
    const c=context();let error='';
    try{
      if(c.blocked)throw Error(c.blocked);
      validateRecipe(draft,c.reels.length,c.target);
      const shares=[...host.querySelectorAll('[data-share]')].map(el=>Number(el.value));
      if(!draft.gradient&&shares.reduce((a,b)=>a+b,0)!==100)throw Error(`Shares total ${shares.reduce((a,b)=>a+b,0)}%. Adjust them to 100%.`);
      const parts=recipeParts(draft),type=c.reels[draft.a-1]?.type||'PLA';
      if(parts.some(p=>(c.reels[p.slot-1]?.type||'PLA')!==type||c.reels[p.slot-1]?.role==='support-interface'))throw Error('Choose filaments of the same material. Support filament is reserved.');
      const colours=c.reels.map(r=>r.color),swatch=$('[data-blend-swatch]');
      swatch.style.background=draft.gradient?`linear-gradient(to right,${[0,.25,.5,.75,1].map(t=>recipeColour(draft,colours,t)).join(',')})`:recipeColour(draft,colours);
      $('[data-blend-description]').textContent=recipeLabel(draft);
    }catch(e){error=e.message;$('[data-blend-description]').textContent='Complete the recipe to see its estimate.';$('[data-blend-swatch]').style.background='transparent';}
    $('[data-blend-error]').textContent=error;
    $('[data-blend-apply]').disabled=Boolean(error);
    $('[data-blend-reset]').disabled=Boolean(c.blocked)||!c.manual[source];
    $('[data-blend-undo]').disabled=Boolean(c.busy)||!c.canUndo;
  }
  host.addEventListener('input',event=>{
    if(!event.target.matches('[data-share],[data-gradient-start],[data-gradient-end]'))return;
    if(event.target.matches('[data-share]')&&!draft.c){const i=Number(event.target.dataset.share);$(`[data-share="${1-i}"]`).value=100-Number(event.target.value);}
    readFields();update();
  });
  host.addEventListener('change',event=>{
    if(event.target.matches('[data-blend-source]')){source=event.target.value;selectSource();}
    else if(event.target.matches('[data-gradient]')){if(event.target.checked)draft.gradient={start:90,end:10,curve:'linear',perPart:true};else delete draft.gradient;draw();}
    else if(event.target.matches('[data-ingredient],[data-curve],[data-per-part]')){readFields();update();}
  });
  host.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    try{
      if(b.matches('[data-third]')){
        if(draft.c){delete draft.c;delete draft.percentC;draft.percent=50;}
        else {const next=choices().find(r=>![draft.a,draft.b].includes(r.slot)&&r.type===context().reels[draft.a-1]?.type);if(!next)throw Error('Add another filament of the same material before creating a three-filament blend.');draft.c=next.slot;draft.percent=33;draft.percentC=33;}
        draw();
      }
      if(b.matches('[data-reverse]')){[draft.gradient.start,draft.gradient.end]=[draft.gradient.end,draft.gradient.start];draw();}
      if(b.matches('[data-blend-apply]')){readFields();api.apply(source,draft);$('[data-blend-status]').textContent='Blend applied to this painted colour. Undo restores the previous recipe.';}
      if(b.matches('[data-blend-reset]')){api.apply(source,null);selectSource();$('[data-blend-status]').textContent='Automatic suggestion restored for this colour.';}
      if(b.matches('[data-blend-undo]')){api.undo();selectSource();$('[data-blend-status]').textContent='Previous blend restored.';}
    }catch(e){$('[data-blend-error]').textContent=e.message;}
  });
  return {render(){const c=context();host.hidden=!Object.keys(c.sources).length;
    const next=JSON.stringify([c.key,c.sources,c.target,c.manual]);
    if(next!==signature){signature=next;if(!(source in c.sources))source=Object.keys(c.sources)[0]||'';
      $('[data-blend-source]').innerHTML=Object.entries(c.sources).map(([id,color])=>`<option value="${id}"${id===source?' selected':''}>${esc(colourName(color))} · colour ${id}</option>`).join('');
      selectSource();
    }else update();
  }};
}
