import test from 'node:test';
import assert from 'node:assert/strict';
import {readZip} from '../zip.js';
import {stripPlan,stripTiles,swatchStrip,STRIP_TILE} from '../shared/swatchStrip.js';

const reels=['#0086D6','#D9308A','#F7E400','#FFFFFF'].map((color,i)=>({color,type:'PLA',name:`Reel ${i+1}`}));
const dec=new TextDecoder();

test('four reels make two strips of three pairs; a strip never exceeds four pairs',()=>{
  assert.deepEqual(stripPlan(reels),[[[1,2],[1,3],[1,4]],[[2,3],[2,4],[3,4]]]);
  assert.deepEqual(stripPlan(reels.slice(0,2)),[[[1,2]]]);
  assert.deepEqual(stripPlan(reels.slice(0,3)),[[[1,2],[1,3],[2,3]]]);
  const five=[...reels,{color:'#000000',type:'PLA'}];
  assert.ok(stripPlan(five).every(strip=>strip.length<=4));assert.equal(stripPlan(five).flat().length,10);
  // Different materials are never paired, nor is a reserved support reel.
  assert.deepEqual(stripPlan([reels[0],{...reels[1],type:'PETG'},reels[2]]),[[[1,3]]]);
  assert.deepEqual(stripPlan([reels[0],reels[1],{...reels[2],role:'support-interface'}]),[[[1,2]]]);
});

test('tiles read left to right: pure A, three shares, pure B, for each pair',()=>{
  const tiles=stripTiles([[1,2],[1,3]]);
  assert.deepEqual(tiles.map(t=>t.percent),[0,25,50,75,100,0,25,50,75,100]);
  assert.equal(tiles[1].label,'75% slot 1 + 25% slot 2');assert.equal(tiles[9].label,'Pure slot 3');
});

test('a strip is a native project of touching walls with its blends in the slicer table',async()=>{
  const pairs=stripPlan(reels)[0],zip=await readZip(await swatchStrip({reels,pairs,height:0.12,subdivideMixLayer:true}));
  const cfg=JSON.parse(dec.decode(zip.get('Metadata/project_settings.config')));
  const rows=cfg.mixed_filament_definitions.split(';').filter(row=>!row.includes(',d1,'));
  assert.equal(rows.length,9);assert.ok(rows[0].startsWith('1,2,1,1,25,'));assert.ok(rows[8].startsWith('1,4,1,1,75,'));
  const manifest=JSON.parse(dec.decode(zip.get('Metadata/YAB3D_swatch_strip.json')));
  assert.equal(manifest.tiles.length,15);assert.deepEqual(manifest.validation,{sliced:false,printed:false});
  // Fifteen separate walls, each one tile wide plus the small overlap that joins it to its neighbour.
  const models=[...zip].filter(([name])=>/^3D\/.*\.model$/.test(name)).map(([,data])=>dec.decode(data)).join('');
  const xs=[...models.matchAll(/<vertex x="([^"]+)"/g)].map(m=>Number(m[1]));
  assert.ok(Math.abs((Math.max(...xs)-Math.min(...xs))-(15*STRIP_TILE.width+STRIP_TILE.overlap))<0.01);
  await assert.rejects(swatchStrip({reels,pairs:[[1,2],[1,3],[1,4],[2,3],[2,4]]}),/one to four/);
  await assert.rejects(swatchStrip({reels:[reels[0],{...reels[1],type:'PETG'}],pairs:[[1,2]]}),/same material/);
});
