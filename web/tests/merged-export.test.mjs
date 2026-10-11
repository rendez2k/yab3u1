import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readZip} from '../zip.js';
import {readProject,selectionFootprints,exportProject,previewSoup,analyse,SRC_BBL_PROJECT} from '../shared/project.js';
import {exportComparisonJob} from '../shared/comparisonExport.js';
import {targetLayout} from '../shared/layout.js';
const source=()=>readZip(fs.readFileSync(new URL('./five-colours.3mf',import.meta.url))).then(readProject);
const options=p=>({target:'snapmaker',convert:true,physical:p.colors.map(color=>({color,type:'PLA'})).slice(0,4),
  mapping:Object.fromEntries(p.colors.map((_,i)=>[i+1,1])),recipes:[],carrySettings:true});
const vertices=p=>{
  const soup=previewSoup(p,p.plates[0].id,null,{},null,1e8,{full:true});
  const result=[];for(let i=0;i<soup.positions.length;i+=3)result.push([...soup.positions.slice(i,i+3)].map(n=>n.toFixed(5)).join(','));
  return result.sort();
};
test('merged copies retain world vertices, paint, unique parts and source settings',async()=>{
  const p=await source(),plate=p.plates[0].id,objects=['10'];
  p.meta.get('10').settings={layer_height:'0.16',enable_support:'1'};
  const layout=targetLayout('snapmaker',{arrangement:'objects',spacing:5,copies:3,footprints:selectionFootprints(p,plate,objects),quantities:{}});
  const opts=options(p),group={label:'Orange group',objects};
  const plain=readProject(exportProject(p,plate,objects,{...opts,layout}).entries);
  const result=exportComparisonJob(p,plate,{objects,sequence:'by object',layout,mergeGroups:[group]},opts);
  const merged=readProject(result.entries);
  assert.equal(merged.items.length,1);
  assert.deepEqual(vertices(merged),vertices(plain));
  const meta=[...merged.meta.values()][0];
  assert.equal(new Set(meta.parts.map(p=>p.id)).size,meta.parts.length);
  assert.equal(meta.settings.enable_support,'1');assert.equal(Number(meta.settings.layer_height),.16);
  assert.deepEqual(analyse(merged,merged.plates[0].id,null).used,[1]);
  assert.equal(JSON.parse(new TextDecoder().decode(result.entries.get(SRC_BBL_PROJECT))).print_sequence,'by object');
  p.meta.get('10').parts[0].subtype='negative_part';
  assert.throws(()=>exportComparisonJob(p,plate,{objects,sequence:'by object',layout,mergeGroups:[group]},opts),/modifiers|single-filament/);
});
test('merging refuses part overrides and incomplete or duplicate membership',async()=>{
  const p=await source(),plate=p.plates[0].id,objects=['10'],opts=options(p);
  const layout=targetLayout('snapmaker',{copies:1,spacing:5});
  p.meta.get('10').parts[0].settings={layer_height:'.12'};
  assert.throws(()=>exportProject(p,plate,objects,{...opts,layout,mergeGroups:[{label:'Group',objects}]}),/part-specific/);
  delete p.meta.get('10').parts[0].settings;
  assert.throws(()=>exportProject(p,plate,objects,{...opts,layout,mergeGroups:[{label:'Group',objects:[]}]}),/no printable/);
  assert.throws(()=>exportProject(p,plate,objects,{...opts,layout,mergeGroups:[{label:'Group',objects},{label:'Again',objects}]}),/more than one/);
});
test('same-colour objects with different print intent are not silently merged',async()=>{
  const p=await source(),plate=p.plates[0].id;
  const objects=selectionFootprints(p,plate,null).slice(0,2).map(o=>o.objectId);
  assert.equal(objects.length,2);
  p.meta.get(objects[0]).settings={layer_height:'0.16'};
  p.meta.get(objects[1]).settings={layer_height:'0.20'};
  assert.throws(()=>exportProject(p,plate,objects,{...options(p),layout:targetLayout('snapmaker',{copies:1,spacing:5}),
    mergeGroups:[{label:'Same colour',objects}]}),/different print settings/);
});
