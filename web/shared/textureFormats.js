// A deliberately bounded subset: static GLB 2, triangulated OBJ+MTL bundles,
// and standard 3MF vertex colours. No URLs or model-supplied code are fetched.
import {readZip} from '../zip.js';
import {pack,channels,identity,multiply,transform,validateModel,MAX_FACES} from './textureModel.js';
const decoder=new TextDecoder();
const finite=v=>{const n=Number(v);if(!Number.isFinite(n))throw Error('Invalid numeric model data.');return n;};
const srgb=x=>255*(x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055);
const linear=x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;
const clamp=x=>Math.max(0,Math.min(255,x));
function wrap(x,mode){if(mode===33071)return Math.max(0,Math.min(1,x));if(mode===33648){const n=((x%2)+2)%2;return n<=1?n:2-n;}return ((x%1)+1)%1;}
export function sample(image,u,v,{flip=false,wrapS=10497,wrapT=10497}={}){
  if(!Number.isFinite(u)||!Number.isFinite(v))throw Error('Invalid texture coordinates.');
  u=wrap(u,wrapS);v=wrap(v,wrapT);if(flip)v=1-v;
  const x=Math.min(image.width-1,Math.floor(u*image.width)),y=Math.min(image.height-1,Math.floor(v*image.height));
  const at=(y*image.width+x)*4;return [image.data[at],image.data[at+1],image.data[at+2],image.data[at+3]];
}
export async function decodeImage(bytes,mime){
  if(!['image/png','image/jpeg'].includes(mime))throw Error('Use PNG or JPEG base-colour textures.');
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0;
  if(mime==='image/png' && bytes.length>=24){width=dv.getUint32(16);height=dv.getUint32(20);}
  else if(mime==='image/jpeg')for(let p=2;p+9<bytes.length;){
    if(bytes[p]!==255)break;const marker=bytes[p+1];if(marker===255){p++;continue;}
    const length=dv.getUint16(p+2);if(length<2)break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=dv.getUint16(p+5);width=dv.getUint16(p+7);break;}p+=length+2;
  }
  if(!width||!height||width*height>134217728)throw Error('Invalid texture or texture larger than 128 megapixels.');
  const scale=Math.min(1,4096/Math.max(width,height));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:mime}),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none',resizeWidth:Math.max(1,Math.round(width*scale)),resizeHeight:Math.max(1,Math.round(height*scale)),resizeQuality:'high'});
  try {
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,bitmap.width,bitmap.height);
  } finally{bitmap.close();}
}
const mimeOf=n=>/\.png$/i.test(n)?'image/png':/\.jpe?g$/i.test(n)?'image/jpeg':'';
function localPath(base,name){
  if(/^[a-z]+:|^\/\//i.test(name))throw Error('External texture URLs are not loaded. Include textures in the ZIP.');
  const parts=[];for(const p of (base+'/'+name.replace(/\\/g,'/')).split('/')){if(!p||p==='.')continue;if(p==='..'){if(!parts.length)throw Error('Texture path leaves the bundle.');parts.pop();}else parts.push(p);}return parts.join('/');
}
function matrixOf(node){
  if(node.matrix)return node.matrix;
  const [x,y,z,w]=node.rotation || [0,0,0,1],s=node.scale||[1,1,1],t=node.translation||[0,0,0];
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,
    (2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,
    (2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
function reverseWinding(indices,m){
  const det=m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);
  if(det<0)for(let i=0;i<indices.length;i+=3){const t=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=t;}
}
export async function readGlb(bytes,{imageDecoder=decodeImage}={}){
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<20||dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2||dv.getUint32(8,true)!==bytes.length)throw Error('Not a complete GLB 2 file.');
  let json,bin;
  for(let at=12;at<bytes.length;){if(at+8>bytes.length)throw Error('Truncated GLB chunk.');const size=dv.getUint32(at,true),type=dv.getUint32(at+4,true);at+=8;if(at+size>bytes.length)throw Error('Truncated GLB chunk.');if(type===0x4e4f534a)json=JSON.parse(decoder.decode(bytes.subarray(at,at+size)));if(type===0x004e4942)bin=bytes.subarray(at,at+size);at+=size;}
  if(!json||!bin||json.asset?.version!=='2.0')throw Error('GLB must contain JSON and embedded geometry.');
  if(json.buffers?.length!==1||json.buffers[0].uri)throw Error('Use a GLB with all geometry embedded.');
  if(json.extensionsRequired?.some(e=>e!=='KHR_materials_unlit'))throw Error('This GLB requires unsupported extensions. Export an uncompressed, static GLB with base-colour textures.');
  if(json.animations?.length||json.skins?.length)throw Error('Bake the desired pose and export a static GLB without animation or skinning.');
  const accessors=new Map(),textures=new Map();
  const viewData=index=>{const v=json.bufferViews?.[index];if(!v||v.buffer!==0||v.extensions)throw Error('Unsupported or missing GLB buffer view.');const start=v.byteOffset||0;if(start<0||v.byteLength<0||start+v.byteLength>bin.length)throw Error('GLB buffer view is outside its buffer.');return {v,start};};
  function accessor(index){
    if(accessors.has(index))return accessors.get(index);
    const a=json.accessors?.[index],n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a?.type],info={5120:[1,'getInt8',127],5121:[1,'getUint8',255],5122:[2,'getInt16',32767],5123:[2,'getUint16',65535],5125:[4,'getUint32',4294967295],5126:[4,'getFloat32',1]}[a?.componentType];
    if(!a||a.sparse||!n||!info||!Number.isInteger(a.count)||a.count<1||a.count>MAX_FACES*3)throw Error('Unsupported GLB accessor; expand sparse/compressed geometry before import.');
    const {v,start}=viewData(a.bufferView),stride=v.byteStride||n*info[0],offset=a.byteOffset||0;
    if(stride<n*info[0]||offset<0||offset+(a.count-1)*stride+n*info[0]>v.byteLength)throw Error('GLB accessor is outside its buffer view.');
    const raw=new DataView(bin.buffer,bin.byteOffset+start,v.byteLength),out=new Float64Array(a.count*n);
    for(let i=0;i<a.count;i++)for(let k=0;k<n;k++){let x=raw[info[1]](offset+i*stride+k*info[0],true);if(a.normalized)x=Math.max(-1,x/info[2]);out[i*n+k]=finite(x);}
    const result={data:out,n,count:a.count};accessors.set(index,result);return result;
  }
  async function texture(info){
    if(!info)return null;if(info.extensions)throw Error('Bake texture transforms into UVs before importing.');
    if(textures.has(info.index))return textures.get(info.index);
    const t=json.textures?.[info.index],im=json.images?.[t?.source];if(!im||im.uri)throw Error('GLB textures must be embedded PNG/JPEG images.');
    const {v,start}=viewData(im.bufferView),image=await imageDecoder(bin.subarray(start,start+v.byteLength),im.mimeType);
    const result={image,...(json.samplers?.[t.sampler] || {})};textures.set(info.index,result);return result;
  }
  const meshes=[],warnings=new Set(['Source lighting, metallic and roughness effects are not printable colours. Base colour is sampled once per triangle.']),stack=new Set();let total=0;
  async function visit(index,parent){
    if(stack.has(index)||stack.size>100)throw Error('Cyclic or excessively deep GLB scene.');const node=json.nodes?.[index];if(!node)throw Error('Missing GLB node.');stack.add(index);
    const matrix=multiply(parent,matrixOf(node));
    if(node.extensions)throw Error('Bake node extensions, including GPU instances, into ordinary meshes before importing.');
    if(node.mesh!==undefined){const mesh=json.meshes?.[node.mesh];if(!mesh)throw Error('Missing GLB mesh.');
      for(const primitive of mesh.primitives){
        if((primitive.mode??4)!==4||primitive.targets||primitive.extensions)throw Error('Export ordinary triangles without morph targets or mesh compression.');
        const pos=accessor(primitive.attributes.POSITION);if(pos.n!==3)throw Error('Positions must be VEC3.');
        const ix=primitive.indices===undefined?null:accessor(primitive.indices);
        if(ix && ix.n!==1)throw Error('Invalid triangle indices.');
        const raw=ix?.data||Uint32Array.from({length:pos.count},(_,i)=>i);
        if(raw.length%3 || (total+=raw.length/3)>MAX_FACES)throw Error('Model exceeds the 2.5 million triangle limit.');
        for(const i of raw)if(!Number.isInteger(i)||i<0||i>=pos.count)throw Error('GLB triangle references a missing vertex.');
        const indices=Uint32Array.from(raw),material=json.materials?.[primitive.material]||{},pbr=material.pbrMetallicRoughness||{};
        if((material.alphaMode||'OPAQUE')!=='OPAQUE'||(pbr.baseColorFactor?.[3]??1)<1)throw Error('Transparent materials need an opaque version before filament conversion.');
        if(material.extensions && Object.keys(material.extensions).some(k=>k!=='KHR_materials_unlit'))throw Error('Bake special material effects into a base-colour texture first.');
        const factor=pbr.baseColorFactor||[1,1,1,1],tex=await texture(pbr.baseColorTexture),uv=tex?accessor(primitive.attributes['TEXCOORD_'+(pbr.baseColorTexture.texCoord||0)]):null;
        const vc=primitive.attributes.COLOR_0===undefined?null:accessor(primitive.attributes.COLOR_0);
        if(uv && (uv.n!==2||uv.count!==pos.count)||vc && (![3,4].includes(vc.n)||vc.count!==pos.count))throw Error('Colour or UV accessor does not match the vertices.');
        const colours=new Uint32Array(indices.length/3);
        for(let f=0;f<colours.length;f++){
          const ids=[indices[f*3],indices[f*3+1],indices[f*3+2]],rgb=[1,1,1];
          if(tex){const u=ids.reduce((s,i)=>s+uv.data[i*2],0)/3,v=ids.reduce((s,i)=>s+uv.data[i*2+1],0)/3;const c=sample(tex.image,u,v,tex);for(let k=0;k<3;k++)rgb[k]=linear(c[k]/255);}
          for(let k=0;k<3;k++)rgb[k]*=finite(factor[k])*(vc?ids.reduce((s,i)=>s+vc.data[i*vc.n+k],0)/3:1);
          colours[f]=pack(...rgb.map(x=>clamp(srgb(Math.max(0,x)))));
        }
        reverseWinding(indices,matrix);meshes.push({name:node.name||mesh.name||'Part',positions:transform(pos.data,matrix),indices,colours});
      }
    }
    for(const child of node.children||[])await visit(child,matrix);stack.delete(index);
  }
  const scene=json.scenes?.[json.scene??0];if(!scene)throw Error('GLB has no default scene.');for(const i of scene.nodes||[])await visit(i,identity());
  return validateModel({name:'Textured GLB',format:'GLB 2 · embedded colours/textures',meshes,up:'y',warnings:[...warnings]});
}
function* lines(text){const re=/[^\r\n]+/g;let m;while((m=re.exec(text)))yield m[0].trim();}
function indexOf(s,count){const n=Number(s),i=n<0?count+n:n-1;if(!Number.isInteger(i)||i<0||i>=count)throw Error('OBJ face references a missing vertex or UV.');return i;}
export async function readObjBundle(entries,{imageDecoder=decodeImage}={}){
  const names=[...entries.keys()].filter(n=>/\.obj$/i.test(n));if(names.length!==1)throw Error('Choose a ZIP containing one OBJ, its MTL and textures. Multiple OBJ models need separate bundles.');
  const name=names[0],base=name.includes('/')?name.slice(0,name.lastIndexOf('/')):'',text=decoder.decode(entries.get(name));
  let vertices=0,uvs=0,faces=0;const libraries=[];
  for(const l of lines(text)){if(l.startsWith('v '))vertices++;if(l.startsWith('vt '))uvs++;if(l.startsWith('f '))faces++;if(l.startsWith('mtllib '))libraries.push(l.slice(7).trim());}
  if(!faces||faces>MAX_FACES||vertices>MAX_FACES*3)throw Error('OBJ exceeds the 2.5 million triangle limit or contains no faces.');
  const materials=new Map();
  for(const lib of libraries){const path=localPath(base,lib),bytes=entries.get(path);if(!bytes)throw Error(`Missing OBJ material file: ${lib}`);let current;
    for(const line of lines(decoder.decode(bytes))){const split=line.indexOf(' '),key=line.slice(0,split),value=line.slice(split+1).trim();
      if(key==='newmtl'){current={rgb:[1,1,1]};materials.set(value,current);}else if(current){
        if(key==='Kd'){current.rgb=value.split(/\s+/).map(finite);if(current.rgb.length!==3)throw Error('Invalid MTL diffuse colour.');}
        if((key==='d'&&finite(value)<1)||(key==='Tr'&&finite(value)>0))throw Error('Export opaque OBJ materials before converting to filaments.');
        if(key==='map_Kd'){if(value.startsWith('-'))throw Error('Bake MTL texture options into the UVs before importing.');const dir=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'',texturePath=localPath(dir,value),image=entries.get(texturePath);if(!image)throw Error(`Missing base-colour texture: ${value}`);current.image=await imageDecoder(image,mimeOf(texturePath));}
      }
    }
  }
  const positions=new Float32Array(vertices*3),texcoords=new Float32Array(uvs*2),indices=new Uint32Array(faces*3),colours=new Uint32Array(faces);
  let v=0,vt=0,f=0,material={rgb:[1,1,1]};
  for(const line of lines(text)){
    if(line.startsWith('v ')){const p=line.slice(2).split(/\s+/).map(finite);if(p.length!==3)throw Error('OBJ vertex extensions are unsupported; export ordinary XYZ vertices.');positions.set(p,v++*3);}
    else if(line.startsWith('vt ')){const p=line.slice(3).split(/\s+/).map(finite);if(p.length<2)throw Error('Incomplete OBJ UV.');texcoords.set(p.slice(0,2),vt++*2);}
    else if(line.startsWith('usemtl ')){material=materials.get(line.slice(7).trim());if(!material)throw Error('OBJ uses a missing material.');}
    else if(line.startsWith('f ')){
      const corners=line.slice(2).split(/\s+/);if(corners.length!==3)throw Error('Triangulate the OBJ before import; polygon faces are not guessed.');
      const ids=corners.map(s=>s.split('/'));ids.forEach((c,k)=>indices[f*3+k]=indexOf(c[0],v));
      let rgb=material.rgb.map(x=>clamp(x*255));
      if(material.image){const uv=ids.map(c=>indexOf(c[1],vt));const u=uv.reduce((s,i)=>s+texcoords[i*2],0)/3,w=uv.reduce((s,i)=>s+texcoords[i*2+1],0)/3,c=sample(material.image,u,w,{flip:true});if(c[3]<255)throw Error('Transparent texture pixels need an opaque source image.');rgb=c.slice(0,3).map((x,k)=>clamp(x*material.rgb[k]));}
      colours[f++]=pack(...rgb);
    }
  }
  return validateModel({name:name.split('/').pop(),format:'OBJ + MTL · colour texture/materials',up:'y',meshes:[{name:'OBJ model',positions,indices,colours}],warnings:['OBJ units and up axis are not defined reliably: confirm orientation and height. Metallic and roughness maps are ignored. Base colour is sampled once per triangle.']});
}
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].split(':').pop(),m[2]]));
function matrix3mf(s){if(!s)return identity();const v=s.trim().split(/\s+/).map(finite);if(v.length!==12)throw Error('Invalid 3MF transform.');return [v[0],v[1],v[2],0,v[3],v[4],v[5],0,v[6],v[7],v[8],0,v[9],v[10],v[11],1];}
export function readColour3mf(entries){
  const docs=new Map();
  for(const [path,bytes] of entries){if(!/\.model$/i.test(path))continue;const text=decoder.decode(bytes),unit=attrs(/<model\b([^>]*)>/.exec(text)?.[1]||'').unit||'millimeter';
    if(unit!=='millimeter')throw Error('Resave this colour 3MF in millimetres first.');
    if(/texture2d|basematerials|multiproperties|paint_color|mmu_segmentation/.test(text))throw Error('Use this step for standard vertex-colour 3MFs. Use the normal converter for slicer paint, or GLB for textures.');
    const groups=new Map();
    for(const match of text.matchAll(/<(?:\w+:)?colorgroup\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?colorgroup>/g)){
      const colours=[...match[2].matchAll(/<(?:\w+:)?color\b([^>]*)>/g)].map(m=>{const c=attrs(m[1]).color;if(!/^#[0-9a-f]{6}(?:ff)?$/i.test(c||''))throw Error('Unsupported or transparent 3MF colour.');return parseInt(c.slice(1,7),16);});groups.set(attrs(match[1]).id,colours);
    }
    const objects=new Map();for(const m of text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g))objects.set(attrs(m[1]).id,{a:attrs(m[1]),body:m[2]});
    const build=/<build\b[^>]*>([\s\S]*?)<\/build>/.exec(text)?.[1]||'';docs.set(path,{groups,objects,build});
  }
  // This path intentionally imports appearance only, never slicer modifiers or
  // machine settings. Refuse special volumes rather than flatten them to solids.
  for(const [name,data] of entries)if(/model_settings\.config$/.test(name)&&/negative_part|modifier|support_blocker|support_enforcer/.test(decoder.decode(data)))throw Error('Colour reduction cannot flatten modifier or negative volumes. Use the standard converter.');
  const meshes=[],stack=new Set();let total=0;
  function visit(path,id,parent){
    const key=path+'#'+id;if(stack.has(key)||stack.size>100)throw Error('Cyclic 3MF assembly.');stack.add(key);const doc=docs.get(path),o=doc?.objects.get(id);if(!o)throw Error('Missing 3MF component.');
    if(o.body.includes('<mesh')){
      let nv=0,nf=0;for(const _ of o.body.matchAll(/<vertex\s/g))nv++;for(const _ of o.body.matchAll(/<triangle\s/g))nf++;
      if((total+=nf)>MAX_FACES||nv>MAX_FACES*3)throw Error('Model exceeds the 2.5 million triangle limit.');
      const positions=new Float32Array(nv*3),indices=new Uint32Array(nf*3),colours=new Uint32Array(nf);let i=0;
      for(const m of o.body.matchAll(/<vertex\b([^>]*)>/g)){const a=attrs(m[1]);positions.set([finite(a.x),finite(a.y),finite(a.z)],i++*3);}i=0;
      for(const m of o.body.matchAll(/<triangle\b([^>]*)>/g)){const a=attrs(m[1]),table=doc.groups.get(a.pid||o.a.pid);if(!table)throw Error('Missing 3MF colour group.');const first=Number(a.p1??o.a.pindex??0),ids=[first,Number(a.p2??first),Number(a.p3??first)];if(ids.some(x=>!Number.isInteger(x)||table[x]===undefined))throw Error('Missing 3MF corner colour.');
        indices.set([a.v1,a.v2,a.v3].map(s=>{const x=finite(s);if(!Number.isInteger(x)||x<0||x>=nv)throw Error('Invalid 3MF vertex index.');return x;}),i*3);
        const rgb=ids.map(x=>channels(table[x]));colours[i++]=pack(...[0,1,2].map(k=>rgb.reduce((s,c)=>s+c[k],0)/3));
      }
      reverseWinding(indices,parent);meshes.push({name:o.a.name||'Part '+id,positions:transform(positions,parent),indices,colours});
    }
    for(const m of o.body.matchAll(/<component\b([^>]*)>/g)){const a=attrs(m[1]);visit(a.path?localPath('',a.path):path,a.objectid,multiply(parent,matrix3mf(a.transform)));}stack.delete(key);
  }
  const root=docs.get('3D/3dmodel.model');if(!root)throw Error('Missing 3MF root model.');for(const m of root.build.matchAll(/<item\b([^>]*)>/g)){const a=attrs(m[1]);if(a.printable!=='0')visit('3D/3dmodel.model',a.objectid,matrix3mf(a.transform));}
  return validateModel({name:'Vertex-colour 3MF',format:'3MF · standard vertex colours',up:'z',meshes,warnings:['Corner colours are averaged per triangle before palette reduction. Source printer, supports and process settings are not imported in this appearance-only workflow.']});
}
export async function readTextureModel(bytes,name,options={}){
  let model;
  if(/\.glb$/i.test(name))model=await readGlb(bytes,options);
  else if(/\.(zip|3mf)$/i.test(name)){
    const entries=await readZip(bytes,{include:n=>/\.3mf$/i.test(name)?/\.model$|model_settings\.config$/i.test(n):/\.(obj|mtl|png|jpe?g)$/i.test(n)});
    model=/\.3mf$/i.test(name)?readColour3mf(entries):await readObjBundle(entries,options);
  }else throw Error('Choose a GLB, an OBJ+MTL+textures ZIP, or a vertex-colour 3MF.');
  model.name=name.replace(/\.[^.]+$/,'');return model;
}
