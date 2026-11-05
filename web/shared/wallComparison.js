// Original, analytical test geometry. No third-party recipe or calibration data.
import {readProject,exportProject,SRC_BBL_PROJECT} from './project.js';
import {writeZip} from '../zip.js';
import {FILAMENT_BUNDLES} from './filamentBundles.js';
import {filamentIdentity} from './filamentIdentity.js';
import {FDM_MODEL,mixFdmHex} from './fdmMix.js';

export const WALL_TEST_PATH='Metadata/YAB3D_wall_comparison.json';
export const WALL_TEST_VERSION=1;
const enc=new TextEncoder(),dec=new TextDecoder();
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round=v=>Number(v.toFixed(6));

export function wallTestSetup({bundleId='elegoo-rilievo',slots=[1,2,3,4],height=0.1,subdivideMixLayer=true}={}) {
  const bundle=FILAMENT_BUNDLES.find(b=>b.id===bundleId);
  if(!['elegoo-rilievo','esun-pla-plus-cmyk','snapmaker-white'].includes(bundleId)||!bundle)
    throw Error('Choose a supported four-reel CMY + White pack.');
  if(!Array.isArray(slots)||slots.length!==4||new Set(slots).size!==4||slots.some(s=>!Number.isInteger(s)||s<1||s>4))
    throw Error('Assign cyan, magenta, yellow and white to four different U1 slots.');
  if(![0.08,0.1].includes(Number(height)))throw Error('Choose 0.08 or 0.10 mm for this comparison.');
  const reels=[];bundle.reels.forEach((r,i)=>reels[slots[i]-1]={...r});
  return {bundleId,bundleName:`${bundle.brand} ${bundle.name}`,reels,slots:[...slots],height:Number(height),nozzle:0.4,subdivideMixLayer:Boolean(subdivideMixLayer)};
}

function box(x,y,z,w,d,h) {
  return {vertices:[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],
    faces:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]};
}
// Each annulus is a watertight, outward-wound solid, including its inner wall.
function ring(x,y,z,outer,inner,h,n=96) {
  const vertices=[],faces=[];
  for(const [radius,dz] of [[outer,0],[outer,h],[inner,0],[inner,h]])
    for(let i=0;i<n;i++)vertices.push([x+radius*Math.cos(i*2*Math.PI/n),y+radius*Math.sin(i*2*Math.PI/n),z+dz].map(round));
  for(let i=0;i<n;i++) {
    const j=(i+1)%n;
    for(const [a,b,c,d] of [[i,j,n+j,n+i],[2*n+j,2*n+i,3*n+i,3*n+j],
      [n+i,n+j,3*n+j,3*n+i],[j,i,2*n+i,2*n+j]])faces.push([a,b,c],[a,c,d]);
  }
  return {vertices,faces};
}
function combine(meshes) {
  const vertices=[],faces=[];
  for(const mesh of meshes){const offset=vertices.length;vertices.push(...mesh.vertices);faces.push(...mesh.faces.map(f=>f.map(v=>v+offset)));}
  return {vertices,faces};
}

export function wallTestCoupons(setup,mode='walls') {
  if(!['walls','layers'].includes(mode))throw Error('Unknown comparison method.');
  const [cyan,magenta,yellow,white]=setup.slots, recipes=[];
  const specimens=[
    {code:'01',a:cyan,b:yellow,outer:0.4,inner:0.8,label:'Cyan outside, yellow inside'},
    {code:'02',a:yellow,b:cyan,outer:0.4,inner:0.8,label:'Yellow outside, cyan inside'},
    {code:'03',a:cyan,b:yellow,outer:0.8,inner:0.8,label:'Thicker cyan outside, yellow inside'},
    {code:'04',a:magenta,b:yellow,outer:0.4,inner:0.8,label:'Magenta outside, yellow inside'},
    {code:'05',a:yellow,b:magenta,outer:0.4,inner:0.8,label:'Yellow outside, magenta inside'},
    {code:'06',a:magenta,b:yellow,outer:0.8,inner:0.8,label:'Thicker magenta outside, yellow inside'},
    ...[cyan,magenta,yellow,white].map((slot,i)=>({code:String(i+7).padStart(2,'0'),a:slot,b:slot,outer:0.4,inner:0.8,label:`Pure ${setup.reels[slot-1].name}`}))
  ];
  const coupons=specimens.map((s,i)=>{
    // Plate map: 01–05 at the front, 06–10 behind. Embossed bars identify row/column.
    const col=i%5,row=Math.floor(i/5),parts=[];
    const add=(name,slot,mesh)=>parts.push({name,slot,...mesh});
    const markers=[box(0,0,0,22,24,0.6)];
    for(let k=0;k<=col;k++)markers.push(box(2+k*2.6,3,0.6,1.4,2,0.4));
    for(let k=0;k<=row;k++)markers.push(box(2+k*5,1,0.6,3,0.8,0.4));
    add('White base and row/column marks',white,combine(markers));
    const percent=Math.round(100*s.inner/(s.outer+s.inner));
    let outerSlot=s.a,innerSlot=s.b;
    if(mode==='layers'&&s.a!==s.b){
      recipes.push({a:s.a,b:s.b,percent,model:FDM_MODEL});
      outerSlot=innerSlot=setup.reels.length+recipes.length;
    }
    add('Outer curved wall',outerSlot,ring(6.5,16,0.6,5.5,5.5-s.outer,12));
    add('Inner curved wall',innerSlot,ring(6.5,16,0.6,5.5-s.outer,5.5-s.outer-s.inner,12));
    add('Top tile backing',innerSlot,box(13.5,11,0.6,7,9,s.inner));
    add('Top tile surface',outerSlot,box(13.5,11,0.6+s.inner,7,9,s.outer));
    // Native mixtures can make a much deeper tower than the four-material plate.
    // Keep both coupon layouts identical, with the front half reserved for priming.
    return {...s,percentB:percent,row:row+1,column:col+1,x:68+col*28,y:170+row*30,parts};
  });
  return {coupons,recipes};
}

function sourceProject(setup,geometry) {
  let id=1;
  const objects=[],roots=[],meta=[];
  const colours=[...setup.reels.map(r=>r.color),...geometry.recipes.map(r=>mixFdmHex(setup.reels[r.a-1].color,setup.reels[r.b-1].color,r.percent))];
  for(const c of geometry.coupons) {
    const components=[],parts=[];
    for(const p of c.parts) {
      const part=id++;
      objects.push(`<object id="${part}" type="model"><mesh><vertices>${p.vertices.map(v=>`<vertex x="${round(v[0])}" y="${round(v[1])}" z="${round(v[2])}"/>`).join('')}</vertices><triangles>${p.faces.map(f=>`<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}" pid="1000" p1="${p.slot-1}"/>`).join('')}</triangles></mesh></object>`);
      components.push(`<component objectid="${part}"/>`);
      parts.push(`<part id="${part}" subtype="normal_part"><metadata key="name" value="${esc(p.name)}"/><metadata key="extruder" value="${p.slot}"/></part>`);
    }
    const root=id++;
    objects.push(`<object id="${root}" type="model" name="${esc(c.code+' '+c.label)}"><components>${components.join('')}</components></object>`);
    roots.push(`<item objectid="${root}" transform="1 0 0 0 1 0 0 0 1 ${c.x} ${c.y} 0"/>`);
    meta.push(`<object id="${root}"><metadata key="name" value="${esc(c.code+' '+c.label)}"/>${parts.join('')}</object>`);
  }
  return readProject(new Map([
    ['3D/3dmodel.model',enc.encode(`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"><resources><m:colorgroup id="1000">${colours.map(c=>`<m:color color="${c}"/>`).join('')}</m:colorgroup>${objects.join('')}</resources><build>${roots.join('')}</build></model>`)],
    ['Metadata/model_settings.config',enc.encode(`<config>${meta.join('')}</config>`)]
  ]));
}

// Normalise package UUIDs as well as geometry and recipes for reproducible files.
function stableMembers(entries) {
  let next=1;const ids=new Map();
  for(const [name,data] of entries)if(/\.model$/.test(name))entries.set(name,enc.encode(dec.decode(data).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,id=>{
    if(!ids.has(id))ids.set(id,`00000000-0000-4000-8000-${String(next++).padStart(12,'0')}`);return ids.get(id);
  })));
  return [...entries].sort(([a],[b])=>a.localeCompare(b)).map(([name,data])=>({name,data}));
}

export async function wallComparisonProject(options={},mode='walls') {
  const setup=wallTestSetup(options),geometry=wallTestCoupons(setup,mode),project=sourceProject(setup,geometry);
  project.sourceSettings={layer_height:String(setup.height),enable_support:'0'};
  const built=exportProject(project,project.plates[0].id,null,{target:'snapmaker',reels:setup.reels,recipes:geometry.recipes,
    mapping:Object.fromEntries(project.colors.map((_,i)=>[i+1,i+1])),title:`YAB3D ${mode==='walls'?'dual-wall':'native layer'} comparison`,
    u1Nozzle:'0.4',layerHeight:{mode:'custom',value:String(setup.height)},subdivideMixLayer:mode==='layers'&&setup.subdivideMixLayer});
  if(built.problems.length)throw Error(built.problems.join('\n'));
  const cfg=JSON.parse(dec.decode(built.entries.get(SRC_BBL_PROJECT)));
  // Identical coupon process. Explicit solid volumes, no model's support or speed overrides.
  const process={dithering_local_z_mode:mode==='layers'&&setup.subdivideMixLayer?'1':'0',layer_height:String(setup.height),initial_layer_print_height:'0.2',line_width:'0.4',outer_wall_line_width:'0.4',
    inner_wall_line_width:'0.4',top_surface_line_width:'0.4',internal_solid_infill_line_width:'0.4',
    wall_generator:'arachne',wall_loops:'3',top_shell_layers:'5',bottom_shell_layers:'3',sparse_infill_density:'100%',sparse_infill_pattern:'rectilinear',
    outer_wall_speed:'40',inner_wall_speed:'60',top_surface_speed:'40',internal_solid_infill_speed:'60',
    print_sequence:'by layer',enable_support:'0',enable_prime_tower:'1',prime_tower_width:'60',prime_volume:'45',
    wipe_tower_x:['25'],wipe_tower_y:['25'],brim_type:'no_brim',ironing_type:'no ironing'};
  Object.assign(cfg,process);
  cfg.different_settings_to_system[0]=[...new Set([...cfg.different_settings_to_system[0].split(';'),...Object.keys(process)])].sort().join(';');
  built.entries.set(SRC_BBL_PROJECT,enc.encode(JSON.stringify(cfg,null,2)));
  const manifest={schema:'yab3d-wall-comparison',version:WALL_TEST_VERSION,mode,printer:'Snapmaker U1',nozzle:setup.nozzle,
    bundleId:setup.bundleId,bundleName:setup.bundleName,slots:setup.slots,
    reels:setup.reels.map((r,i)=>({...filamentIdentity(r),slot:i+1,name:r.name,type:r.type,color:r.color})),
    layerHeight:setup.height,nativeSubdivision:mode==='layers'&&setup.subdivideMixLayer,
    printSettings:process,filamentSettings: Object.fromEntries(Object.entries(cfg).filter(([k])=>/^(?:filament_|nozzle_temperature|hot_plate_temp|textured_plate_temp|fan_)/.test(k))),
    calibration:{status:'unmeasured',predictedAppearance:'not supplied',backing:'0.6 mm white base; hollow curved wall',slicerValidated:false,printValidated:false},
    comparison:'Native ratios use wall thickness shares rounded to whole percentages. Material volume and optical path are not equal controls.',
    coupons:geometry.coupons.map(({parts,...c})=>({...c,parts:parts.map(({name,slot})=>({name,slot}))})),recipes:geometry.recipes};
  built.entries.set(WALL_TEST_PATH,enc.encode(JSON.stringify(manifest,null,2)));
  built.entries.set('Metadata/YAB3D_comparison_readme.txt',enc.encode(comparisonReadme(setup)));
  return {bytes:await writeZip(stableMembers(built.entries),{modifiedAt:new Date(2000,0,1)}),manifest};
}

export function comparisonReadme(setup) {
  return `YAB3D layer / dual-wall comparison v${WALL_TEST_VERSION}\n${setup.bundleName}\n\nSLOT CHECK\n${setup.reels.map((r,i)=>`${i+1}: ${r.name} (${r.color}, display swatch only)`).join('\n')}\n\nTwo matching 10-coupon plates, U1 0.4 mm, ${setup.height} mm regular layers.\nNative layer plate: slicer mixtures; Subdivide Mix Layer ${setup.subdivideMixLayer?'ON':'OFF'}.\nDual-wall plate: explicit separate closed material volumes; subdivision OFF.\nBoth use generic PLA process/temperature defaults, not a measured manufacturer preset. Check the PLA temperatures and cooling against your reels. Keep those settings identical between tests.\n\n01 Cyan outside 0.4 / yellow inside 0.8 mm\n02 Yellow outside 0.4 / cyan inside 0.8 mm\n03 Cyan outside 0.8 / yellow inside 0.8 mm\n04 Magenta outside 0.4 / yellow inside 0.8 mm\n05 Yellow outside 0.4 / magenta inside 0.8 mm\n06 Magenta outside 0.8 / yellow inside 0.8 mm\n07 Pure cyan; 08 Pure magenta; 09 Pure yellow; 10 Pure white\n\nPLATE MAP (viewed from above, front at bottom)\nBack:  06 07 08 09 10\nFront: 01 02 03 04 05\nEach white base has one or two short front bars for row and 1-5 bars behind them for column. Keep attached while comparing. Each specimen has a hollow curved wall and a flat tile to its right. The tile uses the same thicknesses: inner material below, outer material above. Base is 0.6 mm white.\n\nBEFORE PRINTING\nOpen each as a project in Snapmaker Orca. Check all four physical slots, 10 objects, the regular layer height, prime tower and individual layer toolpaths. Use Preview's filament view to confirm both materials survive slicing in the thin walls. The dual-wall exterior should show its outer filament, not the intended optical blend. Stop if a wall disappears or the slicer reports unsupported/floating regions. These analytical coupons have no intended overhangs or separate floating parts. Never use a rearrange action that splits the parts within each coupon.\n\nJUDGING RESULTS\nCompare in the same neutral light and at the same distance: curved wall smoothness, banding, green/red hue and the separate flat top tile. Also check transmitted light separately; these lithophane reels may behave differently under room lighting. Photograph both sets together with the pure controls. A screen preview is not a measured prediction. White backing, wall order, thickness, layer height, temperature and cooling all matter. The layer ratios match thickness shares (rounded), not exact deposited volumes or optical paths. Do not infer a universal recipe from one good sample.\n\nREPEATABILITY\nThe two 3MFs each contain Metadata/YAB3D_wall_comparison.json with exact product identities, slot order, geometry parameters, recipes and exported settings. Rebuilding identical options generates identical bytes. Reopen the exported project to retain the recipe; do not rerun a palette optimiser. No results are automatically treated as calibrated, and no original model is changed.\n\nNEXT\nAfter inspecting the printed coupons, choose a wall order and thickness. Only then trial it on one Grinch. Upward surfaces need separate judgement from vertical walls. This experiment does not yet rewrite arbitrary models into dual-wall geometry.\n`;
}

export async function wallComparisonPack(options={},onProgress=()=>{}) {
  const setup=wallTestSetup(options);
  onProgress('Building the native layer comparison…');
  const native=await wallComparisonProject(options,'layers');
  onProgress('Building the dual-wall comparison…');
  const walls=await wallComparisonProject(options,'walls');
  const files=[{name:'01-native-layer-mixing.3mf',data:native.bytes},{name:'02-experimental-dual-wall.3mf',data:walls.bytes},
    {name:'READ-ME-FIRST.txt',data:enc.encode(comparisonReadme(setup))},
    {name:'comparison-settings.json',data:enc.encode(JSON.stringify({native:native.manifest,walls:walls.manifest},null,2))}];
  return {bytes:await writeZip(files,{modifiedAt:new Date(2000,0,1)}),files,setup};
}
