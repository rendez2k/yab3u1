import test from 'node:test';
import assert from 'node:assert/strict';
import {neckCandidates} from './neck-candidates.js';
import {splitAtNeck,assemblyMeshHealth} from './assembly-split.js';
import {signedVolume} from './mesh-cut.js';
import {cutPaintedPart} from './painted-cut.js';
import {noSplitReason} from './split-result.js';
import {encode,decode} from '../../web/shared/paint.js';
import {leafTriangles} from '../../web/shared/standard.js';

function turned(profile,steps=32){
  const rings=profile.map(([z,r])=>Array.from({length:steps},(_,i)=>[r*Math.cos(i*Math.PI*2/steps),r*Math.sin(i*Math.PI*2/steps),z])),faces=[];
  const face=(points,state)=>faces.push({points,attrs:` paint_color="${encode({kind:'leaf',state})}"`});
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<steps;i++){const k=(i+1)%steps,state=1+(i%2)+(j>=5?2:0);face([rings[j][i],rings[j][k],rings[j+1][k]],state);face([rings[j][i],rings[j+1][k],rings[j+1][i]],state);}
  for(let i=0;i<steps;i++){const k=(i+1)%steps;face([[0,0,profile[0][0]],rings[0][k],rings[0][i]],1);face([[0,0,profile.at(-1)[0]],rings.at(-1)[i],rings.at(-1)[k]],3);}
  return {name:'Painted neck fixture',faces,base:1,subtype:'normal_part',settings:{}};
}
const profile=[[0,8],[5,16],[12,20],[18,15],[23,6],[26,5],[29,6],[34,15],[40,20],[47,16],[52,8]];

test('narrow-section proposals reject broad convex solids and tiny end details',()=>{
  assert.deepEqual(neckCandidates(turned([[0,8],[10,16],[20,20],[30,16],[40,8]]).faces),[]);
  assert.deepEqual(neckCandidates(turned([[0,15],[40,15],[41,2],[43,2],[44,3],[46,2]]).faces),[]);
  const candidates=neckCandidates(turned(profile).faces);assert(candidates.length);assert.equal(candidates[0].axis,2);assert(Math.abs(candidates[0].height-26)<1);
});

test('narrow-section cut retains colours and volume in two closed substantial pieces',()=>{
  const part=turned(profile),before=JSON.stringify(part),out=splitAtNeck(part);assert(out.result);
  assert(out.result.parts.every(p=>assemblyMeshHealth(p.faces).ok));
  assert(Math.abs(out.result.parts.reduce((n,p)=>n+signedVolume(p.faces),0)-signedVolume(part.faces))<1e-6);
  const attrs=new Set(out.result.parts.flatMap(p=>p.faces.map(f=>f.attrs)));for(const f of part.faces)assert(attrs.has(f.attrs));
  assert.equal(JSON.stringify(part),before);assert.deepEqual(splitAtNeck(part),out);
});

test('narrow sections add validated pins or dowels and refuse oversized connectors',()=>{
  const part=turned(profile);
  for(const kind of ['pin','dowel']){const out=splitAtNeck(part,{connector:{kind,diameter:3,length:3,clearance:.3}});assert(out.result);assert.equal(out.result.joint.kind,kind);assert(out.result.parts.every(p=>assemblyMeshHealth(p.faces).ok));assert.equal(out.result.loose.length,kind==='dowel'?1:0);for(const p of out.result.loose)assert(assemblyMeshHealth(p.faces).ok);}
  assert(!splitAtNeck(part,{connector:{diameter:20,length:20,clearance:1}}).result);
});

test('resolving paint at a cut matches adjacent triangle edges without changing the surface volume',()=>{
  const part=turned(profile);const split=encode({kind:'split',sides:1,specialSide:0,children:[{kind:'leaf',state:1},{kind:'leaf',state:2}]});
  const crossed=part.faces.findIndex(f=>f.points.some(p=>p[2]<25)&&f.points.some(p=>p[2]>25));part.faces[crossed]={...part.faces[crossed],attrs:` paint_color="${split}"`};
  const out=cutPaintedPart(part,2,25,null,{singleJoin:true,conform:true});assert(out.parts.every(p=>assemblyMeshHealth(p.faces).ok));
  assert(Math.abs(out.parts.reduce((n,p)=>n+signedVolume(p.faces),0)-signedVolume(part.faces))<1e-6);
});

test('a long connected painted boundary remains closed and retains each colour surface area',()=>{
  const rows=Array.from({length:81},(_,i)=>[i*.65,8+Math.abs(i-40)*.25]),part=turned(rows,16);
  const state=f=>decode(/paint_color="([^"]*)"/.exec(f.attrs)[1]).state;
  part.faces=part.faces.map(f=>({...f,attrs:` paint_color="${encode({kind:'split',sides:3,specialSide:0,children:[1,2,3,4].map(n=>({kind:'leaf',state:(state(f)+n-2)%4+1}))})}"`}));
  const surfaceArea=faces=>{const out=[0,0,0,0];for(const f of faces)for(const leaf of leafTriangles(f.points,decode(/paint_color="([^"]*)"/.exec(f.attrs)[1]))){const [a,b,c]=leaf.triangle,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);out[leaf.state-1]+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}return out;};
  const height=25.123,out=cutPaintedPart(part,2,height,null,{singleJoin:true,conform:true});
  assert(out.parts.every(p=>assemblyMeshHealth(p.faces).ok));
  const before=surfaceArea(part.faces),after=surfaceArea(out.parts.flatMap(p=>p.faces).filter(f=>!f.points.every(p=>Math.abs(p[2]-height)<1e-7)));
  before.forEach((a,i)=>assert(Math.abs(a-after[i])<1e-7));
  assert(Math.abs(out.parts.reduce((n,p)=>n+signedVolume(p.faces),0)-signedVolume(part.faces))<1e-6);
});

test('failed split reports the blocking join rather than the small-details note',()=>{
  const note={informational:true,reason:'Small details stay attached.'},block={reason:'The joining surface could not be closed.'};
  assert.equal(noSplitReason([{retained:[note,block]}]),block.reason);
  assert.match(noSplitReason([{retained:[note]}]),/No suitable join/);
  assert.equal(noSplitReason([{retained:[block]},{needsRepair:true,retained:[{reason:'Repair the mesh.'}]}]),'Repair the mesh.');
});
