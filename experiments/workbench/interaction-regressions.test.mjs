import test from 'node:test';
import assert from 'node:assert/strict';
import {ConvertSession,identityRule} from '../../web/shared/convertSession.js';
import {selectionUsage} from '../../web/shared/selectionUsage.js';
import {Preview} from '../../web/shared/preview.js';
import {smoothPreviewNormals} from '../../web/shared/previewNormals.js';
import {editSelection} from './object-edits.js';
import {plateHistory} from './plate-history.js';
import * as project from '../../web/shared/project.js';
const colours=['#FF8000','#000000','#FFFFFF','#008000','#FFFF00'];
const objects=colours.map((_,i)=>({objectId:String(i+1),colours:[{extruder:i+1}]}));
const usage={kept:[1,2,3,4,5],unused:[],reservedThrough:0,uncertain:false};
function session(){const s=new ConvertSession(()=>{});s.selectionAware=true;s.state={colours,types:colours.map(()=>'PLA'),filamentUsage:usage,includeUnused:[],footprints:objects};s.rules={slots:identityRule(5),repaint:identityRule(5)};return s;}
test('removing the only green object compacts five slots to four, restoring it restores five',()=>{
 const s=session();s.setLayout({quantities:{4:0}});assert.deepEqual(s.activeColourIds(),[1,2,3,5]);assert.equal(s.capacityStatus().needed,4);assert.equal(s.capacityStatus().blocked,false);assert.deepEqual(s.conversionPlan().physical.map(r=>r.color),[...colours.slice(0,3),colours[4]]);
 s.setLayout({quantities:{4:1}});assert.equal(s.conversionPlan().physical.length,5);
});
test('explicit remove repaints all uses, preserves other colours after a slot swap and rejects support dependencies',()=>{
 const s=session();s.rules.slots={1:3,2:2,3:1,4:4,5:5};s.removeFilament(4,1);assert.equal(s.conversionPlan().physical.length,4);assert.equal(s.rule[4],1);assert.equal(s.rule[3],3);assert.throws(()=>s.removeFilament(1,1),/different/);
 s.state.filamentUsage={...usage,reservedThrough:2};assert.throws(()=>s.removeFilament(1,2),/support/);
});
test('uncertain paint and numbered supports are retained when computing usage',()=>{
 assert.equal(selectionUsage(objects,{'4':0},{...usage,uncertain:true},5).kept.length,5);
 assert.deepEqual(selectionUsage(objects,{'4':0,'5':0},{...usage,reservedThrough:4},5).kept,[1,2,3,4]);
});
test('multi-select toggles, Shift adds, deleting two distinct copies preserves unrelated counts, repeated undo restores',()=>{
 const p=Object.create(Preview.prototype);Object.assign(p,{multiSelect:true,pickRanges:[{objectId:'1'},{objectId:'1'},{objectId:'2'}],selectedRanges:new Set(),requestDraw(){}});
 p.selectRange(0);p.selectRange(1,{shiftKey:true});assert.deepEqual([...p.selectedRanges],[0,1]);p.selectRange(1,{ctrlKey:true});assert.deepEqual([...p.selectedRanges],[0]);p.selectRange(1,{metaKey:true});
 let s={key:'a',objects,quantities:{},copies:3,arrangement:'objects',layout:{spacing:5},apply(p){Object.assign(s,p);}};const h=plateHistory(()=>s);h.observe();h.apply(editSelection(s,['1','1'],-1));assert.equal(s.quantities[1],1);assert.equal(s.quantities[2],3);h.apply(editSelection(s,['2'],2));assert.equal(s.quantities[2],5);h.undo();assert.equal(s.quantities[2],3);h.undo();assert.equal(s.copies,3);assert.deepEqual(s.quantities,{});
});
test('normal smoothing removes shallow facets but preserves a right-angle edge without changing geometry',()=>{
 const positions=new Float32Array([0,0,0,0,0,0,0,0,0]),before=positions.slice();const flat=new Float32Array([0,0,1,.5,0,Math.sqrt(.75),0,1,0]);const n=smoothPreviewNormals(positions,flat);assert.ok(n[0]>.2&&n[0]<.3);assert.deepEqual(Array.from(n.slice(6)),[0,1,0]);assert.deepEqual(positions,before);
});
test('actual 3MF export removes excluded geometry and its unused filament; readback keeps remaining colours',async()=>{
 const enc=new TextEncoder();const ids=[1,2,3,4,5];
 const model=`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter"><resources>${ids.map(id=>`<object id="${id}" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="10"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`).join('')}</resources><build>${ids.map(id=>`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${id*15} 0 0"/>`).join('')}</build></model>`;
 const config=`<config>${ids.map(id=>`<object id="${id}"><metadata key="name" value="Part ${id}"/><metadata key="extruder" value="${id}"/></object>`).join('')}<plate><metadata key="plater_id" value="1"/>${ids.map(id=>`<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance>`).join('')}</plate></config>`;
 const p=project.readProject(new Map([[project.MODEL_FILE,enc.encode(model)],[project.SRC_BBL_MODEL,enc.encode(config)],[project.SRC_BBL_PROJECT,enc.encode(JSON.stringify({filament_colour:colours,filament_type:colours.map(()=>'PLA')}))]]));const plate=p.plates[0].id,footprints=project.selectionFootprints(p,plate,null);const exclusive=footprints.find(o=>o.colours.length===1);assert.ok(exclusive);
 const remove=exclusive.colours[0].extruder;const quantities=Object.fromEntries(footprints.filter(o=>o.colours.some(c=>c.extruder===remove)).map(o=>[o.objectId,0]));
 const s=session();s.state={...s.state,colours:p.colors,types:p.types,filamentUsage:project.conversionUsage(p),footprints};s.setLayout({quantities});
 const built=project.convertProject(p,plate,null,{target:'snapmaker',selectionAware:true,removeUnused:true,assignmentMode:'slots',mapping:s.rule,layout:{...s.layout,tower:false}});assert.deepEqual(built.problems,[]);
 const read=project.readProject(built.entries),report=project.analyse(read,read.plates[0].id,null);assert.equal(read.colors.length,4);assert.equal(report.used.length,4);assert.ok(!read.colors.includes(p.colors[remove-1]));
});
