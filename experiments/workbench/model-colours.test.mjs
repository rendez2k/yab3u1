import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {modelColours,mountModelColours} from './model-colours.js';
import {mountFeatureToolbox} from './feature-toolbox.js';

test('colour count excludes unused filament slots, removed objects and duplicate swatches',()=>{
  const state={loaded:true,palette:['#008000','#8000FF','#000000','#FFFFFF','#ffffff','#FF0000'],objects:[{objectId:'1',colours:[1,2,3,4].map(extruder=>({extruder}))},{objectId:'2',colours:[{extruder:5}]},{objectId:'3',colours:[{extruder:6}]}],quantities:{3:0},copies:2};
  const out=modelColours(state);assert.equal(out.count,4);assert.equal(out.filaments,5);assert.equal(out.checking,false);assert.deepEqual(out.colours[3].slots,[4,5]);
  assert.equal(modelColours({...state,copies:0}).count,0);assert.equal(modelColours({...state,objects:[]}).checking,false);
  assert.equal(modelColours({...state,checking:true}).checking,true);assert.equal(modelColours({...state,loaded:false}).loaded,false);
  const unreadable=modelColours({...state,objects:[{objectId:'uncertain',undecodable:1,colours:[{extruder:1}]}]});
  assert.equal(unreadable.uncertain,true);assert.equal(unreadable.checking,false);
});
test('colour summary updates with the plate and the visible toolbox opens every feature',()=>{
  const {document}=parseHTML('<aside></aside>'),view={inspector:document.querySelector('aside'),make(tag,attrs={},html=''){const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;}};
  let state={loaded:false},chosen='';
  const toolbox=mountFeatureToolbox({view,choose:id=>chosen=id}),summary=mountModelColours({view,read:()=>state,manage:()=>chosen='colours'});
  summary.sync();assert(summary.element.hidden);
  state={loaded:true,palette:['#008000','#8000FF','#000000','#FFFFFF'],objects:[{objectId:'alien',colours:[1,2,3,4].map(extruder=>({extruder}))}]};summary.sync();
  assert.equal(summary.element.querySelector('strong').textContent,'4 model colours');assert.equal(summary.element.querySelectorAll('li').length,4);
  state={...state,objects:[{objectId:'other',colours:[{extruder:1}]}]};summary.sync();assert.equal(summary.element.querySelector('strong').textContent,'1 model colour');
  for(const b of toolbox.element.querySelectorAll('button')){b.click();assert.equal(chosen,b.dataset.feature);}
  toolbox.sync('edit','split',false);assert.equal(toolbox.element.querySelector('[aria-pressed=true]').dataset.feature,'split');
  toolbox.sync('project','select',true);assert([...toolbox.element.querySelectorAll('button')].every(b=>b.disabled));
  summary.element.querySelector('button').click();assert.equal(chosen,'colours');
});
