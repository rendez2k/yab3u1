import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as p from '../shared/project.js';
import {editProject} from '../../experiments/workbench/model-edit.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const read = entries => p.readProject(entries, {allowNegative:true, allowModifiers:true});
const settings = {sparse_infill_density:'12%', skin_infill_density:'12%', skeleton_infill_density:'12%', wall_loops:'3'};
const metadata = obj => Object.entries(obj).map(([key,value]) => `<metadata key="${key}" value="${value}"/>`).join('');
const mesh = (id,z,paint='') => `<object id="${id}" type="model"><mesh><vertices><vertex x="0" y="0" z="${z}"/><vertex x="10" y="0" z="${z}"/><vertex x="0" y="10" z="${z+10}"/></vertices><triangles><triangle v1="0" v2="1" v3="2"${paint}/></triangles></mesh></object>`;
function fixture(overrides=settings) {
  return new Map([
    [p.MODEL_FILE, enc.encode('<model unit="millimeter"><resources><object id="9" type="model"><components><component objectid="2" p:path="/3D/Objects/parts.model" transform="1 0 0 0 1 0 0 0 1 2 3 -50"/><component objectid="1" p:path="/3D/Objects/parts.model"/></components></object><object id="10" type="model"><components><component objectid="1" p:path="/3D/Objects/parts.model"/></components></object></resources><build><item objectid="9"/><item objectid="10" transform="1 0 0 0 1 0 0 0 1 300 0 0"/></build></model>')],
    ['3D/Objects/parts.model', enc.encode(`<model unit="millimeter"><resources>${mesh(1,0)}${mesh(2,-20,' paint_color="FF"')}</resources></model>`)],
    [p.SRC_BBL_MODEL, enc.encode(`<config><object id="9"><metadata key="name" value="modified hand"/><metadata key="extruder" value="2"/><part id="2" subtype="modifier_part"><metadata key="name" value="local infill"/>${metadata(overrides)}</part><part id="1" subtype="normal_part"><metadata key="name" value="hand"/></part></object><object id="10"><metadata key="name" value="other plate"/><metadata key="extruder" value="2"/><part id="1" subtype="normal_part"/></object><plate><metadata key="plater_name" value="Hands"/><model_instance><metadata key="object_id" value="9"/><metadata key="instance_id" value="0"/></model_instance></plate><plate><metadata key="plater_name" value="Other"/><model_instance><metadata key="object_id" value="10"/><metadata key="instance_id" value="0"/></model_instance></plate></config>`)],
    [p.SRC_BBL_PROJECT, enc.encode(JSON.stringify({filament_colour:['#FFFFFF','#00AACC'],filament_type:['PLA','PLA']}))],
  ]);
}

test('native modifier opening is explicit and validates every override', () => {
  assert.throws(()=>p.readProject(fixture(),{allowNegative:true}), /modifier_part/);
  const model=read(fixture());
  assert.equal(p.hasModifierVolumes(model),true);
  assert.equal(p.hasModifierVolumes(model,['10']),false);
  assert.deepEqual(model.meta.get('9').parts[0].settings,settings);
  assert.match(model.warnings.join(' '),/1 settings modifier retained/);
  for(const override of [{unknown_setting:'2'},{sparse_infill_density:'101%'},{wall_loops:'1.5'},{extruder:'1'},{machine_start_gcode:'G28'}])
    assert.throws(()=>read(fixture(override)), /cannot yet be preserved/);
  const reordered=fixture({extruder:'1'});
  reordered.set(p.SRC_BBL_MODEL,enc.encode(dec.decode(reordered.get(p.SRC_BBL_MODEL))
    .replace('<metadata key="extruder" value="1"/>','<metadata value="1" key="extruder"></metadata>')));
  assert.throws(()=>read(reordered), /cannot yet be preserved/, 'attribute order cannot hide a filament override');
});

test('modifiers do not add visible geometry, bounds, colours or separate objects', () => {
  const model=read(fixture());
  assert.equal(p.previewSoup(model,1,null,{},null).triangles,1);
  assert.equal(p.selectionBounds(model,1,null).min[2],0);
  assert.deepEqual(p.analyse(model,1,null).used,[2]);
  assert.equal(p.conversionUsage(model).uncertain,false);
  assert.equal(p.selectionInstances(model,1,null).length,1);
});

for(const target of ['snapmaker','bambu','orca']) for(const convert of [true,false]) {
  test(`${target} ${convert?'conversion':'recolour'} preserves modifiers, settings and transforms on every copy`, () => {
    const model=read(fixture());
    const options={target,carrySettings:false,preserveSourceSettings:false,layout:{copies:2,spacing:5,width:270,depth:270,tower:false}};
    const output=convert ? p.convertProject(model,1,null,{...options,removeUnused:true})
      : p.exportProject(model,1,null,{...options,reels:[{color:'#FF0000',type:'PLA'}],mapping:{2:1}});
    assert.deepEqual(output.problems,[]);
    const again=read(output.entries);
    assert.equal(again.plates.length,1);
    assert.equal(p.selectionInstances(again,1,null).length,2);
    for(const meta of again.meta.values()) {
      assert.equal(meta.name,'modified hand');
      assert.equal(meta.extruder,output.mapping[2],'root inherits the printable part, even with a modifier first');
      const modifier=meta.parts.find(part=>part.subtype==='modifier_part');
      assert.ok(modifier);
      assert.equal(modifier.extruder,null,'modifier must inherit the parent filament');
      assert.deepEqual(modifier.settings,settings,'semantic overrides survive even if global carry is disabled');
    }
    for(const object of again.objects.values()) if(object.components.length)
      assert.equal(object.components[0].transform,'1 0 0 0 1 0 0 0 1 2 3 -50');
    assert.equal(p.selectionBounds(again,1,null).min[2],0);
    assert.ok(!dec.decode(output.entries.get('3D/Objects/parts.model')).includes('paint_color="FF"'));
  });
}

test('unsupported export and geometry edits stop without removing modifiers', () => {
  const input=fixture(), model=read(input), before=dec.decode(input.get(p.SRC_BBL_MODEL));
  assert.throws(()=>p.convertProject(model,1,null,{target:'prusa'}),/settings modifiers/);
  assert.throws(()=>editProject(input,{plateId:1,objectIds:['9'],operation:'colour',colour:'#FF0000'}),/settings modifier/);
  assert.throws(()=>editProject(input,{plateId:1,objectIds:['9'],operation:'cut'}),/modifier/);
  assert.equal(dec.decode(input.get(p.SRC_BBL_MODEL)),before);
  const other=p.convertProject(model,2,null,{target:'prusa'});
  assert.deepEqual(other.problems,[],'an unrelated plate has no modifier export restriction');
  const edited=editProject(input,{plateId:2,objectIds:['10'],operation:'colour',colour:'#FF0000'});
  assert.ok(read(edited.entries).meta.get('9').parts.some(part=>part.subtype==='modifier_part'));
});
