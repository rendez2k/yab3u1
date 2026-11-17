import test from 'node:test';
import assert from 'node:assert/strict';
import * as paint from '../shared/paint.js';
import {leafTriangles} from '../shared/standard.js';
import {applyTopInterweave,stripeFilament,solidFilament,smallPatches,weave,interweaveProblem,INTERWEAVE_PATH} from '../shared/topInterweave.js';

const enc=new TextEncoder(),dec=new TextDecoder();
const area=t=>{const u=t[1].map((v,i)=>v-t[0][i]),w=t[2].map((v,i)=>v-t[0][i]);return Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])/2;};
const shares=(triangle,node)=>{const by=new Map();for(const leaf of leafTriangles(triangle,node))by.set(leaf.state,(by.get(leaf.state)||0)+area(leaf.triangle));const total=[...by.values()].reduce((a,b)=>a+b,0);return new Map([...by].map(([k,v])=>[k,v/total]));};

test('a 50% blend alternates stripe by stripe and other shares come out in proportion',()=>{
  const half={a:1,b:3,percent:50};
  for(let i=0;i<8;i++)assert.equal(stripeFilament(i,half),i%2?1:3);
  assert.equal(stripeFilament(-1,half),stripeFilament(7,half));
  for(const percent of [17,25,33,50,67,83]){
    let b=0;for(let i=0;i<8;i++)if(stripeFilament(i,{a:1,b:2,percent})===2)b++;
    assert(Math.abs(b/8-percent/100)<=0.09,`${percent}% gave ${b/8}`);
  }
});
test('a large flat face becomes stripes whose printed areas match the blend',()=>{
  const face=[[0,0,5],[24,0,5],[0,24,5]];
  for(const percent of [25,50,75]){
    const node=weave(face,{a:1,b:2,percent},1.2,0,{leaves:1}),got=shares(face,node);
    assert(Math.abs((got.get(2)||0)-percent/100)<0.08,`${percent}% printed ${(got.get(2)||0).toFixed(3)}`);
    // The tree is one the slicer's reader accepts, and only the two reels appear.
    assert.deepEqual(paint.decode(paint.encode(node)),node);assert.deepEqual([...got.keys()].sort(),[1,2]);
  }
  // A face inside one stripe needs no subdivision at all, however long it is along the stripe.
  assert.deepEqual(weave([[0.1,0.1,0],[0.5,0.1,0],[0.1,0.5,0]],{a:1,b:2,percent:50},1.2,0,{leaves:1}),{kind:'leaf',state:2});
  assert.equal(weave([[0,0.2,0],[30,-29.8,0],[0.2,0,0]],{a:1,b:2,percent:50},1.2,0,{leaves:1}).kind,'leaf');
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

test('only upward flat faces are interwoven; the face on the bed is left whole',()=>{
  const entries=project(),before=dec.decode(entries.get('3D/Objects/cube.model'));
  const report=applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes,physical:4});
  const got=faces(entries);
  // Which pair of faces looks up depends on the fixture's winding; exactly one pair is interwoven.
  const woven=got.slice(0,4).filter(states=>states.length===2);
  assert.equal(woven.length,2);assert.deepEqual(woven[0],woven[1]);
  assert.equal(got.slice(0,4).filter(states=>states.length<2).length,2,'the downward pair keeps its single colour');
  // Walls are untouched: painted blend, painted solid, and unpainted.
  assert.deepEqual(got.slice(4),[[5],[5],[2],[2],[],[],[],[]]);
  assert.deepEqual([report.meshes,report.faces,report.facesInterwoven],[1,12,2]);
  // Geometry and face order are exactly as they were.
  const strip=text=>text.replace(/ paint_color="[^"]*"/g,'');
  assert.equal(strip(dec.decode(entries.get('3D/Objects/cube.model'))),strip(before));
  assert.deepEqual(JSON.parse(dec.decode(entries.get(INTERWEAVE_PATH))).validation,{sliced:false,printed:false});
});
test('which faces count as tops follows how the object is turned on the plate',()=>{
  // Tipped a quarter turn about X so the painted side wall faces up; the old top is now a wall.
  const entries=project({transform:'1 0 0 0 0 -1 0 1 0 100 100 20'});
  applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes,physical:4});
  const got=faces(entries);
  assert.deepEqual(got.slice(0,2),[[5],[5]]);assert.deepEqual(got.slice(4,6),[[1,3],[1,3]]);
});
test('gradients, solid colours and unsuitable requests are left alone',()=>{
  const entries=project();
  const none=applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes:[recipes[2]],physical:4});
  assert.equal(none.facesInterwoven,0);assert.equal(none.blends,0);
  assert.match(interweaveProblem({target:'prusa',cell:1.2}),/Snapmaker Orca, Bambu Studio or OrcaSlicer/);
  assert.match(interweaveProblem({target:'snapmaker',cell:5}),/0.4 to 1.6 mm/);
  assert.throws(()=>applyTopInterweave(new Map(),{target:'snapmaker',cell:1.2,recipes,physical:4}),/native slicer project/);
});

test('three-filament blends are striped in proportion, each filament spread evenly',()=>{
  const r={a:1,b:2,percent:25,c:3,percentC:25};
  const counts={1:0,2:0,3:0};for(let i=0;i<8;i++)counts[stripeFilament(i,r)]++;
  assert.deepEqual(counts,{1:4,2:2,3:2});
  // No two neighbouring stripes of the same minority filament.
  for(let i=0;i<8;i++){const here=stripeFilament(i,r),next=stripeFilament(i+1,r);if(here!==1)assert.notEqual(here,next);}
  // A real face carries all three, close to the asked shares.
  const face=[[0,0,0],[40,0,0],[0,40,0]],node=weave(face,r,0.5,0,{leaves:1}),states=new Set(paint.walkStates(node));
  assert.deepEqual([...states].sort(),[1,2,3]);
  // Through the export: the top of the cube, painted with a three-filament blend.
  const entries=project(),three=[{a:1,b:2,percent:25,c:3,percentC:25},{a:2,b:3,percent:25}];
  const report=applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes:three,physical:4});
  assert.equal(report.blends,2);assert.equal(report.threeFilamentBlends,1);assert.equal(report.facesInterwoven,2);
  assert.equal(faces(entries).slice(0,4).filter(st=>st.length===3).length,2);
});
test('a blend that is nearly all one filament prints a shallow face in that filament alone',()=>{
  assert.equal(solidFilament({a:1,b:2,percent:10}),1);assert.equal(solidFilament({a:1,b:2,percent:90}),2);
  assert.equal(solidFilament({a:1,b:2,percent:20}),1);assert.equal(solidFilament({a:1,b:2,percent:25}),0);
  assert.equal(solidFilament({a:1,b:2,percent:10,c:3,percentC:10}),1);assert.equal(solidFilament({a:1,b:2,percent:10,c:3,percentC:15}),0);
  const entries=project(),report=applyTopInterweave(entries,{target:'snapmaker',cell:1.2,recipes:[{a:3,b:1,percent:10}],physical:4});
  const tops=faces(entries).slice(0,4).filter(st=>st.length===1&&st[0]===3);
  assert.equal(tops.length,2,'the upward pair is plain filament 3');
  assert.equal(report.facesSolid,2);assert.equal(report.facesInterwoven,2);
  // The wall painted with the same blend keeps it: layers mix it there.
  assert.deepEqual(faces(entries).slice(4,6),[[5],[5]]);
});

test('a patch too narrow to hold stripes is left to its layer blend',()=>{
  const quad=(x0,y0,x1,y1,state,from)=>[{index:from,points:[[x0,y0,0],[x1,y0,0],[x1,y1,0]],state},{index:from+1,points:[[x0,y0,0],[x1,y1,0],[x0,y1,0]],state}];
  // A 20 mm square is wide; a 20 x 1 mm band and a 2 mm square are not.
  assert.equal(smallPatches(quad(0,0,20,20,5,0)).size,0);
  assert.deepEqual([...smallPatches(quad(0,0,20,1,5,0))],[0,1]);
  assert.deepEqual([...smallPatches(quad(0,0,2,2,5,0))],[0,1]);
  // Touching faces of the same blend are one patch, even when their vertices are stored twice.
  const strip=[...quad(0,0,10,10,5,0),...quad(10,0,20,10,5,2)];
  assert.equal(smallPatches(strip,4).size,0,'two 10 mm squares side by side are 20 x 10');
  // A different blend next door does not widen the patch.
  assert.deepEqual([...smallPatches([...quad(0,0,20,20,5,0),...quad(20,0,21,20,6,2)])].sort(),[2,3]);
  // Through the export: the 20 mm top is striped, but not when patches must be wider than it can be.
  const wide=project(),a=applyTopInterweave(wide,{target:'snapmaker',cell:1.2,recipes,physical:4});
  assert.equal(a.facesInterwoven,2);assert.equal(a.facesLeftSmall,0);
  const narrow=project(),before=dec.decode(narrow.get('3D/Objects/cube.model'));
  const b=applyTopInterweave(narrow,{target:'snapmaker',cell:1.2,recipes,physical:4,minWidth:30});
  assert.equal(b.facesInterwoven,0);assert.equal(b.facesLeftSmall,2);assert.equal(dec.decode(narrow.get('3D/Objects/cube.model')),before);
  // A nearly solid blend still prints a small patch in its main filament.
  const lone=project(),c=applyTopInterweave(lone,{target:'snapmaker',cell:1.2,recipes:[{a:3,b:1,percent:10}],physical:4,minWidth:30});
  assert.equal(c.facesSolid,2);assert.equal(c.facesLeftSmall,0);
});
