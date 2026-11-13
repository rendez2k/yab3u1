import test from 'node:test';
import assert from 'node:assert/strict';
import {readStrip,stripPoint} from '../shared/swatchReader.js';

/** A synthetic photo: paper background, a strip of flat colour tiles, an optional colour cast. */
function photo({tiles,cast=[1,1,1],width=600,height=200,strip=[50,60,550,140]}){
  const data=new Uint8ClampedArray(width*height*4),paper=[236,236,236];
  for(let y=0;y<height;y+=1)for(let x=0;x<width;x+=1){
    let rgb=paper;
    if(x>=strip[0]&&x<strip[2]&&y>=strip[1]&&y<strip[3])rgb=tiles[Math.min(tiles.length-1,Math.floor((x-strip[0])/(strip[2]-strip[0])*tiles.length))];
    const i=4*(y*width+x);data[i]=rgb[0]*cast[0];data[i+1]=rgb[1]*cast[1];data[i+2]=rgb[2]*cast[2];data[i+3]=255;
  }
  return {image:{data,width,height},corners:[[strip[0],strip[1]],[strip[2],strip[1]],[strip[2],strip[3]],[strip[0],strip[3]]],paper:[20,20]};
}
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const close=(h,want,t)=>rgb(h).every((v,i)=>Math.abs(v-want[i])<=t);

test('tiles are read in order from the middle of each one',()=>{
  const tiles=[[200,40,40],[40,160,60],[30,60,200],[230,220,40],[120,120,120]];
  const shot=photo({tiles}),out=readStrip(shot.image,shot.corners,5,shot.paper);
  assert.equal(out.tiles.length,5);
  out.tiles.forEach((tile,i)=>assert.ok(close(tile.hex,tiles[i],8),`tile ${i+1} read ${tile.hex}`));
  assert.deepEqual(out.warnings,[]);
});

test('a colour cast is removed when white paper is marked, and reported when it is not',()=>{
  const tiles=[[200,40,40],[40,160,60],[30,60,200]],plain=photo({tiles}),warm=photo({tiles,cast:[1,0.86,0.7]});
  const reference=readStrip(plain.image,plain.corners,3,plain.paper).tiles,corrected=readStrip(warm.image,warm.corners,3,warm.paper).tiles;
  corrected.forEach((tile,i)=>assert.ok(close(tile.hex,rgb(reference[i].hex),10),`tile ${i+1}: ${tile.hex} against ${reference[i].hex}`));
  const uncorrected=readStrip(warm.image,warm.corners,3,null);
  assert.ok(!close(uncorrected.tiles[2].hex,rgb(reference[2].hex),10));
  assert.match(uncorrected.warnings.join(' '),/white paper/);
});

test('a strip photographed at an angle is still read tile by tile',()=>{
  // Corners given for a strip drawn straight, read through a skewed quad that covers the same tiles' middles.
  assert.deepEqual(stripPoint([[0,0],[100,0],[100,20],[0,20]],0.5,0.5),[50,10]);
  assert.deepEqual(stripPoint([[0,0],[100,10],[100,30],[0,20]],1,1),[100,30]);
});

test('unusable input is refused with a reason, and glare is reported',()=>{
  const shot=photo({tiles:[[255,255,255],[10,10,10]]});
  assert.throws(()=>readStrip(null,shot.corners,2),/photo/);
  assert.throws(()=>readStrip(shot.image,shot.corners.slice(0,3),2),/four corners/);
  assert.throws(()=>readStrip(shot.image,[[0,0],[5,0],[5,3],[0,3]],2),/too small/);
  const out=readStrip(shot.image,shot.corners,2,shot.paper);
  assert.equal(out.tiles[0].clipped,true);assert.match(out.warnings.join(' '),/overexposed/);
});
