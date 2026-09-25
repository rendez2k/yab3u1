import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {readZip} from '../zip.js';
import {readProject,analyse,exportProject,selectionBounds,selectionInstances,previewSoup} from '../shared/project.js';
import {targetLayout,planLayout} from '../shared/layout.js';
import {planningAllowance} from '../shared/printSettings.js';
import {planBlends,mappingFromPlan} from '../shared/mix.js';
import {colourName} from '../shared/assignment.js';
assert.equal(colourName('#F7E6DE'),'Light beige');
const modelPath='C:/Users/rende/Desktop/CATS3D.174 - SuperMan Final Cats3D Studio.3mf';
const syntheticBounds={min:[0,0,0],max:[100,100,100]};
assert.equal(planLayout(syntheticBounds,targetLayout('snapmaker',{copies:2,spacing:5,tower:true})).copies,2);
assert(planLayout(syntheticBounds,targetLayout('snapmaker',{copies:64,spacing:5,tower:true})).capped);
if(!existsSync(modelPath)){console.log('PASS copy capacity and beige naming; optional Superman fixture not available.');process.exit(0);}
const source=readProject(await readZip(readFileSync(modelPath)),{allowNegative:true});
const plate=source.plates[0].id,assessed=analyse(source,plate,null);
const reels=['#FFFFFF','#000000','#C12E1F','#F7E6DE'].map(color=>({color,type:'PLA'}));
const mix=planBlends(assessed.sourceColors,reels,true);
const layout=targetLayout('snapmaker',{copies:2,spacing:5,tower:true,...planningAllowance([source.sourceSettings],'snapmaker',true)});
assert.equal(planLayout(selectionBounds(source,plate,null),layout).copies,2);
const out=exportProject(source,plate,null,{target:'snapmaker',reels,recipes:mix.recipes,mapping:mappingFromPlan(mix),layout});
assert.deepEqual(out.problems,[]);
// The native writer's colour-mix metadata is checked by exportProject; inspect XML
// directly because generic readers intentionally reject incoming native blends.
const xml=new TextDecoder().decode(out.entries.get('3D/3dmodel.model'));
assert.equal((xml.match(/<item\s/g)||[]).length,2,'two model instances in the exported build');
const metadata=new TextDecoder().decode(out.entries.get('Metadata/model_settings.config'));
assert.equal((metadata.match(/subtype="negative_part"/g)||[]).length,2,'each copy keeps its cutter');
const big=planLayout(selectionBounds(source,plate,null),{...layout,copies:64});assert(big.capped);
console.log('PASS Superman: two exported copies, two cutters, blends, capacity limit and beige label');
