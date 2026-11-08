// Workbench geometry only. Interfaces are closed with shared boundary vertices;
// pins and sockets replace cap triangles, rather than overlapping loose solids.
import earcut from './vendor/earcut.js';
import {connectedParts,signedVolume} from './mesh-cut.js';
const EPS=1e-6,TAU=Math.PI*2;
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a);if(n<EPS)throw Error('This colour boundary is too thin to close. Use a plane cut instead.');return a.map(v=>v/n);};
const key=p=>p.map(n=>Math.round(n/EPS)).join(',');
const edgeKey=(a,b)=>[key(a),key(b)].sort().join('|');
const normal=points=>cross(sub(points[1],points[0]),sub(points[2],points[0]));
const mean=points=>points.reduce((a,p)=>a.map((v,i)=>v+p[i]/points.length),[0,0,0]);

function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function distance(p,a,b){const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/(dot(d,d)||1)));return Math.hypot(...p.map((v,i)=>v-a[i]-d[i]*t));}
export function colourBoundary(faces){
  const edges=new Map();
  for(const f of faces)for(let i=0;i<3;i++){
    const a=f.points[i],b=f.points[(i+1)%3],k=edgeKey(a,b),existing=edges.get(k);
    if(existing){existing.count++;if(key(existing.a)===key(a))existing.folded=true;}else edges.set(k,{a,b,count:1});
  }
  if([...edges.values()].some(e=>e.count>2||e.folded))throw Error('This painted region has overlapping or inconsistent faces. Repair it in the slicer before separating it.');
  const rim=[...edges.values()].filter(e=>e.count===1),next=new Map(),incoming=new Map();
  for(const e of rim){const k=key(e.a),end=key(e.b);if(next.has(k)||incoming.has(end))throw Error('This colour has a branching paint boundary. Use a plane cut, or tidy the painting in your slicer.');next.set(k,e);incoming.set(end,e);}
  if([...next.keys()].some(k=>!incoming.has(k)))throw Error('This colour has an open paint boundary. Use a plane cut or repair the model first.');
  const visited=new Set(),loops=[];
  for(const start of next.keys()){
    if(visited.has(start))continue;const loop=[];let at=start;
    do{if(visited.has(at)||!next.has(at))throw Error('The paint boundary cannot be closed. Use a plane cut instead.');visited.add(at);const e=next.get(at);loop.push(e.a);at=key(e.b);}while(at!==start);
    if(loop.length<3)throw Error('The paint boundary is too small to separate.');loops.push(loop);
  }
  return {loops,rim};
}

function frameFor(loops,direction){
  const points=loops.flat(),origin=mean(points);
  // The largest oriented loop supplies a stable normal for a slightly curved seam.
  if(!direction){const vectors=loops.map(l=>l.reduce((n,p,i)=>{const c=cross(sub(p,origin),sub(l[(i+1)%l.length],origin));return n.map((v,j)=>v+c[j]);},[0,0,0]));direction=vectors.sort((a,b)=>Math.hypot(...b)-Math.hypot(...a))[0];}
  const n=unit(direction),u=unit(cross(Math.abs(n[2])<.9?[0,0,1]:[0,1,0],n)),v=cross(n,u);
  const project=p=>[dot(sub(p,origin),u),dot(sub(p,origin),v)];
  const lift=(p,z=0)=>origin.map((x,i)=>x+u[i]*p[0]+v[i]*p[1]+n[i]*z);
  const rings=loops.map(l=>l.map(project));
  let lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];for(const p of rings.flat())for(let i=0;i<2;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
  const width=Math.min(...hi.map((x,i)=>x-lo[i]));
  if(points.some(p=>Math.abs(dot(sub(p,origin),n))>Math.max(.05,width*.08)))throw Error('This colour wraps around the model rather than forming a detachable part. Use a plane cut to choose its base.');
  // A projection that crosses itself cannot provide a trustworthy closing surface.
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const edges=rings.flatMap((r,ri)=>r.map((a,i)=>({a,b:r[(i+1)%r.length],ri,i,length:r.length})));
  if(edges.length>6000)throw Error('This paint boundary is too detailed to separate here. Use a plane cut instead.');
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const a=edges[i],b=edges[j];if(a.ri===b.ri&&(Math.abs(a.i-b.i)===1||Math.abs(a.i-b.i)===a.length-1))continue;if(orient(a.a,a.b,b.a)*orient(a.a,a.b,b.b)<-EPS&&orient(b.a,b.b,a.a)*orient(b.a,b.b,a.b)<-EPS)throw Error('This colour folds over itself at the boundary. Use a plane cut instead.');}
  return {origin,n,u,v,project,lift,rings,lo,hi};
}

function caps(loops,frame,attrs,direction,hole=null){
  const rings=loops.map(l=>l.map(frame.project));
  const depth=rings.map((r,i)=>rings.filter((other,j)=>i!==j&&inside(r[0],other)).length),out=[];let holeUsed=false;
  for(let i=0;i<loops.length;i++){
    if(depth[i]%2)continue;
    const group=[loops[i],...loops.filter((l,j)=>depth[j]===depth[i]+1&&inside(rings[j][0],rings[i]))];
    if(hole&&inside(frame.project(hole[0]),rings[i])&&!group.slice(1).some(l=>inside(frame.project(hole[0]),l.map(frame.project)))){group.push(hole);holeUsed=true;}
    const points=group.flat(),holes=[];let offset=group[0].length;for(const ring of group.slice(1)){holes.push(offset);offset+=ring.length;}
    const ts=earcut(points.flatMap(frame.project),holes,2);if(!ts.length)throw Error('The joining surface could not be closed. Change the cut or colour.');
    for(let t=0;t<ts.length;t+=3){let tri=ts.slice(t,t+3).map(i=>points[i]);if(dot(normal(tri),frame.n)*direction<0)tri=[tri[0],tri[2],tri[1]];out.push({points:tri,attrs});}
  }
  if(hole&&!holeUsed)throw Error('The pin does not fit inside the joining surface.');
  return out;
}

function chooseCentre(frame,radius){
  let best=null,score=-Infinity;
  const consider=p=>{if(frame.rings.filter(r=>inside(p,r)).length%2!==1)return;let d=Infinity;for(const r of frame.rings)for(let i=0;i<r.length;i++)d=Math.min(d,distance(p,r[i],r[(i+1)%r.length]));if(d>score){score=d;best=p;}};
  consider([0,0]);
  for(let y=1;y<32;y++)for(let x=1;x<32;x++)consider(frame.lo.map((v,i)=>v+(frame.hi[i]-v)*(i?y:x)/32));
  if(!best||score<radius+.6)throw Error('The pin is too wide for this join. Reduce its diameter or choose a wider cut.');
  return best;
}

// Reject any source surface inside a conservative cylindrical clearance envelope.
// Clipping first avoids false negatives from triangles whose vertices all lie outside.
function envelopeClear(faces,frame,centre,radius,depth,side){
  const origin=frame.lift(centre),radius2=radius*radius;
  const clip=(poly,z,sign)=>{const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a[2]-z)*sign,db=(b[2]-z)*sign;if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*t));}}return out;};
  for(const f of faces){
    const zs=f.points.map(p=>dot(sub(p,origin),frame.n)*side);
    if(zs.every(z=>z<EPS)||zs.every(z=>z>depth))continue;
    let poly=f.points.map((p,i)=>[dot(sub(p,origin),frame.u),dot(sub(p,origin),frame.v),zs[i]]);
    poly=clip(clip(poly,EPS,1),depth,-1);if(poly.length<3)continue;
    const xy=poly.map(p=>p.slice(0,2));
    if(xy.some(p=>dot(p,p)<=radius2)||inside([0,0],xy)||xy.some((p,i)=>distance([0,0],p,xy[(i+1)%xy.length])<=radius))return false;
  }
  return true;
}

export function closeInterface(a,b,loops,{normal:direction,attrsA='',attrsB='',connector=null}={}){
  const frame=frameFor(loops,direction),flatA=caps(loops,frame,attrsA,1),flatB=caps(loops,frame,attrsB,-1);
  if(!connector)return {halves:[[...a,...flatA],[...b,...flatB]],joint:null};
  const {diameter=3,length=3,clearance=.3,side='selected'}=connector;
  if(![diameter,length,clearance].every(Number.isFinite)||diameter<1||diameter>20||length<1||length>20||clearance<.05||clearance>1)throw Error('Use a 1–20 mm pin diameter and length, and 0.05–1 mm diameter clearance.');
  if(!['selected','base'].includes(side))throw Error('Choose which part carries the pin.');
  const r=diameter/2,socketRadius=r+clearance/2,depth=length+.2,centre=chooseCentre(frame,socketRadius),pinOnB=side==='selected',travel=pinOnB?-1:1;
  if(!envelopeClear(pinOnB?a:b,frame,centre,socketRadius+.6,depth+.6,travel))throw Error('There is not enough solid material behind the socket. Shorten the pin, reduce its diameter, or move the cut.');
  if(!envelopeClear(pinOnB?b:a,frame,centre,r+.6,.8,-travel))throw Error('The pin base is too thin here. Reduce the diameter or move the cut.');
  const ring=(radius,z)=>Array.from({length:40},(_,i)=>frame.lift([centre[0]+Math.cos(i*TAU/40)*radius,centre[1]+Math.sin(i*TAU/40)*radius],z));
  const pinRing=ring(r,0),socketRing=ring(socketRadius,0);
  // Use the SAME closing surface on both sides of a curved paint boundary.
  // Only the pin side fills the annulus between the pin and socket diameters.
  const capA=caps(loops,frame,attrsA,1,socketRing),capB=caps(loops,frame,attrsB,-1,socketRing),pinCap=pinOnB?capB:capA;
  for(let i=0;i<socketRing.length;i++){const j=(i+1)%socketRing.length;for(let tri of [[socketRing[i],socketRing[j],pinRing[j]],[socketRing[i],pinRing[j],pinRing[i]]]){if(dot(normal(tri),frame.n)*(pinOnB?-1:1)<0)tri=[tri[0],tri[2],tri[1]];pinCap.push({points:tri,attrs:pinOnB?attrsB:attrsA});}}
  function cylinder(start,end,isSocket,attrs){
    const faces=[],expected=isSocket?-1:1;
    for(let i=0;i<start.length;i++){const j=(i+1)%start.length;for(let tri of [[start[i],start[j],end[j]],[start[i],end[j],end[i]]]){const mid=mean(tri),from=sub(mid,frame.lift(centre)),radial=from.map((v,k)=>v-frame.n[k]*dot(from,frame.n));if(dot(normal(tri),radial)*expected<0)tri=[tri[0],tri[2],tri[1]];faces.push({points:tri,attrs});}}
    const tip=mean(end),outward=travel*(isSocket?-1:1);
    for(let i=0;i<end.length;i++){let tri=[tip,end[i],end[(i+1)%end.length]];if(dot(normal(tri),frame.n)*outward<0)tri=[tri[0],tri[2],tri[1]];faces.push({points:tri,attrs});}return faces;
  }
  const pin=cylinder(pinRing,ring(r,travel*length),false,pinOnB?attrsB:attrsA),socket=cylinder(socketRing,ring(socketRadius,travel*depth),true,pinOnB?attrsA:attrsB);
  return {halves:[[...a,...capA,...(pinOnB?socket:pin)],[...b,...capB,...(pinOnB?pin:socket)]],joint:{diameter,length,clearance,socketDiameter:diameter+clearance,socketDepth:depth,centre:frame.lift(centre),normal:frame.n,side}};
}

/** faces have flat, resolved source colour IDs. Preserve their other attributes. */
export function separateColour(faces,colour,{connector=null,capAttributes=c=>` paint_color="${c}"`,region=null}={}){
  let selected=faces.filter(f=>f.colour===colour);
  if(!selected.length)throw Error('This colour is not painted on the selected object. Choose another colour or object.');
  const allGroups=connectedParts(selected);
  if(region!==null){if(!Number.isInteger(region)||!allGroups[region])throw Error('That colour region is no longer available. Choose it again.');selected=allGroups[region];}
  const selectedSet=new Set(selected),rest=faces.filter(f=>!selectedSet.has(f));
  if(!rest.length){if(connector)throw Error('The whole object uses this colour. It has no joining surface for a pin.');return {remaining:[],parts:[selected],joints:[]};}
  const groups=region===null?allGroups:[selected];if(groups.length>32)throw Error('This colour has too many separate patches. Select one region or use a plane cut.');
  let remaining=rest;const parts=[],joints=[];
  for(const group of groups){
    const {loops,rim}=colourBoundary(group);
    if(!loops.length){if(connector)throw Error('This colour is already a disconnected part. Turn off the locating pin to separate it.');parts.push(group);joints.push(null);continue;}
    // Verify both surfaces really share this boundary; never cap an unrelated hole.
    const expected=new Map(rim.map(e=>[edgeKey(e.a,e.b),e])),matches=new Map(),adjacent=new Map();
    for(const f of remaining)for(let i=0;i<3;i++){const a=f.points[i],b=f.points[(i+1)%3],k=edgeKey(a,b),e=expected.get(k);if(!e)continue;if(key(a)!==key(e.b))throw Error('The painted boundary has inconsistent winding. Repair the mesh in your slicer first.');matches.set(k,(matches.get(k)||0)+1);adjacent.set(f.colour,(adjacent.get(f.colour)||0)+Math.hypot(...sub(a,b)));}
    if([...expected.keys()].some(k=>matches.get(k)!==1))throw Error('The paint boundary has mismatched triangle edges. Use a plane cut or repair the painting in your slicer first.');
    const other=[...adjacent].sort((a,b)=>b[1]-a[1])[0]?.[0]||1;
    const surface={attrsA:capAttributes(other),attrsB:capAttributes(colour)};
    const plain=closeInterface(remaining,group,loops,surface);
    // A flat painted patch encloses no solid volume and is not a detachable object.
    // Validate before adding a pin: its volume must not make a flat patch pass.
    if(signedVolume(plain.halves[1])<.01||signedVolume(plain.halves[0])<.01)throw Error('This colour is a surface patch rather than a solid protruding part. Use a plane cut to give it thickness.');
    const result=connector?closeInterface(remaining,group,loops,{...surface,connector}):plain;
    remaining=result.halves[0];parts.push(result.halves[1]);joints.push(result.joint);
  }
  return {remaining,parts,joints};
}

/** Cut an explicit geometry selection, preserving all exterior paint trees. */
export function separateShape(faces,indices,{connector=null,capAttributes='',selectedCapAttributes=capAttributes}={}){
  const wanted=new Set(indices),selected=faces.filter((_,i)=>wanted.has(i)),rest=faces.filter((_,i)=>!wanted.has(i));
  if(!selected.length||!rest.length)throw Error('Select part of this mesh, leaving some of it on the body.');
  const groups=connectedParts(selected);let remaining=rest;const parts=[],joints=[];
  if(groups.length>32)throw Error('This selection has too many disconnected pieces. Select fewer regions.');
  for(const group of groups){
    const {loops,rim}=colourBoundary(group);
    if(!loops.length){
      if(signedVolume(group)<.01)throw Error('This selection does not enclose a solid part.');
      if(connector)throw Error('This piece is already separate. Turn off the locating pin.');
      parts.push(group);joints.push(null);continue;
    }
    const expected=new Map(rim.map(e=>[edgeKey(e.a,e.b),e])),matches=new Map();
    for(const f of remaining)for(let i=0;i<3;i++){
      const a=f.points[i],b=f.points[(i+1)%3],k=edgeKey(a,b),e=expected.get(k);if(!e)continue;
      if(key(a)!==key(e.b))throw Error('This join has inconsistent face winding. Repair the mesh first.');
      matches.set(k,(matches.get(k)||0)+1);
    }
    if([...expected.keys()].some(k=>matches.get(k)!==1))throw Error('This selection has an open or mismatched join. Adjust the selection or use a plane cut.');
    const options={attrsA:capAttributes,attrsB:selectedCapAttributes};
    const plain=closeInterface(remaining,group,loops,options);
    if(signedVolume(plain.halves[0])<.01||signedVolume(plain.halves[1])<.01)throw Error('This is a surface patch with no printable thickness. Recolour it, or use a plane cut.');
    const tolerance=Math.max(.001,Math.abs(signedVolume(remaining)+signedVolume(group))*1e-6);
    if(Math.abs(signedVolume(plain.halves[0])+signedVolume(plain.halves[1])-signedVolume(remaining)-signedVolume(group))>tolerance)throw Error('This join could not preserve the model volume. Use a plane cut.');
    const result=connector?closeInterface(remaining,group,loops,{...options,connector}):plain;
    // The existing seam validator requires near-planarity and non-crossing loops.
    if(colourBoundary(result.halves[1]).loops.length)throw Error('The selected join could not be closed. Use a plane cut.');
    remaining=result.halves[0];parts.push(result.halves[1]);joints.push(result.joint);
  }
  if(colourBoundary(remaining).loops.length)throw Error('The remaining body has open boundaries. Repair it in your slicer first.');
  return {remaining,parts,joints};
}
