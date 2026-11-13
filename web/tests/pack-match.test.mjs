import assert from 'node:assert/strict';
import { packMatch, matchShare, MATCH_ZERO_DISTANCE } from '../shared/packMatch.js';
import { FILAMENT_BUNDLES } from '../shared/filamentBundles.js';

const reel = (color, extra = {}) => ({ color, type: 'PLA', ...extra });
assert.equal(matchShare(0), 1); assert.equal(matchShare(MATCH_ZERO_DISTANCE), 0); assert.equal(matchShare(999), 0);

// A pack that holds every model colour is a full match.
const exact = packMatch([{ color: '#FF0000', weight: 2 }, { color: '#0000FF', weight: 1 }], [reel('#FF0000'), reel('#0000FF')], 4);
assert.equal(exact.percent, 100); assert.deepEqual(exact.reels, [0, 1]);

// A blend counts: green from cyan and yellow beats either reel alone.
const cmy = [reel('#0086D6'), reel('#D9308A'), reel('#F7E400'), reel('#FFFFFF')];
const green = packMatch([{ color: '#3DA35D', weight: 1 }], cmy, 4);
const noYellow = packMatch([{ color: '#3DA35D', weight: 1 }], [cmy[0], cmy[1], cmy[3]], 4);
assert.ok(green.percent > noYellow.percent + 10, `blend should help: ${green.percent} vs ${noYellow.percent}`);

// Surface area decides: the same miss matters more on the larger colour.
const big = packMatch([{ color: '#FF0000', weight: 9 }, { color: '#00FF00', weight: 1 }], [reel('#FF0000')], 1);
const small = packMatch([{ color: '#FF0000', weight: 1 }, { color: '#00FF00', weight: 9 }], [reel('#FF0000')], 1);
assert.ok(big.percent > small.percent);
// Without areas every colour counts the same.
assert.equal(packMatch([{ color: '#FF0000' }, { color: '#00FF00' }], [reel('#FF0000')], 1).percent, 50);

// More reels than inputs: the best set that fits is chosen and named.
const six = [reel('#FFFFFF'), reel('#000000'), reel('#FF0000'), reel('#00FF00'), reel('#0000FF'), reel('#FFFF00')];
const pick = packMatch([{ color: '#FF0000', weight: 1 }, { color: '#0000FF', weight: 1 }], six, 2);
assert.equal(pick.percent, 100); assert.deepEqual(pick.reels, [2, 4]);
// One input cannot blend.
assert.deepEqual(packMatch([{ color: '#3DA35D', weight: 1 }], cmy, 1).reels.length, 1);

// Support-interface reels and unreadable input are left out.
assert.deepEqual(packMatch([{ color: '#FF0000', weight: 1 }], [reel('#FF0000', { role: 'support-interface' }), reel('#00FF00')], 4).reels, [0]);
assert.equal(packMatch([], cmy, 4), null); assert.equal(packMatch([{ color: '#FF0000' }], [], 4), null); assert.equal(packMatch([{ color: 'nope' }], cmy, 4), null);

// Every catalogue pack scores quickly, including large ones.
const model = ['#F4C2A1', '#8B4513', '#7BC043', '#5B2C83', '#FF7F00', '#FFFFFF', '#101010', '#2060C0'].map((color, i) => ({ color, weight: i + 1 }));
const started = Date.now();
for (const bundle of FILAMENT_BUNDLES) {
  const m = packMatch(model, bundle.reels, 4);
  assert.ok(m && m.percent >= 0 && m.percent <= 100 && m.reels.length <= 4, bundle.id);
}
assert.ok(Date.now() - started < 4000, `catalogue scoring took ${Date.now() - started} ms`);
console.log('PASS pack match: exact, blends, area weighting, reel selection, catalogue in', Date.now() - started, 'ms; largest pack', Math.max(...FILAMENT_BUNDLES.map(b => b.reels.length)), 'reels');
