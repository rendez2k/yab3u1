import test from 'node:test';
import assert from 'node:assert/strict';
import { wallWords, innerWallRow, spread, outerWeight, applyInnerWallMix, INNER_WALL, INNER_WALL_PATH } from '../shared/innerWallMix.js';

const count = (word, slot) => word.filter(v => v === slot).length;
const enc = new TextEncoder(), dec = new TextDecoder();
// ELEGOO Rilievo readings: cyan, magenta, yellow, white.
const tds = [1.9, 3.8, 5.1, 5.5];

test('a cycle keeps the shares and spreads each reel evenly', () => {
  const half = spread([1, 2], [0.5, 0.5]);
  assert.equal(half.length, 40); assert.equal(count(half, 1), 20); assert.ok(!half.join('').includes('11') && !half.join('').includes('22'));
  const quarter = spread([3, 1], [0.75, 0.25]);
  assert.equal(count(quarter, 1), 10); assert.ok(!(quarter.join('') + quarter.join('')).includes('11'), 'the smaller reel never runs two layers');
  assert.deepEqual([...new Set(spread([4, 2], [1, 0]))], [4]);
  const three = spread([1, 2, 3], [0.5, 0.25, 0.25]);
  assert.deepEqual([count(three, 1), count(three, 2), count(three, 3)], [20, 10, 10]);
});

test('the outer wall carries more of the colour the more opaque its reel', () => {
  assert.equal(outerWeight(undefined), 0.5);
  assert.ok(outerWeight(1.9) > outerWeight(3.8) && outerWeight(3.8) > outerWeight(5.5));
  assert.ok(outerWeight(0.2) <= 0.85 && outerWeight(50) >= 0.35);
});

test('an even blend keeps one reel on the outside and mixes behind it', () => {
  // Green from cyan and yellow: yellow is the more translucent, so it takes the outer wall.
  const w = wallWords({ a: 1, b: 3, percent: 50 }, tds);
  assert.equal(w.outerSlot, 3); assert.ok(w.steadyOuter); assert.deepEqual([...new Set(w.outer)], [3]);
  assert.ok(count(w.inner, 1) > count(w.inner, 3), 'the inner walls carry the cyan');
  // Outer and inner together come back to the blend, by the estimated weight.
  const seen = w.outerWeight * 0 + (1 - w.outerWeight) * count(w.inner, 1) / 40;
  assert.ok(Math.abs(seen - 0.5) < 0.03, `cyan seen ${seen}`);
});

test('a blend the outer reel cannot hold alone alternates as little as it must', () => {
  // Three equal reels: no one reel can be the whole outer wall.
  const w = wallWords({ a: 1, b: 2, percent: 33, c: 3, percentC: 34 }, [1, 1, 1]);
  assert.ok(!w.steadyOuter); assert.equal(w.outer.length, 40); assert.equal(w.inner.length, 40);
  assert.ok(w.inner.filter((slot, i) => slot !== w.outer[i]).length >= 20, 'the inner cycle is turned against the outer');
  // Without TD the outer wall is taken to carry half.
  const plain = wallWords({ a: 1, b: 2, percent: 50 });
  assert.equal(plain.outerWeight, 0.5); assert.ok(plain.steadyOuter);
});

test('the row is a layer-cycle row with two 40-layer cycles', () => {
  const { row } = innerWallRow({ a: 1, b: 3, percent: 50 }, 7, tds), tokens = row.split(',');
  assert.deepEqual(tokens.slice(0, 4), ['1', '2', '1', '1']); assert.equal(tokens[4], '0', 'slot 2 is not in this blend');
  assert.equal(tokens[6], 'g13'); assert.match(tokens[7], /^w\d+\/\d+$/);
  assert.equal(tokens[tokens.length - 4], 'u7'); assert.equal(tokens[tokens.length - 3], 'cm1');
  assert.match(tokens[tokens.length - 2], /^[13]{40}$/); assert.match(tokens[tokens.length - 1], /^[13]{40}$/);
  assert.equal(tokens[7].slice(1).split('/').reduce((a, b) => a + Number(b), 0), 100);
  assert.throws(() => innerWallRow({ a: 1, b: 12, percent: 50 }, 1), /slots 1 to 9/);
});

test('the export rewrite changes blend rows and wall settings only', () => {
  const cfg = { mixed_filament_definitions: '1,3,1,1,50,0,g13,w50/50,m2,z0,xa0,xb0,d0,o0,u5;2,3,1,1,25,0,g23,w75/25,m2,z0,xa0,xb0,d0,o0,u6;1,2,1,1,40,0,g12,w60/40,m2,z0,xa0,xb0,d0,o0,u7',
    wall_loops: '2', layer_height: '0.1', enable_mixed_color_sublayer: '1', dithering_local_z_mode: '1', other: 'kept' };
  const entries = new Map([['Metadata/project_settings.config', enc.encode(JSON.stringify(cfg))],
    ['Metadata/model_settings.config', enc.encode('<config><object id="1"><metadata key="wall_loops" value="2"/><metadata key="extruder" value="5"/></object></config>')]]);
  const recipes = [{ a: 1, b: 3, percent: 50 }, { a: 2, b: 3, percent: 25 }, { a: 1, b: 2, percent: 40, gradient: { start: 20, end: 80 } }];
  const result = applyInnerWallMix(entries, { target: 'snapmaker', recipes, reels: tds.map(td => ({ td })) });
  const out = JSON.parse(dec.decode(entries.get('Metadata/project_settings.config'))), rows = out.mixed_filament_definitions.split(';');
  assert.equal(rows.length, 3); assert.match(rows[0], /,u5,cm1,\d{40},\d{40}$/); assert.match(rows[1], /,u6,cm1,\d{40},\d{40}$/);
  assert.equal(rows[2], cfg.mixed_filament_definitions.split(';')[2], 'a gradient is left to the slicer');
  assert.deepEqual([out.wall_loops, out.outer_wall_line_width, out.inner_wall_line_width, out.wall_sequence, out.enable_mixed_color_sublayer], ['5', '0.3', '0.3', 'inner wall/outer wall', '0']);
  assert.equal(out.dithering_local_z_mode, undefined); assert.equal(out.other, 'kept'); assert.equal(out.layer_height, '0.1');
  assert.match(dec.decode(entries.get('Metadata/model_settings.config')), /key="wall_loops" value="5"/);
  assert.deepEqual([result.blends, result.walls, result.objectsRaised, result.tdKnown], [2, 5, 1, 4]);
  const report = JSON.parse(dec.decode(entries.get(INNER_WALL_PATH)));
  assert.deepEqual(report.validation, { sliced: false, printed: false }); assert.equal(report.cycles.length, 2);
  assert.throws(() => applyInnerWallMix(new Map(), { target: 'snapmaker', recipes }), /native slicer project/);
  assert.throws(() => applyInnerWallMix(entries, { target: 'bambu', recipes }), /Snapmaker Orca/);
  assert.equal(INNER_WALL.layers, 40);
});
