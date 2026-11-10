import {planLayout,layoutOffsets,boxSize} from '../../web/shared/layout.js';
import {pickTriangle} from '../../web/shared/preview.js';

/** Where everything on the plate is right now, as hand-placed entries.
 * Keys are "objectId:ordinal"; rects are in bed millimetres from the bed corner. */
export function pinCurrent(state){
  const layout=state.layout,footprints=layout?.footprints||[];
  if(!state.bounds||!footprints.length)throw Error('Wait for the object sizes to finish loading.');
  const quantities=Object.fromEntries(footprints.map(f=>[f.objectId,state.quantities[f.objectId]??1]));
  const manual={},rects=new Map(),order=new Map();
  const add=(objectId,ordinal,rect)=>{const key=`${objectId}:${ordinal}`;manual[key]=[rect.x+rect.w/2,rect.y+rect.h/2];rects.set(key,rect);if(!order.has(String(objectId)))order.set(String(objectId),[]);order.get(String(objectId)).push(key);};
  const grouped=layout.arrangement!=='objects'&&Object.values(quantities).every(n=>n<=1);
  if(grouped){
    // A group keeps the designer's spacing; read each object's place from the group's offset.
    const plan=planLayout(state.bounds,layout);if(plan.blocked)throw Error('This layout does not fit the plate. Use Auto arrange first.');
    const centre=layout.centre||[0,0],padding=Math.max(0,Number(layout.padding)||0),offsets=layoutOffsets(state.bounds,plan,centre);
    offsets.forEach((offset,copy)=>{for(const f of footprints){if(!quantities[f.objectId])continue;const size=boxSize(f.bounds);
      add(f.objectId,copy,{x:f.bounds.min[0]+offset[0]-(centre[0]-layout.width/2)-padding,y:f.bounds.min[1]+offset[1]-(centre[1]-layout.depth/2)-padding,w:size[0]+padding*2,h:size[1]+padding*2});}});
  }else{
    const plan=planLayout(state.bounds,{...layout,arrangement:'objects',capacityLimit:state.copies});
    if(plan.blocked||plan.capped)throw Error('This layout does not fit the plate. Use Auto arrange first.');
    for(const p of plan.placements)add(p.objectId,p.ordinal,{...p.rect});
  }
  return {manual,rects,order,quantities};
}

const overlap=(a,b,gap)=>a.x<b.x+b.w+gap-1e-6&&a.x+a.w+gap>b.x+1e-6&&a.y<b.y+b.h+gap-1e-6&&a.y+a.h+gap>b.y+1e-6;

/** Move one placed object by a distance in millimetres. Returns a layout patch,
 * or throws with the reason the object cannot go there. */
export function moveObject(state,key,delta){
  const pinned=pinCurrent(state),rect=pinned.rects.get(key),layout=state.layout;
  if(!rect)throw Error('Select the object again; the plate has changed.');
  const edge=Math.max(0,Number(layout.edgeMargin)||0),strip=layout.tower&&!layout.towerBox?Number(layout.towerReserve)||25:0;
  const clamp=(value,low,high)=>Math.max(low,Math.min(Math.max(low,high),value));
  const next={...rect,x:clamp(rect.x+delta[0],edge+strip,layout.width-edge-strip-rect.w),y:clamp(rect.y+delta[1],edge,layout.depth-edge-rect.h)};
  const gap=Math.max(0,Number(layout.spacing)||0);
  for(const [other,placed]of pinned.rects)if(other!==key&&overlap(next,placed,gap))throw Error(`Too close to another object. Leave at least ${gap} mm between them, or change Spacing in Plates.`);
  for(const reserved of [...(layout.keepoutBoxes||[]),...(layout.tower&&layout.towerBox?[layout.towerBox]:[])]){
    if(overlap(next,{x:reserved.min[0],y:reserved.min[1],w:reserved.max[0]-reserved.min[0],h:reserved.max[1]-reserved.min[1]},gap))throw Error('That spot is reserved for the prime tower or printer hardware.');
  }
  const moved=Math.hypot(next.x-rect.x,next.y-rect.y);
  return {moved,position:[next.x+next.w/2,next.y+next.h/2],patch:{arrangement:'objects',copies:state.copies,quantities:pinned.quantities,manual:{...pinned.manual,[key]:[next.x+next.w/2,next.y+next.h/2]}}};
}

function invert(m){
  const inv=new Float64Array(16),a=m;
  inv[0]=a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  inv[4]=-a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  inv[8]=a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  inv[12]=-a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  inv[1]=-a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  inv[5]=a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  inv[9]=-a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  inv[13]=a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  inv[2]=a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  inv[6]=-a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  inv[10]=a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  inv[14]=-a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  inv[3]=-a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  inv[7]=a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  inv[11]=-a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  inv[15]=a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  const det=a[0]*inv[0]+a[1]*inv[4]+a[2]*inv[8]+a[3]*inv[12];if(Math.abs(det)<1e-20)return null;
  for(let i=0;i<16;i++)inv[i]/=det;return inv;
}
/** Where a pointer ray meets the horizontal plane at height z, in preview units. */
export function groundPoint(matrix,x,y,z=0){
  const inv=invert(matrix);if(!inv)return null;
  const at=depth=>{const w=inv[3]*x+inv[7]*y+inv[11]*depth+inv[15];return [(inv[0]*x+inv[4]*y+inv[8]*depth+inv[12])/w,(inv[1]*x+inv[5]*y+inv[9]*depth+inv[13])/w,(inv[2]*x+inv[6]*y+inv[10]*depth+inv[14])/w];};
  const near=at(-1),far=at(1),rise=far[2]-near[2];if(Math.abs(rise)<1e-9)return null;
  const t=(z-near[2])/rise;if(t<0||t>1)return null;
  return [near[0]+(far[0]-near[0])*t,near[1]+(far[1]-near[1])*t];
}

/** Drag a selected object across the plate. Orbiting is untouched unless the
 * drag starts on an object that is already selected. */
export function mountMoveTool({getState,enabled,history,say,changed=()=>{}}){
  let preview=null,drag=null,reselect=null;
  const ndc=(p,event)=>{const r=p.canvas.getBoundingClientRect();return [2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height];};
  function shift(p,range,dx,dy){
    const positions=p.lastPositions,from=range.start*3,to=(range.start+range.count)*3;
    for(let i=from;i<to;i+=3){positions[i]+=dx;positions[i+1]+=dy;}
    const gl=p.gl;gl.bindBuffer(gl.ARRAY_BUFFER,p.buffers.position);gl.bufferSubData(gl.ARRAY_BUFFER,from*4,positions.subarray(from,to));p.requestDraw();
  }
  const tool={
    get active(){return Boolean(drag?.moving);},
    down(event){
      const p=preview;drag=null;
      if(!p||event.button!==0||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||!p.plate||!p.lastPositions||!enabled())return false;
      const [x,y]=ndc(p,event);p.draw();
      const triangle=pickTriangle(p.lastPositions,p.viewProjection,x,y),index=p.pickRanges.findIndex(r=>triangle>=r.start/3&&triangle<(r.start+r.count)/3);
      if(index<0||!p.selectedRanges.has(index)||p.selectedRanges.size!==1)return false;
      const range=p.pickRanges[index];let low=Infinity,minX=Infinity,maxX=-Infinity;
      for(let i=range.start*3;i<(range.start+range.count)*3;i+=3){low=Math.min(low,p.lastPositions[i+2]);minX=Math.min(minX,p.lastPositions[i]);maxX=Math.max(maxX,p.lastPositions[i]);}
      const start=groundPoint(p.viewProjection,x,y,low);if(!start)return false;
      drag={p,range,index,low,start,width:maxX-minX,moved:[0,0],screen:[event.clientX,event.clientY],moving:false,positions:p.lastPositions};
      try{p.canvas.setPointerCapture(event.pointerId);}catch{}
      return true;
    },
    move(event){
      if(!drag)return false;const p=drag.p;
      if(!drag.moving&&Math.hypot(event.clientX-drag.screen[0],event.clientY-drag.screen[1])<5)return true;
      if(p.lastPositions!==drag.positions){drag=null;return true;}
      drag.moving=true;p.canvas.style.cursor='grabbing';
      const point=groundPoint(p.viewProjection,...ndc(p,event),drag.low);if(!point)return true;
      const dx=point[0]-drag.start[0],dy=point[1]-drag.start[1];
      shift(p,drag.range,dx-drag.moved[0],dy-drag.moved[1]);drag.moved=[dx,dy];
      return true;
    },
    up(event){
      if(!drag)return false;const current=drag;drag=null;const p=current.p;p.canvas.style.cursor='';
      try{p.canvas.releasePointerCapture(event.pointerId);}catch{}
      if(!current.moving)return true;
      const back=()=>{if(p.lastPositions===current.positions)shift(p,current.range,-current.moved[0],-current.moved[1]);};
      if(event.type==='pointercancel'){back();return true;}
      try{
        const state=getState(),pinned=pinCurrent(state),keys=pinned.order.get(String(current.range.objectId))||[];
        const position=p.pickRanges.slice(0,current.index).filter(r=>String(r.objectId)===String(current.range.objectId)).length,key=keys[position];
        if(!key)throw Error('Select the object again; the plate has changed.');
        // The preview may be drawn at a different scale from the bed; convert through the object's own width.
        const rect=pinned.rects.get(key),padding=Math.max(0,Number(state.layout.padding)||0),scale=current.width>1e-6?(rect.w-padding*2)/current.width:1,unit=scale>.2&&scale<5?scale:1;
        const result=moveObject(state,key,[current.moved[0]*unit,current.moved[1]*unit]);
        if(result.moved<.05){back();return true;}
        history.apply(result.patch);
        // The plate is redrawn after a move; pick the same object again once it is.
        reselect={positions:current.positions,objectId:String(current.range.objectId),position,until:Date.now()+15000};
        say(`Moved to ${result.position[0].toFixed(0)}, ${result.position[1].toFixed(0)} mm from the front-left corner. Positions are now fixed; Auto arrange repacks everything. Ctrl/Cmd+Z undoes.`);
      }catch(error){back();say(error.message);}
      changed();return true;
    },
  };
  /** The single selected object's placement key and current centre, or null. */
  function selected(){
    const p=preview;if(!p||p.selectedRanges.size!==1)return null;
    const index=[...p.selectedRanges][0],range=p.pickRanges[index];if(!range)return null;
    try{
      const state=getState(),pinned=pinCurrent(state),position=p.pickRanges.slice(0,index).filter(r=>String(r.objectId)===String(range.objectId)).length,key=(pinned.order.get(String(range.objectId))||[])[position],rect=pinned.rects.get(key);
      return rect?{key,position,objectId:String(range.objectId),centre:[rect.x+rect.w/2,rect.y+rect.h/2],width:state.layout.width,depth:state.layout.depth}:null;
    }catch{return null;}
  }
  /** Place the selected object's centre at typed coordinates. */
  function moveTo(x,y){
    const target=selected();if(!target)throw Error('Select one object to move.');
    if(![x,y].every(Number.isFinite))throw Error('Enter the position in millimetres.');
    const result=moveObject(getState(),target.key,[x-target.centre[0],y-target.centre[1]]);
    if(result.moved<.05)throw Error('The object is already there.');
    history.apply(result.patch);
    reselect={positions:preview.lastPositions,objectId:target.objectId,position:target.position,until:Date.now()+15000};
    say(`Moved to ${result.position[0].toFixed(1)}, ${result.position[1].toFixed(1)} mm from the front-left corner.${Math.hypot(result.position[0]-x,result.position[1]-y)>.05?' Kept on the bed.':''} Ctrl/Cmd+Z undoes.`);
    changed();
  }
  return {tool,selected,moveTo,
    /** Attach to the current preview unless another tool owns its pointer. */
    sync(next){
      if(reselect&&next?.lastPositions&&next.lastPositions!==reselect.positions&&next.pickRanges.length){
        const matches=next.pickRanges.map((r,i)=>[r,i]).filter(([r])=>String(r.objectId)===reselect.objectId),hit=matches[reselect.position]||matches[0];
        reselect=null;if(hit){next.selectRange(hit[1]);changed();}
      }else if(reselect&&Date.now()>reselect.until)reselect=null;
      if(next===preview&&(!next||next.pointerTool===tool))return;
      if(preview?.pointerTool===tool)preview.pointerTool=null;
      preview=next||null;drag=null;
      if(preview&&!preview.pointerTool)preview.pointerTool=tool;
    }};
}
