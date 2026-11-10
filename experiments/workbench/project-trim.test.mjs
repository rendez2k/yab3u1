import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readZip,writeZip} from '../../web/zip.js';
import {readProject,analyse} from '../../web/shared/project.js';
import {inspectPlates,trimProject} from './project-trim.js';

const enc=new TextEncoder(),dec=new TextDecoder();
const mesh=(id,x)=>`<object id="${id}" type="model"><mesh><vertices><vertex x="${x}" y="0" z="0"/><vertex x="${x+10}" y="0" z="0"/><vertex x="${x}" y="10" z="0"/><vertex x="${x}" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1" paint_color="8"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="2" v2="0" v3="3"/></triangles></mesh></object>`;
const file=body=>enc.encode(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${body}</resources><build/></model>`);
// Three plates: A and B on their own, C sharing object B and adding an object built from an inline helper.
async function project(){
  const root=`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"><resources>
 <object id="10" type="model"><components><component p:path="/3D/Objects/a.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
 <object id="20" type="model"><components><component p:path="/3D/Objects/b.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
 <object id="30" type="model"><components><component p:path="/3D/Objects/c.model" objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
</resources><build>
 <item objectid="10" transform="1 0 0 0 1 0 0 0 1 50 50 0" printable="1"/>
 <item objectid="20" transform="1 0 0 0 1 0 0 0 1 80 50 0" printable="1"/>
 <item objectid="30" transform="1 0 0 0 1 0 0 0 1 110 50 0" printable="1"/>
</build></model>`;
  const object=(id,name,part,extruder)=>`<object id="${id}"><metadata key="name" value="${name}"/><metadata key="extruder" value="${extruder}"/><part id="${part}" subtype="normal_part"><metadata key="name" value="${name}"/><metadata key="extruder" value="${extruder}"/></part></object>`;
  const plate=(id,name,ids)=>`<plate><metadata key="plater_id" value="${id}"/><metadata key="plater_name" value="${name}"/><metadata key="thumbnail_file" value="Metadata/plate_${id}.png"/>${ids.map(o=>`<model_instance><metadata key="object_id" value="${o}"/><metadata key="instance_id" value="0"/></model_instance>`).join('')}</plate>`;
  const settings=`<?xml version="1.0" encoding="UTF-8"?><config>${object(10,'Reindeer',1,1)}${object(20,'Sleigh &amp; bells',2,2)}${object(30,'Tree',3,3)}${plate(1,'Reindeer',[10])}${plate(2,'',[20])}${plate(3,'Tree and sleigh',[30,20])}<assemble><assemble_item object_id="10" instance_id="0"/><assemble_item object_id="30" instance_id="0"/></assemble></config>`;
  const rels=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${['a','b','c'].map((n,i)=>`<Relationship Target="/3D/Objects/${n}.model" Id="rel-${i+1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`).join('')}</Relationships>`;
  return writeZip([{name:'[Content_Types].xml',data:enc.encode('<Types/>')},{name:'3D/3dmodel.model',data:enc.encode(root)},{name:'3D/_rels/3dmodel.model.rels',data:enc.encode(rels)},
    {name:'3D/Objects/a.model',data:file(mesh(1,0))},{name:'3D/Objects/b.model',data:file(mesh(2,0))},{name:'3D/Objects/c.model',data:file(mesh(3,0))},
    {name:'Metadata/model_settings.config',data:enc.encode(settings)},{name:'Metadata/project_settings.config',data:enc.encode(JSON.stringify({filament_colour:['#FF0000','#00FF00','#0000FF','#FFFFFF'],filament_type:['PLA','PLA','PLA','PLA']}))},
    {name:'Metadata/plate_1.png',data:new Uint8Array([1])},{name:'Metadata/plate_2.png',data:new Uint8Array([2])},{name:'Metadata/plate_3.png',data:new Uint8Array([3])},{name:'Metadata/plate_1.gcode',data:enc.encode('G1')}]);
}

test('plates are listed with names, objects, sizes and thumbnails without reading any model file',async()=>{
  const bytes=await project(),found=await inspectPlates(bytes);
  assert.deepEqual(found.plates.map(p=>[p.id,p.name,p.objectNames]),[['1','Reindeer',['Reindeer']],['2','',['Sleigh & bells']],['3','Tree and sleigh',['Tree','Sleigh & bells']]]);
  assert(found.plates.every(p=>p.bytes>0&&p.thumbnail?.length===1));
  // Plate 3 needs two model files, so it is the largest.
  assert(found.plates[2].bytes>found.plates[0].bytes);assert.equal(found.totalBytes,found.plates[0].bytes+found.plates[1].bytes+found.plates[2].bytes-found.plates[1].bytes);
});
test('a trimmed project holds only the chosen plates and opens as a normal project',async()=>{
  const bytes=await project(),whole=readProject(await readZip(bytes));
  assert.equal(whole.plates.length,3);
  const trimmed=await trimProject(bytes,['3']);assert.deepEqual([trimmed.plates,trimmed.objects,trimmed.files],[1,2,2]);
  const entries=await readZip(trimmed.bytes);
  assert.deepEqual([...entries.keys()].filter(n=>/Objects/.test(n)).sort(),['3D/Objects/b.model','3D/Objects/c.model']);
  assert(!entries.has('Metadata/plate_1.png'));assert(!entries.has('Metadata/plate_1.gcode'));assert(entries.has('Metadata/plate_3.png'));
  assert(!dec.decode(entries.get('3D/_rels/3dmodel.model.rels')).includes('a.model'));
  assert(!dec.decode(entries.get('Metadata/model_settings.config')).includes('object_id="10"'));
  const project2=readProject(entries);
  // The reader numbers plates by position, so the kept plate becomes the first.
  assert.deepEqual(project2.plates.map(p=>[p.name,p.objectIds.map(String)]),[['Tree and sleigh',['30','20']]]);
  // The kept objects are byte-for-byte the originals, paint included.
  const original=await readZip(bytes);
  for(const name of ['3D/Objects/b.model','3D/Objects/c.model'])assert.deepEqual(entries.get(name),original.get(name));
  assert.deepEqual(analyse(project2,project2.plates[0].id,null).used,analyse(whole,whole.plates[2].id,null).used);
});
test('several plates can be kept, and nothing is opened when none is chosen',async()=>{
  const bytes=await project(),trimmed=await trimProject(bytes,['1','2']);
  assert.deepEqual(readProject(await readZip(trimmed.bytes)).plates.map(p=>p.name),['Reindeer','']);
  await assert.rejects(trimProject(bytes,[]),/at least one plate/);await assert.rejects(trimProject(bytes,['9']),/at least one plate/);
});
test('projects that cannot be opened in parts are left to the normal loader',async()=>{
  assert.equal(await inspectPlates(new Uint8Array([1,2,3])),null);
  const single=await writeZip([{name:'3D/3dmodel.model',data:enc.encode('<model><resources/><build/></model>')},{name:'Metadata/model_settings.config',data:enc.encode('<config><plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate></config>')}]);
  assert.equal(await inspectPlates(single),null);
  // The repo's two-plate fixture keeps its geometry inside the root file for one object; it still lists.
  const fixture=new Uint8Array(readFileSync(new URL('../../web/tests/five-colours.3mf',import.meta.url))),found=await inspectPlates(fixture);
  assert.deepEqual(found.plates.map(p=>p.name),['Multicolour','Spares']);
  const kept=await trimProject(fixture,['2']),opened=readProject(await readZip(kept.bytes));
  assert.deepEqual(opened.plates.map(p=>p.name),['Spares']);
});
