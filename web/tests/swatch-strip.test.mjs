import test from 'node:test';
import assert from 'node:assert/strict';
import {readZip} from '../zip.js';
import {stripPlan,stripTiles,swatchStrip,STRIP_TILE,STRIP_BASE} from '../shared/swatchStrip.js';

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
  // Each wall has a wide foot on the bed, and the wall rises from it.
  const ys=[...models.matchAll(/<vertex [^>]*y="([^"]+)"/g)].map(m=>Number(m[1])),zs=[...models.matchAll(/<vertex [^>]*z="([^"]+)"/g)].map(m=>Number(m[1]));
  assert.ok(Math.abs((Math.max(...ys)-Math.min(...ys))-(STRIP_TILE.depth+2*STRIP_BASE.margin))<1e-9);
  assert.equal(Math.min(...zs),0);assert.ok(Math.abs(Math.max(...zs)-(STRIP_BASE.thickness+STRIP_TILE.height))<1e-9);
  assert.equal(zs.filter(z=>z===0).length,15*4,'every piece rests on the bed');
  // Each piece is a closed solid: every edge is shared by exactly two faces, in opposite directions.
  const first=[...models.matchAll(/<object\b[\s\S]*?<\/object>/g)].map(m=>m[0]).find(text=>text.includes('<vertex')),edges=new Map();
  assert.ok(edges.size===0&&first.includes('<triangle'));
  for(const t of first.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)){const v=[1,2,3].map(k=>Number(t[k]));for(let k=0;k<3;k+=1){const a=v[k],b=v[(k+1)%3];edges.set(`${a}>${b}`,(edges.get(`${a}>${b}`)||0)+1);}}
  for(const [edge,count] of edges){const [a,b]=edge.split('>');assert.equal(count,1,edge);assert.equal(edges.get(`${b}>${a}`),1,`${edge} has its opposite`);}
  // Outward facing: the solid's volume comes out positive, and equals foot plus wall.
  const vs=[...first.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(m=>[1,2,3].map(k=>Number(m[k])));let volume=0;
  for(const t of first.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)){const [p,q,r]=[1,2,3].map(k=>vs[Number(t[k])]);volume+=(p[0]*(q[1]*r[2]-q[2]*r[1])-p[1]*(q[0]*r[2]-q[2]*r[0])+p[2]*(q[0]*r[1]-q[1]*r[0]))/6;}
  const w=STRIP_TILE.width+STRIP_TILE.overlap,expected=w*((STRIP_TILE.depth+2*STRIP_BASE.margin)*STRIP_BASE.thickness+STRIP_TILE.depth*STRIP_TILE.height);
  assert.equal(edges.size,84,'twenty-eight faces, three edges each');
  assert.ok(Math.abs(volume-expected)<1e-6,`volume ${volume} against ${expected}`);
  assert.deepEqual(manifest.foot,STRIP_BASE);
  await assert.rejects(swatchStrip({reels,pairs:[[1,2],[1,3],[1,4],[2,3],[2,4]]}),/one to four/);
  await assert.rejects(swatchStrip({reels:[reels[0],{...reels[1],type:'PETG'}],pairs:[[1,2]]}),/same material/);
});
