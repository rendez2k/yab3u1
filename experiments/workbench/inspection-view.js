import {Preview,fitDistance} from '../../web/shared/preview.js';
import {explodedPositions,inspectionBounds} from './split-inspection.js';

export function projectPoint(point,matrix){
  const [x,y,z]=point,w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];if(w<=0)return null;
  return [(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w,(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w,w];
}
export function surfaceHit(positions,triangle,matrix,x,y){
  if(triangle<0||!matrix)return null;const points=[0,1,2].map(i=>Array.from(positions.slice(triangle*9+i*3,triangle*9+i*3+3))),projected=points.map(p=>projectPoint(p,matrix));if(projected.some(p=>!p))return null;
  const [a,b,c]=projected,d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-12)return null;
  const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d,weights=[u/a[2],v/b[2],(1-u-v)/c[2]],sum=weights.reduce((a,b)=>a+b,0);
  return [0,1,2].map(i=>points.reduce((n,p,j)=>n+p[i]*weights[j]/sum,0));
}

// Temporary inspection is a separate canvas. It never changes the workspace's
// geometry, selection, layout, camera or file, even when a check fails.
export function createInspectionView({stage,make}){
  let owner=null,root=null,p=null,soup=null,overlay=null,points=[],path=[],selected=-1,pick=null,gap=0,controls=null,controlsWereInert=false;
  const cameras=new Map();
  const fit=b=>fitDistance(b.size,p.canvas.clientWidth/Math.max(1,p.canvas.clientHeight),p.yaw,p.pitch);
  function hide(who){if(who&&owner!==who)return;if(p){if(p.bounds)cameras.set(owner,{yaw:p.yaw,pitch:p.pitch,distance:p.distance*fit(inspectionBounds(soup))/fit(p.bounds),pan:p.pan.slice()});p.resizeObserver?.disconnect();if(p.frame)cancelAnimationFrame(p.frame);p.gl?.getExtension('WEBGL_lose_context')?.loseContext();}root?.remove();if(controls)controls.inert=controlsWereInert;controls=null;delete stage.dataset.inspectionExpanded;owner=null;root=null;p=null;soup=null;points=[];path=[];gap=0;}
  function draw(){
    if(!overlay||!p?.viewProjection)return;const width=p.canvas.clientWidth,height=p.canvas.clientHeight;
    const screen=point=>{const a=projectPoint(point,p.viewProjection);return a?[(a[0]+1)*width/2,(1-a[1])*height/2]:null;};
    overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const coords=path.map(screen),line=coords.map((v,i)=>v?`${i&&coords[i-1]?'L':'M'}${v[0].toFixed(1)} ${v[1].toFixed(1)}`:'').join(' ');
    overlay.innerHTML=`<path class="boundary-path" d="${line}"/>`+points.map((v,i)=>{const at=screen(v);return at?`<g transform="translate(${at[0]} ${at[1]})"><circle class="boundary-point${i===selected?' chosen':''}" r="10"/><text text-anchor="middle" dy=".35em">${i+1}</text></g>`:'';}).join('');
  }
  function show(who,data,label,onPick=null){
    if(owner===who&&soup===data){root.querySelector('[data-inspection-label]').textContent=label;root.setAttribute('aria-label',label);pick=onPick;return;}
    hide();owner=who;soup=data;pick=onPick;
    root=make('div',{class:'split-inspection','aria-label':label},'<canvas aria-label="Split inspection model"></canvas><svg class="boundary-overlay" aria-hidden="true"></svg><div class="inspection-caption"><span data-inspection-label></span><div><button type="button" data-inspection-reset>Reset view</button><button type="button" data-inspection-expand aria-pressed="false">Expand preview</button></div></div>');stage.append(root);controls=stage.querySelector('#platecontrols');if(controls){controlsWereInert=controls.inert;controls.inert=true;}
    root.querySelector('[data-inspection-label]').textContent=label;
    p=new Preview(root.querySelector('canvas'));if(!p.ok){hide();throw Error('3D inspection is unavailable in this browser.');}
    p.multiSelect=true;p.view='model';p.suppressSelection=true;p.setSoup(data.positions,data.colors);overlay=root.querySelector('svg');
    if(cameras.has(who)){Object.assign(p,cameras.get(who));p.requestDraw();}
    p.onDraw=draw;p.onRegionPick=({triangle,event})=>{if(pick&&triangle>=0){const rect=p.canvas.getBoundingClientRect(),point=surfaceHit(p.lastPositions,triangle,p.viewProjection,2*(event.clientX-rect.left)/rect.width-1,1-2*(event.clientY-rect.top)/rect.height),range=data.ranges.find(r=>triangle>=r.start/3&&triangle<(r.start+r.count)/3);if(point&&range)pick({point,part:range.part});}return true;};
    root.querySelector('[data-inspection-reset]').onclick=()=>p?.reset();
    root.querySelector('[data-inspection-expand]').onclick=e=>{const expanded=stage.dataset.inspectionExpanded!=='true';stage.dataset.inspectionExpanded=String(expanded);e.currentTarget.setAttribute('aria-pressed',String(expanded));e.currentTarget.textContent=expanded?'Show settings':'Expand preview';};
  }
  return {show,hide,get owner(){return owner;},boundary(anchors,line,index,mask){points=anchors;path=line;selected=index;if(p&&soup){const colors=soup.colors.slice();if(mask?.some(Boolean))for(let i=0;i<colors.length;i++)colors[i]=mask[Math.floor(i/9)]?colors[i]*.5+[.12,.62,.41][i%3]*.5:colors[i]*.3+.5;p.setColors(colors);draw();}},explode(nextGap){if(!p||!soup)return;const positions=explodedPositions(soup,nextGap),bounds=inspectionBounds(soup,nextGap);p.distance*=fit(bounds)/fit(p.bounds);p.bounds=bounds;gap=nextGap;p.upload(p.buffers.position,p.attributes.position,positions,3);p.lastPositions=positions;p.requestDraw();}};
}
