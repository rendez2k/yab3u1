import assert from 'node:assert/strict';
import { collectSettings, readSettings, applySettings, describeSettings, SETTINGS_PARTS } from '../shared/settingsFile.js';

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), map: m }; };
const reels = [{ color: '#FFFFFF', type: 'PLA' }, { color: '#0086D6', type: 'PLA', name: 'Cyan' }];
const a = store({ 'yab3u1-web-reels': JSON.stringify(reels), 'yab3d-reel-td': JSON.stringify({ '#0086D6': 3.24, 'elegoo-white': 6 }), 'yab3u1-theme': 'dark' });

const { file, skipped } = collectSettings(a);
assert.deepEqual(skipped, []);
assert.deepEqual(Object.keys(file.data), ['reels', 'td']);
assert.equal(file.data.td['#0086D6'], 3.2, 'TD is kept to one decimal place');

// Round trip into an empty browser.
const b = store();
const data = readSettings(JSON.stringify(file));
applySettings(b, data);
assert.deepEqual(JSON.parse(b.map.get('yab3u1-web-reels')), reels);
assert.deepEqual(JSON.parse(b.map.get('yab3d-reel-td')), { '#0086D6': 3.2, 'elegoo-white': 6 });
assert.equal(b.map.size, 2, 'only known parts are written');
assert.equal(describeSettings(data), '2 loaded reels, 2 reel TD values');

// A part the file does not hold is left alone.
const c = store({ 'yab3d-reel-td': JSON.stringify({ x: 5 }) });
applySettings(c, readSettings(JSON.stringify({ ...file, data: { reels } })));
assert.deepEqual(JSON.parse(c.map.get('yab3d-reel-td')), { x: 5 });

// Damaged storage is skipped and named, not exported.
const d = collectSettings(store({ 'yab3d-reel-td': '{"x":9999}', 'yab3u1-web-reels': 'not json' }));
assert.deepEqual(d.file.data, {});
assert.deepEqual(d.skipped, ['loaded reels', 'reel TD values']);

// Refused files change nothing.
for (const [bad, why] of [
  ['nonsense', /not a YAB3D settings file/], [JSON.stringify({ app: 'other', data: {} }), /not a YAB3D settings file/],
  [JSON.stringify({ ...file, version: 2 }), /different version/], [JSON.stringify({ ...file, data: {} }), /empty/],
  [JSON.stringify({ ...file, data: { td: { x: 0 } } }), /0\.1 to 100/], [JSON.stringify({ ...file, data: { reels: [{ color: 'red' }] } }), /colour/],
  [JSON.stringify({ ...file, data: { reels, td: { x: 500 } } }), /0\.1 to 100/], ['x'.repeat(3 * 1024 * 1024), /2 MB/],
]) assert.throws(() => readSettings(bad), why);
// Unknown parts in a file are ignored.
assert.deepEqual(Object.keys(readSettings(JSON.stringify({ ...file, data: { ...file.data, extra: 1, 'yab3u1-theme': 'x' } }))), ['reels', 'td']);
assert.equal(SETTINGS_PARTS.length, 4);
console.log('PASS settings file: round trip, partial files, damaged storage, refused files');
