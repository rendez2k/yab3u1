import test from 'node:test';
import assert from 'node:assert/strict';
import {wallTestSetup,wallTestCoupons,wallComparisonProject,wallComparisonPack,WALL_TEST_PATH} from '../shared/wallComparison.js';
import {readZip} from '../zip.js';
import {readProject,analyse} from '../shared/project.js';

test('comparison setup preserves exact products and rejects ambiguous slots',()=>{
  const s=wallTestSetup({slots:[4,2,1,3]});
  assert.match(s.reels[0].productId,/elegoo.*yellow/);
  assert.match(s.reels[3].productId,/elegoo.*cyan/);
  for(const slots of [[1,1,3,4],[0,2,3,4],[1,2,3],[1,2,3,5]])assert.throws(()=>wallTestSetup({slots}));
  for(const height of [0,0.04,0.16,NaN])assert.throws(()=>wallTestSetup({height}));
  assert.throws(()=>wallTestSetup({bundleId:'unknown'}));
});

function signedVolume(mesh){return mesh.faces.reduce((v,[a,b,c])=>{
  const p=mesh.vertices[a],q=mesh.vertices[b],r=mesh.vertices[c];
  return v+(p[0]*(q[1]*r[2]-q[2]*r[1])-p[1]*(q[0]*r[2]-q[2]*r[0])+p[2]*(q[0]*r[1]-q[1]*r[0]))/6;
},0);}
test('all material volumes are closed, consistently wound and supported; matched test geometry',()=>{
  const setup=wallTestSetup(),wall=wallTestCoupons(setup,'walls'),native=wallTestCoupons(setup,'layers');
  assert.equal(wall.coupons.length,10);assert.equal(native.recipes.length,6);assert.equal(wall.recipes.length,0);
  for(const [i,c] of wall.coupons.entries()) {
    assert(c.x>=0&&c.x+22<220&&c.y>=170&&c.y+24<250,'clear of plate edge, with the front half reserved for the tower');
    for(const [j,p] of c.parts.entries()){
      assert.deepEqual(p.vertices,native.coupons[i].parts[j].vertices);assert.deepEqual(p.faces,native.coupons[i].parts[j].faces);
      const edges=new Map();
      for(const f of p.faces)for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');const e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);}
      assert([...edges.values()].every(([count,direction])=>count===2&&direction===0),`${c.code} ${p.name}: manifold oriented edges`);
      assert(signedVolume(p)>0,`${c.code} ${p.name}: positive volume`);
      assert(p.vertices.every(v=>v.every(Number.isFinite)&&v[2]>=0));
      const bottom=Math.min(...p.vertices.map(v=>v[2]));
      assert.equal(bottom,j===0?0:j===4?0.6+c.inner:0.6,'base or flush on another volume, never floating');
    }
    const outer=c.parts[1],inner=c.parts[2];
    const radius=p=>Math.hypot(p[0]-6.5,p[1]-16);
    assert(Math.abs(Math.min(...outer.vertices.map(radius))-Math.max(...inner.vertices.map(radius)))<2e-6,'annuli meet without overlap/gap');
  }
});

test('round-trip native and explicit-wall exports keep 10 independent objects and matching settings',async()=>{
  const options={slots:[4,2,1,3],height:0.08};
  const native=await wallComparisonProject(options,'layers'),walls=await wallComparisonProject(options,'walls');
  const configs=[];
  for(const [mode,result] of [['layers',native],['walls',walls]]){
    const zip=await readZip(result.bytes),text=n=>new TextDecoder().decode(zip.get(n));
    const cfg=JSON.parse(text('Metadata/project_settings.config'));configs.push(cfg);
    assert.equal(cfg.layer_height,'0.08');assert.equal(cfg.enable_support,'0');assert.equal(cfg.filament_colour.length,4);
    assert.equal(cfg.sparse_infill_density,'100%');assert.equal(cfg.sparse_infill_pattern,'rectilinear','solid infill must use a slicer-compatible pattern');
    assert.equal(cfg.dithering_local_z_mode,mode==='layers'?'1':'0');
    const manifest=JSON.parse(text(WALL_TEST_PATH));
    assert.equal(manifest.calibration.status,'unmeasured');assert.equal(manifest.mode,mode);
    assert.deepEqual(manifest.slots,[4,2,1,3]);assert(manifest.reels.every(r=>r.brand==='ELEGOO'));
    assert.equal((text('3D/3dmodel.model').match(/<item /g)||[]).length,10);
    const read=readProject(zip),report=analyse(read,read.plates[0].id,null);
    assert.equal(report.objects.length,10);assert.equal(report.counts.undecodable_paint,0);
    assert.deepEqual(report.used.map(Number).sort((a,b)=>a-b),mode==='layers'?[1,2,3,4,5,6,7,8,9,10]:[1,2,3,4]);
    const parts=[...text('Metadata/model_settings.config').matchAll(/<part /g)];assert.equal(parts.length,50);
    assert.equal(manifest.coupons[0].parts[1].slot,mode==='layers'?5:4);
    assert.equal(manifest.coupons[0].parts[2].slot,mode==='layers'?5:1);
  }
  for(const key of ['outer_wall_speed','line_width','wall_loops','top_shell_layers','sparse_infill_density','nozzle_temperature','filament_flow_ratio','wipe_tower_x','wipe_tower_y'])
    assert.deepEqual(configs[0][key],configs[1][key],`${key}: matched process`);
});

test('comparison ZIP is repeatable and recipe metadata changes with explicit options',async()=>{
  const a=await wallComparisonPack(),b=await wallComparisonPack();
  assert.deepEqual(a.bytes,b.bytes,'UUIDs, archive time, recipes and geometry are stable');
  assert.equal(new DataView(a.bytes.buffer,a.bytes.byteOffset).getUint16(10,true),0,'fixed midnight ZIP timestamp');
  const zip=await readZip(a.bytes);assert.equal(zip.size,4);
  assert(new TextDecoder().decode(zip.get('READ-ME-FIRST.txt')).includes('one Grinch'));
  const changed=await wallComparisonProject({subdivideMixLayer:false},'layers');
  assert.equal(changed.manifest.nativeSubdivision,false);
  const esun=await wallComparisonProject({bundleId:'esun-pla-plus-cmyk'});
  assert(esun.manifest.reels.every(r=>r.brand==='eSUN'));
  assert.notDeepEqual(a.files[1].data,esun.bytes);
});
