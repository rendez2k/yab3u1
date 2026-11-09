import {colourName} from '../../web/shared/assignment.js';

/** Count actual paint on retained objects, not spare or support-only filaments. */
export function modelColours({palette=[],objects=[],quantities={},copies=1,loaded=false,checking:busy=false}={}) {
  if(!loaded)return {loaded:false,checking:false,colours:[],count:0};
  const retained=objects.filter(o=>(quantities[o.objectId]??1)*copies>0);
  const checking=Boolean(busy),uncertain=retained.some(o=>o.undecodable||!o.colours?.length);
  const used=[...new Set(retained.flatMap(o=>(o.colours||[]).map(c=>Number(c.extruder))))].sort((a,b)=>a-b);
  const grouped=new Map();
  for(const slot of used){
    const hex=palette[slot-1];if(!/^#[\da-f]{6}$/i.test(hex||''))continue;
    const colour=hex.toUpperCase();if(!grouped.has(colour))grouped.set(colour,{colour,name:colourName(colour),slots:[]});
    grouped.get(colour).slots.push(slot);
  }
  return {loaded:true,checking,uncertain:uncertain||used.some(slot=>!/^#[\da-f]{6}$/i.test(palette[slot-1]||'')),colours:[...grouped.values()],count:grouped.size,filaments:used.length};
}

export function mountModelColours({view,read,manage}) {
  const root=view.make('section',{class:'model-colour-summary',hidden:'','aria-label':'Model colours'},'<div class="model-colour-heading"><strong></strong><button type="button" data-manage-colours>Manage colours</button></div><p class="hint" data-colour-scope></p><ul class="model-colour-list"></ul>');
  view.inspector.prepend(root);root.querySelector('button').onclick=manage;let previous='';
  return {element:root,sync(){
    const data=modelColours(read()),key=JSON.stringify(data);if(key===previous)return;previous=key;root.hidden=!data.loaded;
    root.querySelector('strong').textContent=data.checking?'Checking model colours…':`${data.count}${data.uncertain?' known':''} model colour${data.count===1?'':'s'}`;
    root.querySelector('[data-colour-scope]').textContent=data.uncertain?'Some paint could not be read. Check the source in your slicer.':`Original paint · this plate${data.filaments>data.count?` · ${data.filaments} filaments`:''}`;
    const list=root.querySelector('ul');list.replaceChildren();
    for(const item of data.colours){const li=view.make('li'),chip=view.make('i',{'aria-hidden':'true'}),name=view.make('span');chip.style.backgroundColor=item.colour;name.textContent=item.name;li.title=`${item.name} ${item.colour} · source filament${item.slots.length===1?'':'s'} ${item.slots.join(', ')}`;li.append(chip,name);list.append(li);}
  }};
}
