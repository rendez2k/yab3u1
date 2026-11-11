import test from 'node:test';
import assert from 'node:assert/strict';
import {crossSection, outerWalls, checkLayer, summarise, dropInside, splitInside, outlineGuard} from '../../tools/builtInToolpathCheck.mjs';

// A size x size square centred on the origin as four section segments, one reel per
// side, in the order bottom, right, top, left.
const corners = s => [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]];
const square = (size, reels) => corners(size).map((a, i, c) => ({a, b: c[(i + 1) % 4], reel: reels[i]}));
// An outer-wall loop inset by `inset` from that square (the wall's centre line lies half
// a line width inside the surface), one zero-based tool per side; null leaves a side out.
const ring = (size, inset, tools, layer = 1) => corners(size - 2 * inset).map((a, i, c) => ({layer, z: 0.32, tool: tools[i], a, b: c[(i + 1) % 4]}))
  .filter(w => w.tool != null);

test('a wall in the painted reel passes and a wall in another reel is caught', () => {
  const section = square(20, [1, 1, 2, 2]);                                   // reels per side
  const good = ring(20, 0.21, [0, 0, 1, 1]), bad = ring(20, 0.21, [0, 0, 1, 0]);   // tools are zero-based: reel = tool + 1
  assert.ok(summarise([checkLayer(section, good)]).pass);
  const r = checkLayer(section, bad); assert.ok(r.wrong > 15); assert.equal(summarise([r]).pass, false);
  // Every judged sample can be watched, and the wrong ones add up to the wrong length.
  const seen = [];
  const again = checkLayer(section, bad, {onSample: s => seen.push(s)});
  const wrongLength = seen.filter(s => s.kind === 'wrong').reduce((t, s) => t + s.length, 0);
  assert.ok(Math.abs(wrongLength - again.wrong) < 1e-9);
  assert.ok(seen.filter(s => s.kind === 'wrong').every(s => s.tool === 0 && s.reel === 2 && s.x < -9));
});

test('the hidden inner edge of the shell is not judged', () => {
  const r = checkLayer(square(20, [1, 1, 1, 1]), [...ring(20, 0.21, [0, 0, 0, 0]), ...ring(20, 0.66, [3, 3, 3, 3])]);
  assert.equal(r.wrong, 0); assert.ok(r.hidden > 60); assert.ok(summarise([r]).pass);
});

test('samples at a colour boundary are counted as mixed, not wrong', () => {
  // The bottom side is reel 1, the other three reel 2: two corners are colour boundaries.
  const r = checkLayer(square(20, [1, 2, 2, 2]), ring(20, 0.21, [0, 1, 1, 1]));
  assert.ok(r.mixed > 0);
  assert.ok(r.mixed < 4, `mixed ${r.mixed} should only be the samples near the two boundary corners`);
  assert.equal(r.wrong, 0);
  assert.ok(r.matched > 70);
  // A sample is visible exactly once: matched, wrong or mixed.
  assert.ok(Math.abs(r.visible - (r.matched + r.wrong + r.mixed)) < 1e-9);
  const s = summarise([r]);
  assert.equal(s.matchedShare, 1);
  assert.ok(s.mixedShare > 0 && s.mixedShare < 0.06);
  assert.ok(s.pass);
});

test('a missing wall shows as low coverage and fails', () => {
  const r = checkLayer(square(20, [1, 1, 1, 1]), ring(20, 0.21, [0, 0, 0, null]));
  assert.equal(r.wrong, 0);
  assert.ok(Math.abs(r.sectionLength - 80) < 1e-9);
  assert.ok(r.covered > 55 && r.covered < 65, `covered ${r.covered}`);
  const s = summarise([r]);
  assert.equal(s.matchedShare, 1);
  assert.ok(s.coveredShare < 0.9, `coveredShare ${s.coveredShare}`);
  assert.equal(s.pass, false);
});

test('cross-sections cut triangles at the height and carry their reel', () => {
  // A vertical 10 x 1 quad in the plane y = 0 as two triangles, reels 1 and 3.
  const mesh = {vertices: [[0, 0, 0], [10, 0, 0], [10, 0, 1], [0, 0, 1]], triangles: [{v: [0, 1, 2], reel: 1}, {v: [0, 2, 3], reel: 3}]};
  const segs = crossSection(mesh, 0.5);
  assert.equal(segs.length, 2);
  const byReel = Object.fromEntries(segs.map(s => [s.reel, s]));
  const ends = s => [s.a, s.b].map(p => p.map(x => Math.round(x * 1e9) / 1e9)).sort((p, q) => p[0] - q[0]);
  assert.deepEqual(ends(byReel[1]), [[5, 0], [10, 0]]);
  assert.deepEqual(ends(byReel[3]), [[0, 0], [5, 0]]);
  // End to end: they meet at (5, 0).
  assert.deepEqual(ends(byReel[1])[0], ends(byReel[3])[1]);
  // Triangles that only touch the height give nothing: z = 1 is the top edge, z = 0 the bottom.
  assert.deepEqual(crossSection(mesh, 1), []);
  assert.deepEqual(crossSection(mesh, 0), []);
  assert.deepEqual(crossSection(mesh, 2), []);
  // Segments run with the solid on their left: the quad's outward side (by its winding) is -y.
  for (const s of segs) {
    const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    assert.ok(d[0] > 0, 'outward normal -y lies to the right of the segment, so it runs towards +x');
  }
  // Wound the other way, the quad faces +y and its segments run towards -x.
  const flipped = crossSection({vertices: mesh.vertices, triangles: mesh.triangles.map(t => ({...t, v: [...t.v].reverse()}))}, 0.5);
  assert.ok(flipped.length === 2 && flipped.every(s => s.b[0] < s.a[0]));
  // The same mesh with flat typed-array vertices gives the same section.
  const flat = {vertices: Float64Array.from(mesh.vertices.flat()), triangles: mesh.triangles};
  assert.deepEqual(crossSection(flat, 0.5).map(ends), segs.map(ends));
});

test('outer walls are read with the active tool and layer', () => {
  const gcode = [
    'M83', 'T0',
    ';LAYER_CHANGE', ';Z:0.2',
    ';TYPE:Outer wall',
    'G1 X10 Y10 F3000',            // travel, no E
    'G1 X20 Y10 E0.5',             // layer 0, tool 0
    ';LAYER_CHANGE', ';Z:0.32',
    'T1',
    ';TYPE:Inner wall',
    'G1 X20 Y20 E0.5',             // not an outer wall
    ';TYPE:Outer wall',
    'G1 X30 Y20 E.4 ; comment',    // layer 1, tool 1
    'G1 X30 Y30',                  // travel inside the outer wall: not counted
    'G1 E-0.8',                    // retract: no movement
    ';WIPE_START',
    'G1 X35 Y30 E-.2',             // wipe: negative E
    ';WIPE_END',
    'G1 X40 Y30 E0.2',             // extruding again, layer 1 tool 1
    'T3',
    'G1 Y40 E0.2',                 // only Y given: X is kept
  ].join('\n');
  const walls = outerWalls(gcode);
  assert.equal(walls.length, 4);
  assert.deepEqual(walls[0], {layer: 0, z: 0.2, tool: 0, a: [10, 10], b: [20, 10]});
  assert.deepEqual(walls[1], {layer: 1, z: 0.32, tool: 1, a: [20, 20], b: [30, 20]});
  assert.deepEqual(walls[2], {layer: 1, z: 0.32, tool: 1, a: [35, 30], b: [40, 30]});
  assert.deepEqual(walls[3], {layer: 1, z: 0.32, tool: 3, a: [40, 30], b: [40, 40]});
});

test('outer walls follow absolute extrusion and extruding arcs', () => {
  const gcode = [
    'M82', 'G92 E0', 'T2', ';LAYER_CHANGE', ';Z:0.2', ';TYPE:Outer wall',
    'G1 X0 Y0 E1',                 // E goes from 0 to 1 with no move: a prime
    'G1 X10 Y0 E2',                // extrudes 1 mm of filament
    'G1 X20 Y0 E2',                // E unchanged: travel
    'G1 X10 Y0 E1.5',              // E goes down: a retract that moves
    'G92 E0',
    'G3 X0 Y0 I-5 J0 E0.5',        // half circle of radius 5 round (5, 0), anticlockwise
  ].join('\n');
  const walls = outerWalls(gcode);
  assert.deepEqual(walls[0], {layer: 0, z: 0.2, tool: 2, a: [0, 0], b: [10, 0]});
  const arc = walls.slice(1);
  assert.ok(arc.length >= 8, 'an arc is split into short chords');
  assert.deepEqual(arc[0].a, [10, 0]);
  assert.ok(Math.hypot(arc.at(-1).b[0], arc.at(-1).b[1]) < 1e-9);
  for (const w of arc) for (const p of [w.a, w.b]) assert.ok(Math.abs(Math.hypot(p[0] - 5, p[1]) - 5) < 1e-9);
  assert.ok(arc.every(w => w.a[1] >= -1e-9 && w.b[1] >= -1e-9), 'anticlockwise from (10, 0) to (0, 0) passes above the axis');
});

test('summarise reports the worst layer and fails a badly wrong layer even when the total is good', () => {
  const good = checkLayer(square(20, [1, 1, 1, 1]), ring(20, 0.21, [0, 0, 0, 0], 1));
  const bad = checkLayer(square(20, [1, 1, 1, 1]), ring(20, 0.21, [0, 0, 0, 1], 2));
  good.layer = 1; bad.layer = 2;
  const many = Array.from({length: 40}, (_, i) => ({...good, layer: i + 3}));
  const s = summarise([good, bad, ...many]);
  assert.equal(s.layersChecked, 42);
  assert.equal(s.worstLayer.layer, 2);
  assert.ok(s.worstLayer.matchedShare < 0.95);
  assert.ok(s.matchedShare > 0.99, `overall ${s.matchedShare}`);
  assert.equal(s.pass, false);
  // A layer with less than 20 mm judged does not fail the file on its own.
  const tiny = checkLayer(square(4, [1, 1, 1, 1]), ring(4, 0.21, [1, 1, 1, 1], 2));
  tiny.layer = 2;
  assert.ok(tiny.matched + tiny.wrong < 20);
  const t = summarise([good, tiny, ...many]);
  assert.ok(t.matchedShare > 0.99, `overall ${t.matchedShare}`);
  assert.equal(t.worstLayer.matchedShare, 1);
  assert.equal(t.worstSmallLayer.layer, 2);
  assert.equal(t.worstSmallLayer.matchedShare, 0);
  assert.equal(t.pass, true);
  assert.equal(summarise([]).pass, false);
});

test('section segments inside another part are dropped', () => {
  // Two overlapping squares: the parts of each square's outline inside the other are
  // not on the printed surface.
  const a = square(20, [1, 1, 1, 1]).map(s => ({...s, part: 0}));
  // A spans x -10..10, y -10..10; B spans x 0..20, y -5..15.
  const b = square(20, [2, 2, 2, 2]).map(s => ({...s, a: [s.a[0] + 10, s.a[1] + 5], b: [s.b[0] + 10, s.b[1] + 5], part: 1}));
  const kept = dropInside([...a, ...b], {piece: 0.5});
  const length = kept.reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);
  assert.ok(Math.abs(length - 110) < 1.01, `outline of the union is 110 mm, got ${length}`);
  for (const s of kept) {
    const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    if (s.part === 0) assert.ok(!(m[0] > 0 && m[0] < 20 && m[1] > -5 && m[1] < 15), 'square A inside B is dropped');
    else assert.ok(!(m[0] > -10 && m[0] < 10 && m[1] > -10 && m[1] < 10), 'square B inside A is dropped');
  }
  assert.ok(kept.some(s => s.part === 0) && kept.some(s => s.part === 1));
  // Two overlapping shells of one part (no part ids, as in a mesh with several shells)
  // are joined the same way, by winding.
  const strip = s => ({a: s.a, b: s.b, reel: s.reel});
  const shells = dropInside([...a.map(strip), ...b.map(strip)], {piece: 0.5});
  const shellLength = shells.reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);
  assert.ok(Math.abs(shellLength - 110) < 1.01, `outline of the union of two shells is 110 mm, got ${shellLength}`);
  // A shell wholly inside another leaves nothing of itself.
  const small = square(4, [3, 3, 3, 3]);
  const nested = dropInside([...a.map(strip), ...small], {piece: 0.5});
  assert.ok(nested.every(s => s.reel === 1));
  assert.ok(Math.abs(nested.reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0) - 80) < 1e-6);
  // A hole (a loop running the other way) is kept: it is a surface.
  const hole2 = square(4, [3, 3, 3, 3]).map(s => ({a: s.b, b: s.a, reel: 3}));
  const holed = dropInside([...a.map(strip), ...hole2], {piece: 0.5});
  assert.ok(Math.abs(holed.reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0) - 96) < 1e-6);
  // A negative part removes what lies inside it and adds nothing itself.
  const hole = square(4, [0, 0, 0, 0]).map(s => ({...s, a: [s.a[0] - 10, s.a[1]], b: [s.b[0] - 10, s.b[1]], part: 2, negative: true}));
  const cut = dropInside([...a, ...hole], {piece: 0.5});
  assert.ok(cut.every(s => s.part === 0));
  const cutLength = cut.reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);
  assert.ok(Math.abs(cutLength - 76) < 1.01, `the hole takes 4 mm of the left side, got ${cutLength}`);
});

test('hidden walls are broken down by tool and by distance from the outline', () => {
  // Reel 1 outline; walls at 0.21 (visible), 0.45 in T1 (another reel, 0.35-0.6),
  // 0.8 in T0 (0.6-1) and 1.5 in T3 (over 1 mm).
  const walls = [...ring(20, 0.21, [0, 0, 0, 0]), ...ring(20, 0.45, [1, 1, 1, 1]), ...ring(20, 0.8, [0, 0, 0, 0]), ...ring(20, 1.5, [3, 3, 3, 3])];
  const r = checkLayer(square(20, [1, 1, 1, 1]), walls);
  const side = inset => 4 * (20 - 2 * inset);
  assert.ok(Math.abs(r.hiddenByTool[1].near - side(0.45)) < 1e-6);
  assert.ok(Math.abs(r.hiddenByTool[0].mid - side(0.8)) < 1e-6);
  assert.ok(Math.abs(r.hiddenByTool[3].far - side(1.5)) < 1e-6);
  assert.equal(r.hiddenByTool[0].near, 0);
  assert.ok(Math.abs(r.hidden - (side(0.45) + side(0.8) + side(1.5))) < 1e-6);
  // The 0.35-0.6 mm band in a reel other than the outline's next to it, with examples.
  assert.ok(Math.abs(r.nearOtherReel - side(0.45)) < 1e-6);
  assert.ok(r.examples.nearOtherReel.length > 0 && r.examples.nearOtherReel.every(e => e.tool === 1 && e.reel === 1));
});

test('walls lying along dropped outline are counted by tool', () => {
  // Square A's right side lies inside square B and is dropped; a T2 wall runs along it.
  const a = square(20, [1, 1, 1, 1]);
  const b = square(20, [2, 2, 2, 2]).map(s => ({...s, a: [s.a[0] + 10, s.a[1] + 5], b: [s.b[0] + 10, s.b[1] + 5]}));
  const {kept, dropped} = splitInside([...a, ...b], {piece: 0.5});
  const len = list => list.reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);
  assert.ok(Math.abs(len(kept) - 110) < 1.01 && Math.abs(len(dropped) - 50) < 1.01, `kept ${len(kept)} dropped ${len(dropped)}`);
  assert.deepEqual(dropInside([...a, ...b], {piece: 0.5}), kept);
  const along = [{layer: 1, z: 0.32, tool: 2, a: [9.79, -4], b: [9.79, 9]}];        // 0.21 inside A's dropped right side
  const r = checkLayer(kept, along, {dropped});
  assert.ok(Math.abs(r.alongDropped[2] - 13) < 1e-6, JSON.stringify(r.alongDropped));
  assert.ok(Math.abs(r.alongDroppedHidden[2] - 13) < 1e-6, 'it is far from the kept outline, so hidden');
});

test('the outline guard fails a part or layer whose outline was lost, not an embedded part', () => {
  const opts = {minRaw: 20, partKeep: 0.05, walledShare: 0.9, layerKeep: 0.1};
  const good = {part: 0, raw: 400, kept: 390, walled: 5, area: 1000};
  assert.equal(outlineGuard({parts: [good], layers: [{layer: 1, raw: 40, kept: 39}]}, opts).ok, true);
  // Inside out: negative signed area fails, whatever was kept.
  const inverted = outlineGuard({parts: [good, {part: 1, raw: 300, kept: 0, walled: 300, area: -900}]}, opts);
  assert.equal(inverted.ok, false);
  assert.match(inverted.problems[0], /part 1 is wound inside out/);
  // Almost all dropped, with printed wall along nearly all of it: fails.
  const lost = outlineGuard({parts: [good, {part: 2, raw: 300, kept: 3, walled: 290, area: 700}]}, opts);
  assert.equal(lost.ok, false);
  assert.match(lost.problems[0], /part 2 keeps 3\.0 of 300\.0 mm/);
  // Almost all dropped but little wall along it: a part embedded in another, listed only.
  const embedded = outlineGuard({parts: [good, {part: 3, raw: 82.5, kept: 0.6, walled: 21.2, area: 50}]}, opts);
  assert.equal(embedded.ok, true);
  assert.match(embedded.embedded[0], /part 3 keeps 0\.6 of 82\.5 mm/);
  // A layer that keeps almost nothing fails.
  const layer = outlineGuard({parts: [], layers: [{layer: 7, raw: 50, kept: 2}]}, opts);
  assert.equal(layer.ok, false);
  assert.match(layer.problems[0], /layer 7/);
  // Small parts and layers are not judged by the guard.
  assert.equal(outlineGuard({parts: [{part: 1, raw: 10, kept: 0, walled: 10, area: -1}], layers: [{layer: 7, raw: 10, kept: 0}]}, opts).ok, true);
  assert.equal(outlineGuard({parts: [{part: 1, raw: 300, kept: 0, walled: 0, area: -5}]}).ok, false, 'the defaults fail an inverted part');
});
