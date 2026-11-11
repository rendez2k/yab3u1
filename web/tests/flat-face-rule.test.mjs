import test from 'node:test';
import assert from 'node:assert/strict';
import {sliceMid, flatFaceLayer, isNearFlat, pieceLayer, FLAT_FACE_DEGREES} from '../shared/flatFaceRule.js';

const FIRST = 0.2, H = 0.12;

test('slice heights are mid-layer, with the thicker first layer at half its height', () => {
  assert.equal(sliceMid(0, FIRST, H), 0.1);
  assert.ok(Math.abs(sliceMid(1, FIRST, H) - 0.26) < 1e-12);
  assert.ok(Math.abs(sliceMid(18, FIRST, H) - 2.30) < 1e-12);
});

test('an up-facing flat face tops the highest layer whose slice is below it', () => {
  // They Live's plinth ledge: z 2.29 lies in layer 18's band (2.24-2.36) but below its slice (2.30).
  assert.equal(flatFaceLayer(2.29, true, FIRST, H), 17);
  assert.equal(flatFaceLayer(2.31, true, FIRST, H), 18);
  // A face exactly on a band boundary (Super Man layer 101's top at 12.32) tops that layer.
  assert.equal(flatFaceLayer(12.32, true, FIRST, H), 101);
  // In the first layer and just above it: the first slice is at 0.10, the second at 0.26.
  assert.equal(flatFaceLayer(0.25, true, FIRST, H), 0);
  assert.equal(flatFaceLayer(0.27, true, FIRST, H), 1);
  assert.equal(flatFaceLayer(0.05, true, FIRST, H), 0, 'below the first slice there is no lower layer; it stays in the first');
});

test('a down-facing flat face is the bottom of the lowest layer whose slice is above it', () => {
  // They Live layer 112: an underside at 13.49 is in band 111 (13.40-13.52) but above its slice (13.46).
  assert.equal(flatFaceLayer(13.49, false, FIRST, H), 112);
  assert.equal(flatFaceLayer(13.44, false, FIRST, H), 111);
  // On the bed, and anywhere below the first slice: the first layer.
  assert.equal(flatFaceLayer(0, false, FIRST, H), 0);
  assert.equal(flatFaceLayer(0.08, false, FIRST, H), 0);
  // Between the first and second slices: the second layer (Super Man layer 1's undersides at 0.08 are below 0.10, so stay in 0).
  assert.equal(flatFaceLayer(0.12, false, FIRST, H), 1);
  assert.equal(flatFaceLayer(0.25, false, FIRST, H), 1);
  assert.equal(flatFaceLayer(0.27, false, FIRST, H), 2);
});

test('near-flat means the normal is within the angle of vertical, up or down', () => {
  const tilt = deg => [Math.sin(deg * Math.PI / 180), 0, Math.cos(deg * Math.PI / 180)];
  assert.deepEqual(isNearFlat(tilt(29), 30), {flat: true, up: true});
  assert.deepEqual(isNearFlat(tilt(31), 30), {flat: false, up: true});
  assert.deepEqual(isNearFlat(tilt(170), 30), {flat: true, up: false});
  assert.deepEqual(isNearFlat([0, 0, -5], 30), {flat: true, up: false}, 'normals need not be unit length');
  assert.deepEqual(isNearFlat([1, 0, 0], 30), {flat: false, up: false});
  assert.deepEqual(isNearFlat([0, 0, 0], 30), {flat: false, up: false}, 'a zero normal is never flat');
});

test('a piece within 30 degrees of vertical takes the layer it tops or bottoms, judged by its own extreme height', () => {
  assert.equal(FLAT_FACE_DEGREES, 30);
  const up = [0, 0, 1], down = [0, 0, -1], tilt = deg => [Math.sin(deg * Math.PI / 180), 0, Math.cos(deg * Math.PI / 180)];
  // Up-facing: the highest point decides. 2.29 is below layer 18's slice (2.30), 2.31 above it.
  assert.equal(pieceLayer({normal: up, zHigh: 2.29, zLow: 2.25, layer: 18}, FIRST, H), 17);
  assert.equal(pieceLayer({normal: up, zHigh: 2.31, zLow: 2.25, layer: 18}, FIRST, H), 18, 'a piece reaching its own slice keeps its band');
  // Down-facing: the lowest point decides. 13.49 is above layer 111's slice (13.46).
  assert.equal(pieceLayer({normal: down, zHigh: 13.51, zLow: 13.49, layer: 111}, FIRST, H), 112);
  assert.equal(pieceLayer({normal: down, zHigh: 13.51, zLow: 13.44, layer: 111}, FIRST, H), 111);
  // Within the angle, up and down; beyond it the band's own layer stands.
  assert.equal(pieceLayer({normal: tilt(29), zHigh: 2.29, zLow: 2.25, layer: 18}, FIRST, H), 17);
  assert.equal(pieceLayer({normal: tilt(31), zHigh: 2.29, zLow: 2.25, layer: 18}, FIRST, H), 18);
  assert.equal(pieceLayer({normal: tilt(151), zHigh: 13.51, zLow: 13.49, layer: 111}, FIRST, H), 112);
  assert.equal(pieceLayer({normal: [1, 0, 0], zHigh: 2.29, zLow: 2.25, layer: 18}, FIRST, H), 18);
  assert.equal(pieceLayer({normal: [0, 0, 0], zHigh: 2.29, zLow: 2.25, layer: 18}, FIRST, H), 18, 'a zero normal keeps its band');
});

test('a face exactly at a slice height is decided the same way at every layer', () => {
  // The tie: a face within EDGE (1e-6 layer) of layer n's slice counts as on it, so facing
  // up it tops layer n and facing down it is the bottom of layer n + 1. Without the
  // tolerance, rounding in (z - first) / height flipped about 4% of these.
  for (const h of [0.12, 0.08, 0.2]) {
    for (let n = 1; n <= 1199; n++) {
      const z = sliceMid(n, FIRST, h);
      assert.equal(flatFaceLayer(z, true, FIRST, h), n, `up, h ${h}, n ${n}`);
      assert.equal(flatFaceLayer(z, false, FIRST, h), n + 1, `down, h ${h}, n ${n}`);
      // A hundredth of a layer either side is not a tie.
      assert.equal(flatFaceLayer(z - h / 100, true, FIRST, h), n - 1 < 1 ? 0 : n - 1, `up just below, h ${h}, n ${n}`);
      assert.equal(flatFaceLayer(z + h / 100, false, FIRST, h), n + 1, `down just above, h ${h}, n ${n}`);
      assert.equal(flatFaceLayer(z - h / 100, false, FIRST, h), n, `down just below, h ${h}, n ${n}`);
    }
  }
});
