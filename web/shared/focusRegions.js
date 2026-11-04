// Preview-only references. No focus data is written into the mesh or its paint.
export function focusFingerprint(positions, states) {
  let hash=2166136261;
  for(const array of [positions,states]) {
    const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    for(const byte of bytes)hash=Math.imul(hash^byte,16777619);
  }
  return `${positions.length}:${hash>>>0}`;
}
export const focusMarkKey=mark=>`${mark[0]}:${mark[1]}`;
export function focusWeights(marks, ranges) {
  const visible=new Set((ranges||[]).map(r=>r.focusKey)), weights={},seen=new Set();
  for(const mark of marks||[]) {
    const [key,face,colour,area]=mark,id=focusMarkKey(mark);
    if(!visible.has(key)||seen.has(id)||!Number.isInteger(face)||face<0||!/^#[0-9A-F]{6}$/i.test(colour)||!Number.isFinite(area)||area<=0)continue;
    seen.add(id);weights[colour]=(weights[colour]||0)+area;
  }
  return weights;
}
export function triangleArea(positions,face) {
  const i=face*9,ux=positions[i+3]-positions[i],uy=positions[i+4]-positions[i+1],uz=positions[i+5]-positions[i+2],
    vx=positions[i+6]-positions[i],vy=positions[i+7]-positions[i+1],vz=positions[i+8]-positions[i+2];
  return Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;
}
// The ID image contains only the nearest surface; readPixels is bottom-up.
export function facesInBrush(pixels,width,height,cssWidth,cssHeight,x,y,radius) {
  const hits=new Set(),sx=width/cssWidth,sy=height/cssHeight;
  if(![sx,sy,x,y,radius].every(Number.isFinite)||sx<=0||sy<=0||radius<=0)return hits;
  const left=Math.max(0,Math.floor((x-radius)*sx)),right=Math.min(width-1,Math.ceil((x+radius)*sx)),
    top=Math.max(0,Math.floor((y-radius)*sy)),bottom=Math.min(height-1,Math.ceil((y+radius)*sy));
  for(let py=top;py<=bottom;py++)for(let px=left;px<=right;px++) {
    if(((px+.5)/sx-x)**2+((py+.5)/sy-y)**2>radius*radius)continue;
    const at=((height-1-py)*width+px)*4,id=pixels[at]+pixels[at+1]*256+pixels[at+2]*65536;
    if(id)hits.add(id-1);
  }
  return hits;
}
