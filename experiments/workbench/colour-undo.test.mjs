import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountStudio} from './studio-tools.js';

test('opening Colour never paints; Undo cancels explicit previews before older plate history in both modes',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');
  const previousOption=globalThis.Option,proto=window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'value'),previousAdd=proto.add;
  globalThis.Option=function(text,value){const node=document.createElement('option');node.value=value;node.textContent=text;return node;};
  Object.defineProperty(proto,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value;},set(value){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===value);}});
  proto.add=function(option){this.append(option);};
  try{
    for(const kind of ['converter','spectrum']){
      const make=(tag,attrs={},html='')=>{const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);node.innerHTML=html;return node;};
      const view={stage:make('main'),inspector:make('aside'),panels:{},make};
      const original=new Float32Array([1,.5,0,1,1,1]),p={lastColors:original.slice(),lastPositions:new Float32Array(6),selectedRanges:new Set([0]),pickRanges:[{objectId:'1',start:0,count:1}],setColors(c){this.lastColors=c;},requestDraw(){}};
      const file=new File(['model'],'test.3mf'),s={key:'1',objects:[{objectId:'1',name:'Model'}],copies:1,quantities:{},preview:p},colours=['#000000','#FFFFFF'];let plateUndo=0;
      const engine={session:{state:{colours}},state:{project:{colors:colours}},workbenchObjects:()=>s,workbenchSourceColours:async()=>original.slice()};
      const studio=mountStudio({view,engine,kind,api:{source:()=>file},objects:{selected:()=>['1'],element:make('section'),history:{canUndo:true},act:async()=>plateUndo++},setPanel(){}});
      studio.sync();studio.show('colour');await new Promise(r=>setImmediate(r));
      assert.deepEqual(p.lastColors,original,'opening the tool must not preview its first colour');
      assert.equal(view.inspector.querySelector('[data-edit-apply]').disabled,true);
      view.inspector.querySelector('[data-swatch="#000000"]').click();
      assert.deepEqual([...p.lastColors],[0,0,0,1,1,1]);
      assert.equal(view.stage.querySelector('[data-studio-undo]').disabled,false);
      assert.match(view.stage.querySelector('[data-studio-undo]').getAttribute('aria-label'),/colour preview/);
      studio.key({key:'z',ctrlKey:true,preventDefault(){}});assert.deepEqual(p.lastColors,original);assert.equal(plateUndo,0);
      studio.key({key:'z',ctrlKey:true,preventDefault(){}});await new Promise(r=>setImmediate(r));assert.equal(plateUndo,1);
      studio.show('colour');await new Promise(r=>setImmediate(r));view.inspector.querySelector('[data-swatch="#000000"]').click();view.stage.querySelector('[data-studio-undo]').click();assert.deepEqual(p.lastColors,original);
    }
  }finally{globalThis.Option=previousOption;Object.defineProperty(proto,'value',descriptor);if(previousAdd)proto.add=previousAdd;else delete proto.add;}
});
