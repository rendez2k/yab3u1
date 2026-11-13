// Reads the colours of a printed swatch strip from a photograph.
//
// The strip is a row of equal tiles. Given its four corners in the photo, each tile's
// middle is sampled and averaged. A photo's colours depend on the light and the camera,
// so a patch of plain white paper in the same shot is used as the reference: the photo
// is scaled so that the paper comes out white. This is a correction for colour cast
// and exposure, not a colour measurement, but it puts every tile on the same footing,
// which is what choosing between blends needs.
const toLinear=v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
const toSrgb=v=>{const c=Math.min(1,Math.max(0,v));return Math.round(255*(c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055));};
const hex=rgb=>'#'+rgb.map(v=>toSrgb(v).toString(16).padStart(2,'0')).join('').toUpperCase();
// White paper reflects most of the light, not all of it.
export const PAPER_WHITE=0.88;

function pixel(image,x,y){
  const px=Math.min(image.width-1,Math.max(0,Math.round(x))),py=Math.min(image.height-1,Math.max(0,Math.round(y))),i=4*(py*image.width+px);
  return [toLinear(image.data[i]),toLinear(image.data[i+1]),toLinear(image.data[i+2])];
}
/** A point inside the strip: u runs along it (0 to 1), v across it, between the four corner points. */
export function stripPoint([tl,tr,br,bl],u,v){
  const top=[tl[0]+(tr[0]-tl[0])*u,tl[1]+(tr[1]-tl[1])*u],bottom=[bl[0]+(br[0]-bl[0])*u,bl[1]+(br[1]-bl[1])*u];
  return [top[0]+(bottom[0]-top[0])*v,top[1]+(bottom[1]-top[1])*v];
}
function average(points,image){
  const sum=[0,0,0];for(const [x,y]of points){const p=pixel(image,x,y);sum[0]+=p[0];sum[1]+=p[1];sum[2]+=p[2];}
  return sum.map(v=>v/points.length);
}

/**
 * The colour of each tile, left to right. `corners` are the strip's top-left, top-right,
 * bottom-right and bottom-left in image pixels; `paper` is a point on white paper, or null.
 * Returns {tiles:[{hex,clipped}], paper:{hex}|null, warnings:[]}.
 */
export function readStrip(image,corners,count,paper=null){
  if(!image||!image.data||!(image.width>0)||!(image.height>0))throw Error('Choose a photo first.');
  if(!Array.isArray(corners)||corners.length!==4||corners.some(c=>!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)))throw Error('Mark the four corners of the strip.');
  if(!Number.isInteger(count)||count<1||count>40)throw Error('The strip needs between 1 and 40 tiles.');
  const long=Math.hypot(corners[1][0]-corners[0][0],corners[1][1]-corners[0][1]),short=Math.hypot(corners[3][0]-corners[0][0],corners[3][1]-corners[0][1]);
  if(long<count*6||short<6)throw Error('The marked strip is too small in this photo to read. Take the photo closer, or mark the corners again.');
  const warnings=[];
  let gain=[1,1,1],paperColour=null;
  if(paper){
    const r=Math.max(2,Math.round(Math.min(image.width,image.height)*0.012)),points=[];
    for(let dx=-r;dx<=r;dx+=Math.max(1,Math.floor(r/3)))for(let dy=-r;dy<=r;dy+=Math.max(1,Math.floor(r/3)))points.push([paper[0]+dx,paper[1]+dy]);
    paperColour=average(points,image);
    if(Math.max(...paperColour)>0.985)warnings.push('The paper is overexposed in this photo, so bright colours may read too pale. Retake it a little darker if you can.');
    if(Math.min(...paperColour)<0.08)warnings.push('The spot marked as paper is very dark. Mark a clean patch of white paper in the same light as the strip.');
    gain=paperColour.map(v=>PAPER_WHITE/Math.max(v,0.02));
  }else warnings.push('No white paper was marked, so the colours include the colour of the light. Mark a patch of white paper for a truer reading.');
  const tiles=[];
  for(let i=0;i<count;i+=1){
    // The middle of the tile only: its edges touch the neighbours and catch shadow.
    const points=[];
    for(let a=0;a<9;a+=1)for(let b=0;b<9;b+=1)points.push(stripPoint(corners,(i+0.3+0.4*a/8)/count,0.25+0.5*b/8));
    const raw=average(points,image),balanced=raw.map((v,c)=>v*gain[c]);
    tiles.push({hex:hex(balanced),clipped:Math.max(...raw)>0.985});
  }
  if(tiles.some(t=>t.clipped))warnings.push('Some tiles are overexposed (glare or too much light). Avoid direct light and reflections.');
  return {tiles,paper:paperColour?{hex:hex(paperColour)}:null,warnings};
}
