// Swatch strips: one print that samples several reel pairs at once.
//
// Blended colour is a property of walls (layers of different reels stacked up), so
// each sample is a small upright wall. The walls stand side by side and just touch, so
// they come off the bed as one strip in a fixed order. Laid on its back, the strip is
// a row of flat rectangles that can be photographed and read left to right.
//
// A strip holds at most four pairs: every blend on it takes one of the printer's
// blend slots, and three shares for each of four pairs is the U1's twelve.
import {readProject,exportProject} from './project.js';
import {writeZip} from '../zip.js';
import {mixFdmHex,FDM_MODEL} from './fdmMix.js';

export const STRIP_SHARES=[25,50,75];
// Six millimetres is fifty layers at 0.12 mm: many repeats of every blend, and a third of the
// filament changes of the first, 16 mm strip, which the slicer put at over seven hours.
export const STRIP_TILE={width:12,depth:4,height:6,overlap:0.1};
// Each wall stands on its own wide foot, and the feet join into one long first layer. The
// first strip had none: fifteen footprints of 12 x 4 mm came off the bed ten minutes in.
// The foot is part of the wall's own mesh, so every piece rests on the bed as it is.
export const STRIP_BASE={thickness:0.8,margin:5};
const TILES_PER_PAIR=STRIP_SHARES.length+2;
const material=r=>String(r?.type||'PLA').trim().toUpperCase();

/** Which pairs go on which strip: every pair of same-material reels, at most four to a strip, spread evenly. */
export function stripPlan(reels){
  const pairs=[];
  for(let a=1;a<=reels.length;a+=1)for(let b=a+1;b<=reels.length;b+=1)
    if(reels[a-1].role!=='support-interface'&&reels[b-1].role!=='support-interface'&&material(reels[a-1])===material(reels[b-1]))pairs.push([a,b]);
  if(!pairs.length)return [];
  const strips=Math.ceil(pairs.length/4),size=Math.ceil(pairs.length/strips);
  return Array.from({length:strips},(_,i)=>pairs.slice(i*size,(i+1)*size));
}

/** The tiles of one strip, left to right: for each pair, pure A, then each share of B, then pure B. */
export function stripTiles(pairs){
  return pairs.flatMap(([a,b],pair)=>[
    {pair,a,b,percent:0,label:`Pure slot ${a}`},
    ...STRIP_SHARES.map(percent=>({pair,a,b,percent,label:`${100-percent}% slot ${a} + ${percent}% slot ${b}`})),
    {pair,a,b,percent:100,label:`Pure slot ${b}`}]);
}

/** A native Full Spectrum project of one strip, built with the normal exporter. */
export async function swatchStrip({reels,pairs,nozzle='0.4',height=0.1,sourceSettings={},target='snapmaker',bambuSetup=null,subdivideMixLayer=false,name='Swatch strip'}){
  if(!Array.isArray(pairs)||!pairs.length||pairs.length>4)throw Error('A swatch strip holds one to four reel pairs.');
  for(const [a,b]of pairs){
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<1||a>reels.length||b>reels.length||a===b)throw Error('Each pair needs two different loaded slots.');
    if(material(reels[a-1])!==material(reels[b-1]))throw Error('A pair needs two reels of the same material.');
  }
  const tiles=stripTiles(pairs),recipes=pairs.flatMap(([a,b])=>STRIP_SHARES.map(percent=>({a,b,percent,model:FDM_MODEL})));
  const colours=[...reels.map(r=>r.color),...recipes.map(r=>mixFdmHex(reels[r.a-1].color,reels[r.b-1].color,r.percent))];
  // Colour index of each tile: a reel's own, or the blend made for that pair and share.
  const slot=tile=>tile.percent===0?tile.a:tile.percent===100?tile.b:reels.length+tile.pair*STRIP_SHARES.length+STRIP_SHARES.indexOf(tile.percent)+1;
  const {width,depth,height:tall,overlap}=STRIP_TILE,bed=bambuSetup?.bed||{width:270,depth:270};
  const span=tiles.length*width;
  if(span>bed.width-10)throw Error(`This strip is ${span} mm long and does not fit a ${bed.width} mm bed. Use fewer pairs on a strip.`);
  const left=(bed.width-span)/2,front=Math.min((bed.depth-depth)/2,bed.depth*0.35);
  // The side view of one piece: a foot with the wall rising from its middle, pushed along the strip.
  const m=STRIP_BASE.margin,bt=STRIP_BASE.thickness,top=bt+tall,x1=width+overlap;
  const profile=[[-m,0],[depth+m,0],[depth+m,bt],[depth,bt],[depth,top],[0,top],[0,bt],[-m,bt]];
  const points=[...profile.map(([y,z])=>[0,y,z]),...profile.map(([y,z])=>[x1,y,z])];
  const cap=[[0,1,2],[0,2,3],[0,3,6],[0,6,7],[6,3,4],[6,4,5]];
  const faces=[...cap.map(([a,b,c])=>[c,b,a]),...cap.map(([a,b,c])=>[a+8,b+8,c+8]),
    ...profile.flatMap((_,k)=>{const n=(k+1)%8;return [[k,n,n+8],[k,n+8,k+8]];})];
  const objects=tiles.map((tile,i)=>`<object id="${i+1}" name="${String(i+1).padStart(2,'0')} ${tile.label}" type="model" pid="100" pindex="${slot(tile)-1}"><mesh><vertices>${points.map(([x,y,z])=>`<vertex x="${left+i*width+x}" y="${front+y}" z="${z}"/>`).join('')}</vertices><triangles>${faces.map(f=>`<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}" pid="100" p1="${slot(tile)-1}"/>`).join('')}</triangles></mesh></object>`).join('');
  const enc=new TextEncoder();
  const entries=new Map([
    ['3D/3dmodel.model',enc.encode(`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"><metadata name="Title">${name}</metadata><resources><m:colorgroup id="100">${colours.map(c=>`<m:color color="${c}"/>`).join('')}</m:colorgroup>${objects}</resources><build>${tiles.map((_,i)=>`<item objectid="${i+1}"/>`).join('')}</build></model>`)],
  ]);
  const project=readProject(entries);
  project.sourceSettings={...sourceSettings,layer_height:String(height),enable_support:'0',initial_layer_print_height:'0.2',initial_layer_speed:'30'};
  const result=exportProject(project,project.plates[0]?.id,null,{target,reels,recipes,bambuSetup,subdivideMixLayer,preserveSourceSettings:true,
    mapping:Object.fromEntries(colours.map((_,i)=>[i+1,i+1])),title:name,u1Nozzle:nozzle,layerHeight:{mode:'custom',value:String(height)}});
  if(result.problems?.length)throw Error(result.problems[0]);
  result.entries.set('Metadata/YAB3D_swatch_strip.json',enc.encode(JSON.stringify({schema:1,feature:'swatch-strip',pairs,shares:STRIP_SHARES,tile:STRIP_TILE,foot:STRIP_BASE,
    tiles:tiles.map((tile,i)=>({position:i+1,label:tile.label,a:tile.a,b:tile.b,percent:tile.percent})),layerHeight:Number(height),nozzle,subdivideMixLayer,
    note:'Upright walls, each on a wide foot, left to right as listed. Lay the strip on its back to photograph the wall faces; mark the walls, not the feet.',validation:{sliced:false,printed:false}},null,2)));
  return writeZip([...result.entries].map(([name,data])=>({name,data})));
}
