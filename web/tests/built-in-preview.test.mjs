import test from 'node:test';
import assert from 'node:assert/strict';
import {FLAT_FACE_DEGREES, isNearFlat} from '../shared/flatFaceRule.js';
import {SHALLOW_DEGREES, isShallow, builtInFaceColour, shallowShare, shallowWarning} from '../shared/builtInPreview.js';

const CMYW = [{color: '#00AEEF', type: 'PLA', name: 'Cyan'}, {color: '#EC008C', type: 'PLA', name: 'Magenta'},
  {color: '#FFF200', type: 'PLA', name: 'Yellow'}, {color: '#FFFFFF', type: 'PLA', name: 'White'}];
const recipe = {sequence: [1, 3], color: '#7FD08A'};
const base = {recipe, reels: CMYW, firstLayer: 0.2, layerHeight: 0.1};
const UP = [0, 0, 1], DOWN = [0, 0, -1], SIDE = [1, 0, 0];
const CYAN = '#00AEEF', YELLOW = '#FFF200';
// Layer slices (first 0.2, height 0.1): layer 1 at 0.25, layer 2 at 0.35, layer 3 at 0.45.
// Layer 2 is the band 0.3 to 0.4; its lower half is 0.3 to 0.35, its upper half 0.35 to 0.4.

test('steep faces show the blended estimate; shallow faces show the single reel for their layer', () => {
  assert.equal(builtInFaceColour({...base, normal: SIDE, zMid: 0.35}), '#7FD08A');
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.25}), YELLOW);   // tie: tops layer 1 -> sequence[1] = reel 3
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.35}), CYAN);     // tie: tops layer 2 -> reel 1
});

test('an up-facing face in the lower half of a band takes the reel of the layer below', () => {
  // zMid 0.32 lies in layer 2's band but below its slice (0.35): it tops layer 1, not layer 2.
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.32}), YELLOW);
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.38}), CYAN);
});

test('a down-facing face in the upper half of a band takes the layer above', () => {
  // zMid 0.38 lies in layer 2's band but above its slice: it bottoms layer 3.
  assert.equal(builtInFaceColour({...base, normal: DOWN, zMid: 0.38}), YELLOW);   // layer 3 -> sequence[1] = reel 3
  assert.equal(builtInFaceColour({...base, normal: DOWN, zMid: 0.32}), CYAN);     // layer 2 -> reel 1
});

test('faces exactly on a slice height follow the export tie rule', () => {
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.35}), CYAN);    // tops layer 2
  assert.equal(builtInFaceColour({...base, normal: DOWN, zMid: 0.35}), YELLOW); // bottoms layer 3
  assert.equal(builtInFaceColour({...base, normal: DOWN, zMid: 0.25}), CYAN);   // bottoms layer 2
});

test('a face below the first slice stays in the first layer', () => {
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.05}), CYAN);     // layer 0 -> sequence[0]
  assert.equal(builtInFaceColour({...base, normal: DOWN, zMid: 0.0}), CYAN);
});

test('zHigh and zLow decide the layer when given, and default to zMid', () => {
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.32, zHigh: 0.36, zLow: 0.28}), CYAN);    // top reaches layer 2's slice
  assert.equal(builtInFaceColour({...base, normal: DOWN, zMid: 0.32, zHigh: 0.36, zLow: 0.34}), CYAN);  // lowest point 0.34 < 0.35: bottoms layer 2
  assert.equal(builtInFaceColour({...base, normal: DOWN, zMid: 0.32, zHigh: 0.36, zLow: 0.36}), YELLOW);
  assert.equal(builtInFaceColour({...base, normal: UP, zMid: 0.32}), YELLOW);
});

test('single-reel colours are read from the reels in slot order', () => {
  const r = {sequence: [4], color: '#123456'};
  assert.equal(builtInFaceColour({...base, recipe: r, normal: UP, zMid: 0.35}), '#FFFFFF');
});

test('the 30 degree cut-off, shared with the export rule', () => {
  assert.equal(SHALLOW_DEGREES, FLAT_FACE_DEGREES);
  assert.equal(SHALLOW_DEGREES, 30);
  assert.equal(isShallow([0, Math.sin(29 * Math.PI / 180), Math.cos(29 * Math.PI / 180)]), true);
  assert.equal(isShallow([0, Math.sin(31 * Math.PI / 180), Math.cos(31 * Math.PI / 180)]), false);
  assert.equal(isShallow(DOWN), true);
  for (const n of [UP, DOWN, SIDE, [0, 1, 1], [0, 0, 0], [0, Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180)]])
    assert.equal(isShallow(n), isNearFlat(n, FLAT_FACE_DEGREES).flat);
});

test('the warning names the affected share and stays silent when negligible', () => {
  assert.equal(shallowWarning(0.01), '');
  assert.equal(shallowWarning(0.234), 'About 23% of this model is flat or gently sloped. Those areas will print as single-reel bands, not blended shades.');
  assert.equal(shallowShare([{normal: UP, area: 1}, {normal: SIDE, area: 3}]), 0.25);
  assert.equal(shallowShare([]), 0);
});
