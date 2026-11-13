import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readZip} from '../zip.js';
import {readProject,exportProject} from '../shared/project.js';
import {layerPattern,backingPattern,wallPatternRow} from '../shared/targets.js';
import {applyFineBlend,FINE_BLEND_PATH} from '../shared/fineBlend.js';

test('two-reel repeats keep the share and space the smaller reel evenly',()=>{
  assert.equal(layerPattern([{slot:1,percent:50},{slot:2,percent:50}]).join(''),'12');
  const third=layerPattern([{slot:3,percent:67},{slot:4,percent:33}]);
  assert.equal(third.length,3);assert.equal(third.filter(s=>s===4).length,1);
  const fine=layerPattern([{slot:1,percent:30},{slot:2,percent:70}],10);
  assert.ok(fine.length<=10);assert.ok(Math.abs(100*fine.filter(s=>s===1).length/fine.length-30)<=1.5,'the shortest repeat within a point and a half');
  assert.ok(![...fine,...fine].join('').includes('11'),'the smaller reel never prints two layers running');
});

test('the backing repeat has the same shares and backs stripes with another reel',()=>{
  for(const outer of [[1,2],[1,2,2],[4,2,4,3,4],[1,2,2,1,2,2,2,1,2,2]]){
    const inner=backingPattern(outer);
    assert.deepEqual(inner.slice().sort(),outer.slice().sort());
    assert.ok(inner.some((slot,i)=>slot!==outer[i]));
  }
  assert.deepEqual(backingPattern([1,2]),[2,1]);
});

test('a blend row carries one repeat, and a second for inner walls only when asked',()=>{
  assert.match(wallPatternRow({a:3,b:4,percent:50},9),/,u9,cm1,34$/);
  const tokens=wallPatternRow({a:3,b:4,percent:50},9,10,{inner:true}).split(',');
  assert.deepEqual(tokens.slice(0,4),['1','2','1','1']);
  assert.ok(tokens.includes('g34')&&tokens.includes('w50/50')&&tokens.includes('m0')&&tokens.includes('u9')&&tokens.includes('cm1'));
  assert.deepEqual(tokens.slice(-2),['34','43']);
});

test('the fine blend profile changes wall settings only and leaves the blend table alone',async()=>{
  const entries=await readZip(new Uint8Array(readFileSync(new URL('./five-colours.3mf',import.meta.url))));
  const project=readProject(entries),plate=project.plates[0].id;
  const reels=['#FFFFFF','#000000','#FF0000','#00FF00'].map(color=>({color,type:'PLA'}));
  const recipes=[{a:1,b:2,percent:50},{a:1,b:3,percent:25,c:4,percentC:25}];
  const built=exportProject(project,plate,null,{target:'snapmaker',reels,mapping:{1:1,2:2,3:3,4:4,5:5,6:6},recipes,subdivideMixLayer:true});
  assert.deepEqual(built.problems,[]);
  const read=()=>JSON.parse(new TextDecoder().decode(built.entries.get('Metadata/project_settings.config')));
  const before=read();
  const models=[...built.entries].filter(([name])=>/\.model$/.test(name)).map(([name,data])=>[name,Buffer.from(data).toString('hex')]);
  const result=applyFineBlend(built.entries,{target:'snapmaker',recipes});
  assert.equal(result.blends,2);assert.equal(result.threeReel,1);assert.equal(result.walls,5);
  const cfg=read(),rows=cfg.mixed_filament_definitions.split(';');
  // The two-reel blend stays a ratio row for the slicer to subdivide; the three-reel one keeps its layer pattern.
  assert.equal(cfg.mixed_filament_definitions,before.mixed_filament_definitions);
  assert.equal(rows[0],'1,2,1,1,50,0,g,w,m2,z0,xa0,xb0,d0,o0,u1');assert.match(rows[1],/,g134,.*,cm1,[134]{4}$/);
  assert.equal(cfg.dithering_local_z_mode,before.dithering_local_z_mode);
  assert.equal(cfg.wall_loops,'5');assert.equal(cfg.outer_wall_line_width,'0.3');assert.equal(cfg.inner_wall_line_width,'0.3');
  for(const [name,hex]of models)assert.equal(Buffer.from(built.entries.get(name)).toString('hex'),hex,`${name} is unchanged`);
  const manifest=JSON.parse(new TextDecoder().decode(built.entries.get(FINE_BLEND_PATH)));
  assert.deepEqual(manifest.validation,{sliced:false,printed:false});
  assert.throws(()=>applyFineBlend(built.entries,{target:'bambu',recipes}),/Snapmaker Orca/);
});
