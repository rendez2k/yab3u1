import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {readGlb,readObjBundle,readColour3mf,sample} from '../shared/textureFormats.js';
import {histogram,reducePalette,previewMesh,printable3mf,orientedPositions} from '../shared/textureModel.js';
import {readZip} from '../zip.js';
import {readProject,convertProject,summary} from '../shared/project.js';
const enc=new TextEncoder();
const image={width:2,height:2,data:new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])};
assert.deepEqual(sample(image,.1,.1),[255,0,0,255]);
assert.deepEqual(sample(image,.1,.1,{flip:true}),[0,0,255,255]);
assert.deepEqual(sample(image,1.1,.1),[255,0,0,255]);
assert.deepEqual(sample(image,1.1,.1,{wrapS:33071}),[0,255,0,255]);
function glb(patch=()=>{}){
 const pos=new Float32Array([0,0,0,1,0,0,0,1,0]),uv=new Float32Array([.1,.1,.1,.1,.1,.1]);
 const data=new Uint8Array(64);data.set(new Uint8Array(pos.buffer));data.set(new Uint8Array(uv.buffer),36);
 const j={asset:{version:'2.0'},buffers:[{byteLength:64}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:4}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5126,count:3,type:'VEC2'}],images:[{bufferView:2,mimeType:'image/png'}],textures:[{source:0}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],nodes:[{translation:[2,3,4],mesh:0}],scenes:[{nodes:[0]}],scene:0};patch(j);
 let s=JSON.stringify(j);while(s.length%4)s+=' ';const json=enc.encode(s),out=new Uint8Array(28+json.length+data.length),dv=new DataView(out.buffer);
 [0x46546c67,2,out.length,json.length,0x4e4f534a].forEach((x,i)=>dv.setUint32(i*4,x,true));out.set(json,20);dv.setUint32(20+json.length,data.length,true);dv.setUint32(24+json.length,0x004e4942,true);out.set(data,28+json.length);return out;
}
const opts={imageDecoder:async()=>image};
const model=await readGlb(glb(),opts);
assert.equal(model.meshes[0].colours[0],0xff0000);
assert.deepEqual(model.bounds.min,[2,3,4]);assert.deepEqual(model.bounds.max,[3,4,4]);
await assert.rejects(()=>readGlb(glb(j=>j.images[0]={uri:'https://example.com/private.png'}),opts),/embedded/);
await assert.rejects(()=>readGlb(glb(j=>j.accessors[0].count=100),opts),/outside/);
await assert.rejects(()=>readGlb(glb(j=>j.nodes[0].children=[0]),opts),/Cyclic/);
await assert.rejects(()=>readGlb(glb(j=>j.materials[0].alphaMode='BLEND'),opts),/Transparent/);
const mirrored=await readGlb(glb(j=>j.nodes[0].scale=[-1,1,1]),opts);assert.deepEqual([...mirrored.meshes[0].indices],[0,2,1]);
const instance=await readGlb(glb(j=>{j.nodes.push({mesh:0,translation:[10,0,0]});j.scenes[0].nodes.push(1);}),opts);assert.equal(instance.faces,2);
const bundle=new Map([['model.obj',enc.encode('mtllib model.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt .1 .1\nusemtl colour\nf -3/1 -2/1 -1/1\n')],['model.mtl',enc.encode('newmtl colour\nKd 1 1 1\nmap_Kd diffuse.png\n')],['diffuse.png',new Uint8Array([1])]]);
const obj=await readObjBundle(bundle,opts);assert.equal(obj.meshes[0].colours[0],0x0000ff);
await assert.rejects(()=>readObjBundle(new Map([...bundle].filter(([n])=>n!=='diffuse.png')),opts),/Missing base-colour/);
const malicious=new Map(bundle);malicious.set('model.mtl',enc.encode('newmtl colour\nmap_Kd https://example.com/image.png'));await assert.rejects(()=>readObjBundle(malicious,opts),/External/);
const m=instance.meshes[1];m.colours[0]=0x0000ff;
const rows=histogram(instance),reduced=reducePalette(rows,4);assert.equal(reduced.palette.length,2);assert.ok(reduced.palette.includes('#FF0000'));assert.ok(reduced.palette.includes('#0000FF'));
assert.deepEqual(reducePalette(rows,4).palette,reduced.palette);
assert.ok(previewMesh(instance).positions.length>0);
assert.throws(()=>orientedPositions(m.positions,'y',0,instance.bounds),/height/);
const bytes=await printable3mf(instance,reduced,{height:50,up:'y'}),entries=await readZip(bytes),project=readProject(entries);
assert.equal(project.colors.length,2);assert.equal(summary(project,project.plates[0].id).triangles,2);
for(const target of ['snapmaker','bambu','orca','prusa']){const out=convertProject(project,project.plates[0].id,null,{target});assert.deepEqual(out.problems,[],target);assert.equal(readProject(out.entries).colors.length,2,target);}
const corner=new Map([['3D/3dmodel.model',enc.encode('<model unit="millimeter"><resources><m:colorgroup id="7"><m:color color="#FF0000FF"/><m:color color="#00FF00FF"/><m:color color="#0000FFFF"/></m:colorgroup><object id="1" pid="7"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2" p1="0" p2="1" p3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>')]]);
assert.equal(readColour3mf(corner).meshes[0].colours[0],0x555555);
const real='C:/Users/rende/Desktop/Hi3D_Kawaii Military Green Round Chibi Mech Robot 3D Model_allparts_20260924_190350.3mf';
if(process.env.TEST_REAL_TEXTURE && existsSync(real)){
 const robot=readColour3mf(await readZip(new Uint8Array(readFileSync(real))));assert.equal(robot.faces,1981484);
 const palette=reducePalette(histogram(robot),5);assert.equal(palette.palette.length,5);
 const prepared=await printable3mf(robot,palette,{height:150,up:'z'});const parsed=readProject(await readZip(prepared));assert.equal(parsed.colors.length,5);assert.equal(summary(parsed,parsed.plates[0].id).triangles,1981484);
 console.log('PASS actual robot 3MF:',robot.faces,'triangles',palette.palette,prepared.length,'bytes');
}
console.log('PASS texture sampling, UV direction, transforms, instances, input guards, palette clustering and four-target colour export');
