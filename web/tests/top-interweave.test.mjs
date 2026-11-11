import test from 'node:test';
import assert from 'node:assert/strict';
import * as paint from '../shared/paint.js';
import {leafTriangles} from '../shared/standard.js';
import {applyTopInterweave,cellFilament,weave,interweaveProblem,INTERWEAVE_PATH} from '../shared/topInterweave.js';

const enc=new TextEncoder(),dec=new TextDecoder();
const area=t=>{const u=t[1].map((v,i)=>v-t[0][i]),w=t[2].map((v,i)=>v-t[0][i]);return Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])/2;};
const shares=(triangle,node)=>{const by=new Map();for(const leaf of leafTriangles(triangle,node))by.set(leaf.state,(by.get(leaf.state)||0)+area(leaf.triangle));const total=[...by.values()].reduce((a,b)=>a+b,0);return new Map([...by].map(([k,v])=>[k,v/total]));};

test('a 50% blend is an exact chequer and other shares come out in proportion',()=>{
  const half={a:1,b:3,percent:50};
  for(let i=0;i<6;i++)for(let j=0;j<6;j++)assert.equal(cellFilament(i,j,half),(i+j)%2?1:3);
  assert.equal(cellFilament(-1,0,half),cellFilament(3,0,half));
  for(const percent of [17,25,33,50,67,83]){
    let b=0;for(let i=0;i<16;i++)for(let j=0;j<16;j++)if(cellFilament(i,j,{a:1,b:2,percent})===2)b++;
    assert(Math.abs(b/256-percent/100)<0.04,`${percent}% gave ${b/256}`);
  }
});
test('a large flat face becomes a chequer whose printed areas match the blend',()=>{
  const face=[[0,0,5],[24,0,5],[0,24,5]];
  for(const percent of [25,50,75]){
    const node=weave(face,{a:1,b:2,percent},1.2,0,{leaves:1}),got=shares(face,node);
    assert(Math.abs((got.get(2)||0)-percent/100)<0.06,`${percent}% printed ${(got.get(2)||0).toFixed(3)}`);
    // The tree is one the slicer's reader accepts, and only the two reels appear.
    assert.deepEqual(paint.decode(paint.encode(node)),node);assert.deepEqual([...got.keys()].sort(),[1,2]);
  }
  // A face inside one cell needs no subdivision at all.
  assert.deepEqual(weave([[0.1,0.1,0],[0.5,0.1,0],[0.1,0.5,0]],{a:1,b:2,percent:50},1.2,0,{leaves:1}),{kind:'leaf',state:2});
});

function project({transform='1 0 0 0 1 0 0 0 1 100 100 0'}={}){
  // A 20 mm cube: two triangles per side. Top painted with blend 5, one side with blend 5, the rest unpainted (blend 6 by the part).
  const v=[[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]];
  const blend=paint.encode({kind:'leaf',state:5}),solid=paint.encode({kind:'leaf',state:2});
  const tris=[[4,5,6,blend],[4,6,7,blend],[0,2,1,''],[0,3,2,''],[0,1,5,blend],[0,5,4,blend],[1,2,6,solid],[1,6,5,solid],[2,3,7,''],[2,7,6,''],[3,0,4,''],[3,4,7,'']];
  const mesh=`<object id="1" type="model"><mesh><vertices>${v.map(p=>`<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${tris.map(t=>`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${t[3]?` paint_color="${t[3]}"`:''}/>`).join('')}</triangles></mesh></object>`;
  return new Map([
    ['3D/3dmodel.model',enc.encode(`<model xmlns:p="x"><resources><object id="2" type="model"><components><component p:path="/3D/Objects/cube.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources><build><item objectid="2" transform="${transform}" printable="1"/></build></model>`)],
    ['3D/Objects/cube.model',enc.encode(`<model><resources>${mesh}</resources><build/></model>`)],
    ['Metadata/model_settings.config',enc.encode('<config><object id="2"><metadata key="name" value="Cube"/><metadata key="extruder" value="6"/><part id="1" subtype="normal_part"><metadata key="name" value="Cube"/><metadata key="extruder" value="6"/></part></object></config>')]]);
}
const recipes=[{a:1,b:3,percent:50},{a:2,b:3,percent:25},{a:1,b:2,percent:40,gradient:{start:20,end:80}}];
const faces=entries=>[...dec.decode(entries.get('3D/Objects/cube.model')).matchAll(/<triangle\b([^>]*)\/>/g)].map(m=>{const p=/paint_color="([0-9A-F]+)"/i.exec(m[1]);return p?[...new Set(paint.walkStates(paint.decode(p[1])))].sort():[];});

test('only flat top and bottom faces are interwoven, with the two filaments of each blend',()=>{
  const entries=project(),before=dec.decode(entries.get('3D/Objects/cube.model'));
  const report=applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes,physical:4});
  const got=faces(entries);
  // Top (blend 5 = reels 1 and 3) and bottom (unpainted, so the part's blend 6 = reels 2 and 3).
  assert.deepEqual(got.slice(0,4),[[1,3],[1,3],[2,3],[2,3]]);
  // Walls are untouched: painted blend, painted solid, and unpainted.
  assert.deepEqual(got.slice(4),[[5],[5],[2],[2],[],[],[],[]]);
  assert.deepEqual([report.meshes,report.faces,report.facesInterwoven,report.blends],[1,12,4,2]);
  // Geometry and face order are exactly as they were.
  const strip=text=>text.replace(/ paint_color="[^"]*"/g,'');
  assert.equal(strip(dec.decode(entries.get('3D/Objects/cube.model'))),strip(before));
  assert.deepEqual(JSON.parse(dec.decode(entries.get(INTERWEAVE_PATH))).validation,{sliced:false,printed:false});
});
test('which faces count as tops follows how the object is turned on the plate',()=>{
  // Tipped a quarter turn about X: the painted side wall now faces up or down, the old top is a wall.
  const entries=project({transform:'1 0 0 0 0 1 0 -1 0 100 100 20'});
  applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes,physical:4});
  const got=faces(entries);
  assert.deepEqual(got.slice(0,2),[[5],[5]]);assert.deepEqual(got.slice(4,6),[[1,3],[1,3]]);
});
test('gradients, solid colours and unsuitable requests are left alone',()=>{
  const entries=project();
  const none=applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes:[recipes[2]],physical:4});
  assert.equal(none.facesInterwoven,0);assert.equal(none.blends,0);
  assert.match(interweaveProblem({target:'prusa',cell:1.2}),/Snapmaker Orca, Bambu Studio or OrcaSlicer/);
  assert.match(interweaveProblem({target:'snapmaker',cell:5}),/0.8 to 2.4 mm/);
  assert.throws(()=>applyTopInterweave(new Map(),{target:'snapmaker',cell:1.2,recipes,physical:4}),/native slicer project/);
});
