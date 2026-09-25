import assert from 'node:assert/strict';
import {matchU1Profile,resolveLayerHeight} from '../shared/u1Profiles.js';
import {readProject,convertProject,exportProject,SRC_BBL_PROJECT} from '../shared/project.js';
const enc=new TextEncoder(),dec=new TextDecoder();
function fixture(){return readProject(new Map([
 ['3D/3dmodel.model',enc.encode('<model unit="millimeter"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="5"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>')],
 ['Metadata/model_settings.config',enc.encode('<config><object id="1"><metadata key="layer_height" value="0.12"/><metadata key="sparse_infill_density" value="7%"/></object></config>')],
 [SRC_BBL_PROJECT,enc.encode(JSON.stringify({filament_colour:['#FFFFFF'],filament_type:['PLA'],nozzle_diameter:['0.4'],layer_height:'0.16',initial_layer_print_height:'0.25'}))]
]));}
for(const nozzle of ['0.2','0.4','0.6','0.8'])for(const mode of ['preserve','preset','custom'])for(const carry of [true,false]) {
 const choice={mode,value:String(Number(nozzle)/2)};
 const src=fixture(),match=matchU1Profile(src.sourceSettings,nozzle,{carry,layerHeight:choice});
 const expected=resolveLayerHeight(src.sourceSettings,match,choice);
 const objectExpected=resolveLayerHeight({...src.sourceSettings,...src.meta.get('1').settings},match,choice);
 const result=convertProject(src,1,null,{target:'snapmaker',u1Nozzle:nozzle,carrySettings:carry,layerHeight:choice});
 assert.deepEqual(result.problems,[]);
 const config=JSON.parse(dec.decode(result.entries.get(SRC_BBL_PROJECT)));
 assert.equal(Number(config.layer_height),expected.height);
 assert.ok(Number(config.initial_layer_print_height)<=match.maxLayer);
 const again=readProject(result.entries);
 const object=[...again.meta.values()][0];
 assert.equal(Number(object.settings.layer_height),objectExpected.height,'object override must agree with review');
 if(!carry)assert.equal(object.settings.sparse_infill_density,undefined,'height choice must not restore other opted-out settings');
 assert.ok(result.settings.notes.includes(expected.text));
}
const source=fixture();
for(const value of ['',0,-1,'NaN','0.20','0.015'])assert.throws(()=>convertProject(source,1,null,{target:'snapmaker',u1Nozzle:'0.2',layerHeight:{mode:'custom',value}}),/Custom layer height/);
const match=matchU1Profile({},'0.2');
assert.equal(resolveLayerHeight({layer_height:'0.1'},match).height,.1);
assert.match(resolveLayerHeight({layer_height:'0.2'},match).reason,/outside/);
assert.match(resolveLayerHeight({},match).reason,/unspecified/);
assert.throws(()=>resolveLayerHeight({},match,{mode:'unknown'}),/mode/);
// Full Spectrum uses the recolour exporter and must retain native blends while
// applying the same regular-layer choice to project and object settings.
for(const mode of ['preserve','preset','custom']) {
 const src=fixture(),choice={mode,value:'0.12'},match=matchU1Profile(src.sourceSettings,'0.4',{blends:true,layerHeight:choice});
 const result=exportProject(src,1,null,{target:'snapmaker',u1Nozzle:'0.4',
  reels:['#000000','#FFFFFF','#FF0000','#0000FF'].map(color=>({color,type:'PLA'})),
  mapping:{1:5},recipes:[{a:1,b:2,percent:50,model:'PLA'}],layerHeight:choice});
 assert.deepEqual(result.problems,[]);
 const config=JSON.parse(dec.decode(result.entries.get(SRC_BBL_PROJECT)));
 assert.equal(Number(config.layer_height),resolveLayerHeight(src.sourceSettings,match,choice).height);
 const metadata=dec.decode(result.entries.get('Metadata/model_settings.config'));
 const height=resolveLayerHeight({...src.sourceSettings,...src.meta.get('1').settings},match,choice).height;
 assert(metadata.includes(`key="layer_height" value="${height}"`),'Full Spectrum object override follows the chosen height');
}
console.log('PASS 24 nozzle/mode/carry combinations: preview/export agreement, object overrides, first-layer limits and invalid custom heights');
