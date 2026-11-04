import {FocusPicking} from './focusPicking.js';
import {facesInBrush,focusMarkKey,focusWeights,triangleArea} from './focusRegions.js';
import {colourName} from './assignment.js';

/** Mark visible preview facets to influence comparison, never to repaint them. */
export function mountFocusBrush(root,{read,write,compare,sources}) {
  const $=selector=>root.querySelector(selector),doc=root.ownerDocument;
  let preview,picker,geometry,marks=new Map(),saved,history=[],stroke=null,active=false,dirty=false,mode='add',lastPoint;
  const ring=doc.createElement('span');ring.className='focus-brush-ring';ring.hidden=true;ring.setAttribute('aria-hidden','true');doc.body.append(ring);
  const radius=()=>Number($('[data-focus-size]').value)/2;
  const loadMarks=()=>{const next=read();if(saved!==next){saved=next;marks=new Map((next||[]).map(mark=>[focusMarkKey(mark),mark]));history=[];}};
  const persist=()=>{saved=[...marks.values()];write(saved);dirty=true;};
  function report(message) {
    root.dataset.active=String(active);
    preview?.canvas.closest('#stage')?.toggleAttribute('data-focus-brush',active);
    const weights=focusWeights([...marks.values()],geometry?.ranges),colours=Object.keys(weights);
    $('[data-focus-status]').textContent=message||(colours.length?`Marked details prioritise ${colours.map(colourName).join(', ')}.${active?'':' These colours can also change elsewhere in the model.'}`:marks.size?'These marks belong to parts outside this view or to an earlier edit. They do not affect this comparison.':'No details marked. Brush over a face, lettering or another important detail.');
    $('[data-focus-start]').disabled=!geometry?.positions?.length||!preview?.ok;
    $('[data-focus-start]').hidden=active;$('[data-focus-tools]').hidden=!active;
    $('[data-focus-undo]').disabled=!history.length;$('[data-focus-clear]').disabled=!marks.size;
    $('[data-focus-show]').disabled=!marks.size;
    for(const b of root.querySelectorAll('[data-focus-mode]'))b.setAttribute('aria-pressed',String(b.dataset.focusMode===mode));
  }
  function highlight() {
    if(!picker||!geometry)return;
    const positions=[];
    for(const r of geometry.ranges)for(let face=r.start/3;face<(r.start+r.count)/3;face++) {
      if(!marks.has(`${r.focusKey}:${geometry.faces[face]}`))continue;
      for(let i=face*9;i<face*9+9;i++)positions.push(geometry.positions[i]);
    }
    picker.setHighlight(Float32Array.from(positions));preview.requestDraw();
  }
  function cursor(event) {
    ring.hidden=!active||mode==='orbit'||event.pointerType==='touch';
    ring.style.width=ring.style.height=`${radius()*2}px`;ring.style.left=`${event.clientX}px`;ring.style.top=`${event.clientY}px`;
    ring.dataset.mode=mode;
  }
  function paint(x,y) {
    const data=stroke.image,hits=facesInBrush(data.pixels,data.width,data.height,data.cssWidth,data.cssHeight,x,y,radius());
    for(const face of hits) {
      if(face>=geometry.faces.length||geometry.states[face]<0)continue;
      const r=geometry.ranges.find(r=>face>=r.start/3&&face<(r.start+r.count)/3);if(!r?.focusKey)continue;
      const key=`${r.focusKey}:${geometry.faces[face]}`,old=marks.get(key);
      if(mode==='erase') {if(!old)continue;if(!stroke.before.has(key))stroke.before.set(key,old);marks.delete(key);}
      else {
        if(old)continue;const colour=sources()[geometry.states[face]||1];if(!colour)continue;
        if(!stroke.before.has(key))stroke.before.set(key,null);
        marks.set(key,[r.focusKey,geometry.faces[face],colour.toUpperCase(),triangleArea(geometry.positions,face)]);
      }
    }
  }
  function endStroke(cancel=false) {
    if(!stroke)return;
    const {before,pointerId}=stroke;
    if(cancel)for(const [key,value]of before)value?marks.set(key,value):marks.delete(key);
    else if(before.size){history.push(before);if(history.length>20)history.shift();persist();}
    try{preview.canvas.releasePointerCapture(pointerId);}catch{}
    stroke=null;lastPoint=null;highlight();report();
  }
  function undo() {
    endStroke(true);const before=history.pop();if(!before)return;
    for(const [key,value]of before)value?marks.set(key,value):marks.delete(key);
    persist();highlight();report();if(!active){dirty=false;compare();}
  }
  function stop(recalculate=true) {
    endStroke();active=false;ring.hidden=true;
    if(preview){preview.canvas.classList.remove('focus-marking');preview.requestDraw();}
    report();if(recalculate&&dirty){dirty=false;compare();}
  }
  const api={
    get active(){return active;},get drawing(){return Boolean(stroke);},stop,
    down(event) {
      if(!active||mode==='orbit'||event.button!==0||event.altKey)return false;
      if(stroke)return true;
      event.preventDefault();
      preview.canvas.tabIndex=0;preview.canvas.focus({preventScroll:true});
      try {
        stroke={image:picker.capture(),before:new Map(),pointerId:event.pointerId};
        preview.canvas.setPointerCapture(event.pointerId);
        const r=preview.canvas.getBoundingClientRect();lastPoint=[event.clientX-r.left,event.clientY-r.top];paint(...lastPoint);highlight();cursor(event);
      }catch(error){stroke=null;stop(false);report(`Could not start the brush: ${error.message} Try again, or use whole-colour priorities below.`);}
      return true;
    },
    move(event) {
      if(!active)return false;cursor(event);if(!stroke)return false;
      if(stroke.pointerId!==event.pointerId)return true;
      const r=preview.canvas.getBoundingClientRect(),point=[event.clientX-r.left,event.clientY-r.top],steps=Math.max(1,Math.ceil(Math.hypot(point[0]-lastPoint[0],point[1]-lastPoint[1])/Math.max(2,radius()/2)));
      for(let s=1;s<=steps;s++)paint(lastPoint[0]+(point[0]-lastPoint[0])*s/steps,lastPoint[1]+(point[1]-lastPoint[1])*s/steps);
      lastPoint=point;highlight();return true;
    },
    up(event){if(!stroke)return false;if(event.pointerId===stroke.pointerId)endStroke(event.type==='pointercancel');return true;},
    key(event) {
      if(!active||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return false;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.shiftKey){event.preventDefault();undo();return true;}
      if(event.key==='Escape'){event.preventDefault();stop();$('[data-focus-start]').focus({preventScroll:true});return true;}
      // Object Delete and duplicate shortcuts must not run while marking.
      if(['Delete','Backspace'].includes(event.key)||(event.ctrlKey||event.metaKey)&&['d','a'].includes(event.key.toLowerCase())){event.preventDefault();return true;}
      return false;
    },
    sync(nextPreview,nextGeometry) {
      if(nextPreview!==preview) {
        preview=nextPreview;preview.pointerTool=api;
        const previous=preview.onDraw;preview.onDraw=()=>{previous?.();if(active||$('[data-focus-show]').checked)picker?.drawHighlight();};
        preview.canvas.addEventListener('pointerleave',()=>{ring.hidden=true;});
      }
      if(geometry?.positions!==nextGeometry.positions)endStroke(true);
      geometry=nextGeometry;loadMarks();highlight();report();
    },
    reset(){stop(false);dirty=false;history=[];marks.clear();saved=null;geometry=null;picker?.setHighlight(new Float32Array());$('[data-focus-show]').checked=false;report();},
  };
  $('[data-focus-start]').onclick=()=>{
    loadMarks();if(!preview?.ok||!geometry?.positions?.length)return;
    try{picker ||= new FocusPicking(preview);}catch(error){report(`Brush unavailable: ${error.message}. Use whole-colour priorities below.`);return;}
    active=true;mode='add';preview.dragging=null;preview.canvas.classList.add('focus-marking');highlight();report();
  };
  $('[data-focus-done]').onclick=()=>stop();
  for(const b of root.querySelectorAll('[data-focus-mode]'))b.onclick=()=>{endStroke();mode=b.dataset.focusMode;ring.hidden=true;preview.canvas.classList.toggle('focus-marking',mode!=='orbit');report();};
  $('[data-focus-size]').oninput=()=>{$('[data-focus-size-value]').textContent=`${radius()*2} px`;};
  $('[data-focus-undo]').onclick=undo;
  $('[data-focus-clear]').onclick=()=>{endStroke();history.push(new Map(marks));if(history.length>20)history.shift();marks.clear();persist();highlight();report();if(!active){dirty=false;compare();}};
  $('[data-focus-show]').onchange=()=>{if(!picker&&preview?.ok)picker=new FocusPicking(preview);highlight();preview?.requestDraw();};
  root.closest('details')?.addEventListener('toggle',()=>{if(!root.closest('details').open)stop();});
  if(!doc.body.dataset.engine)doc.addEventListener('keydown',event=>{if(api.key(event))event.stopImmediatePropagation();},true);
  report();return api;
}
