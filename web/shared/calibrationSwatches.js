import {readProject,exportProject} from './project.js';
import {writeZip} from '../zip.js';
import {mixFdmHex,FDM_MODEL} from './fdmMix.js';

/** Five separate flat tiles: pure A, 25/50/75% B, pure B, left to right.
 * Uses the normal native Full Spectrum exporter, never printer commands. */
export async function calibrationSwatches({reels,a,b,nozzle='0.4',height=0.1,sourceSettings={}}) {
  if(reels.length!==4 || !Number.isInteger(a) || !Number.isInteger(b) || a<1 || a>4 || b<1 || b>4 || a===b) throw Error('Choose two different slots.');
  if(reels[a-1].type!==reels[b-1].type) throw Error('Test tiles need two reels of the same material.');
  const recipes=[25,50,75].map(percent=>({a,b,percent,model:FDM_MODEL}));
  const colours=[...reels.map(r=>r.color),...recipes.map(r=>mixFdmHex(reels[a-1].color,reels[b-1].color,r.percent))];
  const slots=[a,5,6,7,b];
  const names=[`Pure slot ${a}`,`75% slot ${a} + 25% slot ${b}`,`50% slot ${a} + 50% slot ${b}`,`25% slot ${a} + 75% slot ${b}`,`Pure slot ${b}`];
  // Several four-layer cycles for the quarter-share blends, not a thin skin.
  const thickness=Math.max(2,20*Number(height));
  const points=[[0,0,0],[18,0,0],[18,18,0],[0,18,0],[0,0,thickness],[18,0,thickness],[18,18,thickness],[0,18,thickness]];
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const objects=slots.map((slot,i)=>`<object id="${i+1}" name="${names[i]}" type="model" pid="100" pindex="${slot-1}"><mesh><vertices>${points.map(([x,y,z])=>`<vertex x="${80+i*22+x}" y="${126+y}" z="${z}"/>`).join('')}</vertices><triangles>${faces.map(f=>`<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}" pid="100" p1="${slot-1}"/>`).join('')}</triangles></mesh></object>`).join('');
  const enc=new TextEncoder();
  const entries=new Map([
    ['3D/3dmodel.model',enc.encode(`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"><metadata name="Title">Blend test slots ${a} and ${b}</metadata><resources><m:colorgroup id="100">${colours.map(c=>`<m:color color="${c}"/>`).join('')}</m:colorgroup>${objects}</resources><build>${slots.map((_,i)=>`<item objectid="${i+1}"/>`).join('')}</build></model>`)],
  ]);
  const project=readProject(entries);
  project.sourceSettings={...sourceSettings,layer_height:String(height)};
  const result=exportProject(project,project.plates[0]?.id,null,{target:'snapmaker',reels,recipes,
    mapping:Object.fromEntries(colours.map((_,i)=>[i+1,i+1])),title:`Blend test slots ${a} and ${b}`,u1Nozzle:nozzle,
    layerHeight:{mode:'custom',value:String(height)}});
  result.entries.set('Metadata/YAB3D_calibration.txt',enc.encode(
    `Experimental colour test. Slice and check in Snapmaker Orca before printing.\nFive tiles left to right when viewed from above:\n${names.join('\n')}\nRegular layer: ${height} mm; nozzle: ${nozzle} mm.\nUse the same reels, temperatures, cooling and layer settings on your model.\nMeasure the flat upper faces under consistent lighting with a colour measurement device. Do not sample a screen preview or an uncalibrated photograph.\n`));
  return writeZip([...result.entries].map(([name,data])=>({name,data})));
}
