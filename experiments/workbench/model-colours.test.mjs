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
test('the rail lists the four steps in order, then the editing tools, and offers a Tips switch',()=>{
  const {document}=parseHTML('<html><body><aside></aside></body></html>'),view={inspector:document.querySelector('aside'),make(tag,attrs={},html=''){const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.innerHTML=html;return n;}};
  const toolbox=mountFeatureToolbox({view,choose(){}});
  assert.deepEqual([...toolbox.element.querySelectorAll('[data-step]')].map(b=>[b.dataset.feature,b.querySelector('span').textContent,b.getAttribute('aria-label')]),[['project','Model','Step 1 of 4: Open your model and choose the printer'],['colours','Colours','Step 2 of 4: Choose how the colours print'],['output','Check','Step 3 of 4: Check the result and settings'],['download','Download','Step 4 of 4: Download the file for your slicer']]);
  assert.deepEqual([...toolbox.element.querySelectorAll('.tool-list button')].map(b=>[b.textContent,b.getAttribute('aria-label')]),[['Paint','Paint objects'],['Split','Split & connect'],['Plates','Plates & arrange']]);
  // Before a model is open only the first step can be chosen; ticks follow progress.
  toolbox.sync('project','select',false,{loaded:false,done:{}});
  assert.deepEqual([...toolbox.element.querySelectorAll('[data-step]')].map(b=>b.disabled),[false,true,true,true]);
  toolbox.sync('colours','select',false,{loaded:true,done:{project:true},download:{disabled:false}});
  const steps=[...toolbox.element.querySelectorAll('[data-step]')];
  assert.equal(steps[0].dataset.done,'true');assert.equal(steps[1].getAttribute('aria-current'),'step');assert.equal(steps[0].getAttribute('aria-current'),null);assert(steps.every(b=>!b.disabled));
  const tips=toolbox.element.querySelector('[data-tips]');assert.equal(tips.checked,false);assert.equal(document.body.dataset.tips,'off');
  tips.checked=true;tips.dispatchEvent(new document.defaultView.Event('change'));assert.equal(document.body.dataset.tips,'on');
});
