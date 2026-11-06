// Original analytical coupons. Publicly documented wall construction;
// no third-party calibration tables or colour predictions are embedded.
import {mkdir,writeFile} from 'node:fs/promises';
import {readProject,exportProject,previewSoup,SRC_BBL_PROJECT} from '../web/shared/project.js';
import {renderIso,downscale} from '../web/shared/raster.js';
import {encodePng} from '../web/shared/png.js';
import {writeZip} from '../web/zip.js';
import {wallTestSetup} from '../web/shared/wallComparison.js';
const output='deliverables/elegoo-ordered-wall-test-2026-11-07';
await mkdir(output,{recursive:true});
const setup=wallTestSetup({height:0.08}), enc=new TextEncoder(),dec=new TextDecoder();
const codes={C:1,M:2,Y:3,W:4}, base=0.6,layer=0.08,layers=75,radius=5,outerWidth=0.3,innerWidth=0.9;
const definitions=[
  ['C','C','Pure cyan'],['Y','Y','Pure yellow'],
  ['C','Y','Cyan outside / yellow inside'],['Y','C','Yellow outside / cyan inside'],
  ['CY','CY','Same CY sequence, aligned'],['CY','YC','Same shares, opposite phase'],
  ['CYY','CYY','Yellow-rich sequence, aligned'],['CYY','YYC','Same shares, shifted inner sequence'],
];
function box(x,y,z,w,d,h){return {v:[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],f:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]};}
function ring(ro,ri,z,h){const n=96,v=[],f=[];for(const [r,dz]of [[ro,0],[ro,h],[ri,0],[ri,h]])for(let i=0;i<n;i++)v.push([7.5+r*Math.cos(i*2*Math.PI/n),12+r*Math.sin(i*2*Math.PI/n),z+dz]);for(let i=0;i<n;i++){const j=(i+1)%n;for(const [a,b,c,d]of [[i,j,n+j,n+i],[2*n+j,2*n+i,3*n+i,3*n+j],[n+i,n+j,3*n+j,3*n+i],[j,i,2*n+i,2*n+j]])f.push([a,b,c],[a,c,d]);}return {v,f};}
function merge(meshes){const v=[],f=[];for(const m of meshes){let offset=v.length;v.push(...m.v);f.push(...m.f.map(t=>t.map(i=>i+offset)));}return {v,f};}
const digits=['','010/110/010/010/111','111/001/111/100/111','111/001/111/001/111','101/101/111/001/001','111/100/111/001/111','111/100/111/101/111','111/001/010/010/010','111/101/111/101/111'];
const objects=[],meta=[],items=[],samples=[];let next=1;
const number=v=>Number(v.toFixed(7));
for(const [i,[outer,inner,label]]of definitions.entries()){
  const meshes=new Map(),add=(slot,m)=>{if(!meshes.has(slot))meshes.set(slot,[]);meshes.get(slot).push(m);};
  add(4,box(0,0,0,15,20,base));
  digits[i+1].split('/').forEach((row,y)=>[...row].forEach((on,x)=>{if(on==='1')add(4,box(6.6+x*0.6,4.6-y*0.6,base,0.6,0.6,0.16));}));
  for(const [sequence,ro,ri]of [[outer,radius,radius-outerWidth],[inner,radius-outerWidth,radius-outerWidth-innerWidth]]){
    let start=0;while(start<layers){let end=start+1;while(end<layers&&sequence[end%sequence.length]===sequence[start%sequence.length])end++;add(codes[sequence[start%sequence.length]],ring(ro,ri,base+start*layer,(end-start)*layer));start=end;}
  }
  const refs=[],parts=[];
  for(const [slot,list]of meshes){const m=merge(list),id=next++;objects.push(`<object id="${id}" type="model"><mesh><vertices>${m.v.map(v=>`<vertex x="${number(v[0])}" y="${number(v[1])}" z="${number(v[2])}"/>`).join('')}</vertices><triangles>${m.f.map(t=>`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh></object>`);refs.push(`<component objectid="${id}"/>`);parts.push(`<part id="${id}" subtype="normal_part"><metadata key="name" value="${slot===4?'White base and number':slot===1?'Cyan bands':'Yellow bands'}"/><metadata key="extruder" value="${slot}"/></part>`);}
  const id=next++,x=65+(i%4)*23,y=155+Math.floor(i/4)*28;
  objects.push(`<object id="${id}" type="model"><components>${refs.join('')}</components></object>`);
  items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} 0"/>`);
  meta.push(`<object id="${id}"><metadata key="name" value="${i+1} ${label}"/><metadata key="extruder" value="4"/>${parts.join('')}</object>`);
  samples.push({number:i+1,label,outer,inner,centre:[x+7.5,y+12],radius,outerWidth,innerWidth,baseHeight:base,layerHeight:layer,wallLayers:layers});
}
const input=new Map([
 ['3D/3dmodel.model',enc.encode(`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objects.join('')}</resources><build>${items.join('')}</build></model>`)],
 ['Metadata/model_settings.config',enc.encode(`<config>${meta.join('')}</config>`)],
 [SRC_BBL_PROJECT,enc.encode(JSON.stringify({filament_colour:setup.reels.map(r=>r.color),filament_type:['PLA','PLA','PLA','PLA'],layer_height:'0.08'}))]
]);
const project=readProject(input);
const soup=previewSoup(project,1,null,Object.fromEntries(setup.reels.map((r,i)=>[i+1,r.color])),null,500000);
const image=renderIso(soup.positions,soup.colors,{size:512}),small=downscale(image,128);
const thumbnails={main:await encodePng(image.data,image.width,image.height),small:await encodePng(small.data,small.width,small.height),plateName:'ELEGOO ordered wall test'};
const built=exportProject(project,1,null,{target:'snapmaker',reels:setup.reels,recipes:[],mapping:{1:1,2:2,3:3,4:4},title:'ELEGOO ordered outer-inner wall test v1',u1Nozzle:'0.4',layerHeight:{mode:'custom',value:'0.08'},subdivideMixLayer:false,thumbnails});
if(built.problems.length)throw Error(built.problems.join('\n'));
const cfg=JSON.parse(dec.decode(built.entries.get(SRC_BBL_PROJECT)));
const settings={layer_height:'0.08',initial_layer_print_height:'0.2',line_width:'0.3',outer_wall_line_width:'0.3',inner_wall_line_width:'0.3',top_surface_line_width:'0.3',internal_solid_infill_line_width:'0.3',sparse_infill_line_width:'0.3',wall_generator:'arachne',wall_loops:'4',top_shell_layers:'0',bottom_shell_layers:'0',sparse_infill_density:'100%',sparse_infill_pattern:'rectilinear',outer_wall_speed:'30',inner_wall_speed:'40',top_surface_speed:'30',internal_solid_infill_speed:'40',enable_support:'0',enable_prime_tower:'1',prime_tower_width:'45',prime_volume:'45',wipe_tower_x:['25'],wipe_tower_y:['25'],brim_type:'no_brim',print_sequence:'by layer',ironing_type:'no ironing',dithering_local_z_mode:'0',mixed_filament_advanced_dithering:'0'};
Object.assign(cfg,settings,{print_settings_id:'YAB3D 0.08mm Ordered walls v1 @Snapmaker U1 (0.4 nozzle)',default_print_profile:'YAB3D 0.08mm Ordered walls v1 @Snapmaker U1 (0.4 nozzle)'});
cfg.different_settings_to_system[0]=[...new Set([...cfg.different_settings_to_system[0].split(';'),...Object.keys(settings)])].join(';');
built.entries.set(SRC_BBL_PROJECT,enc.encode(JSON.stringify(cfg,null,2)));
const manifest={version:1,title:'ELEGOO ordered outer/inner wall test',datePrepared:'2026-11-06',printer:'Snapmaker U1',nozzle:0.4,bundleId:setup.bundleId,reels:setup.reels.map((r,i)=>({slot:i+1,...r})),settings,samples,calibration:'Unmeasured original patterns; no predicted green and no iDither calibration imported.',construction:'One 0.30 mm outer band, three nominal 0.30 mm inner paths. Open top, hollow centre, white base only. Each sequence starts at the first wall layer above z=0.60 mm.',sources:['https://idither.com/wiki.php#colored-walls','https://www.elegoo.com/en-gb/products/pla-cmyk']};
built.entries.set('Metadata/YAB3D_ordered_wall_test.json',enc.encode(JSON.stringify(manifest,null,2)));
await writeFile(`${output}/ELEGOO-ordered-walls-v1.3mf`,await writeZip([...built.entries].map(([name,data])=>({name,data}))));
await writeFile(`${output}/test-settings.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({output,triangles:objects.join('').match(/<triangle /g).length,samples:8,height:6.6},null,2));
