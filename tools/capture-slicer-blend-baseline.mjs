// Capture slicer-blend exports with the worker of a given web/ tree.
//   node capture-baseline.mjs <tree-with-web> <repo-web-tests-dir>
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const [tree, testsDir] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(join(testsDir, 'slicer-blend-baseline.json'), 'utf8'));
// Object UUIDs are random per export; a counter, reset for each case, makes the bytes comparable.
let uuids = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', {value: () => `00000000-0000-4000-8000-${String(++uuids).padStart(12, '0')}`, configurable: true});
const replies = [];
globalThis.self = {postMessage: m => replies.push(m)};
await import(pathToFileURL(join(tree, 'web/shared/recolour-worker.js')).href);
let id = 0;
const request = async data => { const n = ++id; await self.onmessage({data: {...data, id: n}}); return replies.findLast(r => r.id === n && r.type !== 'progress'); };
const bytes = new Uint8Array(readFileSync(join(testsDir, spec.source)));
const loaded = await request({type: 'load', bytes: bytes.buffer.slice(0)});
if (loaded.type !== 'loaded') throw Error(loaded.message);
for (const c of spec.cases) {
  uuids = 0;
  const thumb = await request({type: 'thumbnail', plateId: c.plateId, objects: c.objects, colors: c.thumbnail.colors, mapping: c.thumbnail.mapping, size: 512, small: 128});
  if (thumb.type !== 'thumbnail') throw Error(thumb.message);
  const out = await request({type: 'export', plateId: c.plateId, objects: c.objects, options: {...c.options, thumbnails: {main: thumb.main, small: thumb.small}}});
  if (out.type !== 'exported') throw Error(out.message);
  writeFileSync(join(testsDir, c.file), out.bytes);
  console.log(c.file, out.bytes.length);
}
