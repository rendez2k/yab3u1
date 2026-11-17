import test from 'node:test';
import assert from 'node:assert/strict';
import { bedRect, primeTowerSpot, placePrimeTower, TOWER } from '../shared/primeTower.js';

const area = ['0.5x1', '270.5x1', '270.5x271', '0.5x271'], bed = bedRect(area);

test('the bed is read from the slicer area list', () => {
  assert.deepEqual(bed, { x0: 0.5, x1: 270.5, y0: 1, y1: 271 });
  assert.equal(bedRect(['nonsense']), null); assert.equal(bedRect(undefined), null);
});
test('with nothing known the tower starts at the front left, with the bed behind it to grow into', () => {
  const spot = primeTowerSpot(bed);
  assert.deepEqual([spot.x, spot.y, spot.clear], [17, 17, true]);
  assert.ok(spot.x - TOWER.margin >= bed.x0 && spot.y - TOWER.margin >= bed.y0, 'ribs and brim stay on the bed');
  assert.ok(bed.y1 - spot.y > 200, 'far more room than the profile position at y = 211 gave');
});
test('the tower keeps clear of the model where a corner allows it', () => {
  // A model in the middle leaves every corner free: front left is kept.
  assert.deepEqual(primeTowerSpot(bed, { x0: 100, x1: 170, y0: 100, y1: 170 }).x, 17);
  // A model along the left side sends the tower to the right.
  const right = primeTowerSpot(bed, { x0: 5, x1: 80, y0: 5, y1: 260 });
  assert.ok(right.x > 200 && right.clear);
  // A wide model at the front sends it to the back.
  const back = primeTowerSpot(bed, { x0: 5, x1: 265, y0: 5, y1: 90 });
  assert.ok(back.y > 100 && back.clear);
  // A model filling the bed leaves no clear spot; one is still chosen and reported.
  const full = primeTowerSpot(bed, { x0: 5, x1: 265, y0: 5, y1: 265 });
  assert.equal(full.clear, false); assert.ok(Number.isInteger(full.x));
  // A bed too small for a tower is left alone.
  assert.equal(primeTowerSpot({ x0: 0, x1: 40, y0: 0, y1: 40 }), null);
});
test('a config with a tower gets the spot on every plate; one without is untouched', () => {
  const cfg = { enable_prime_tower: '1', printable_area: area, prime_tower_width: '30', wipe_tower_x: ['13', '13'], wipe_tower_y: ['211', '211'] };
  const spot = placePrimeTower(cfg, { x0: 100, x1: 170, y0: 100, y1: 170 });
  assert.deepEqual([cfg.wipe_tower_x, cfg.wipe_tower_y], [['17', '17'], ['17', '17']]); assert.equal(spot.clear, true);
  const off = { enable_prime_tower: '0', printable_area: area, wipe_tower_x: ['13'], wipe_tower_y: ['211'] };
  assert.equal(placePrimeTower(off), null); assert.deepEqual(off.wipe_tower_y, ['211']);
  const none = { enable_prime_tower: '1', wipe_tower_x: ['13'] };
  assert.equal(placePrimeTower(none), null); assert.deepEqual(none.wipe_tower_x, ['13']);
});
