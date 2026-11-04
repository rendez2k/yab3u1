import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readZip} from '../zip.js';
import {readProject, selectionFootprints, layoutInstances} from '../shared/project.js';
import {targetLayout} from '../shared/layout.js';

test('a rejected layout keeps source objects visible without bypassing output checks', async () => {
  const replies = [];
  globalThis.self = {postMessage: message => replies.push(message)};
  await import('../shared/recolour-worker.js');
  let id = 0;
  async function request(data) {
    const requestId = ++id;
    await self.onmessage({data: {...data, id: requestId}});
    return replies.findLast(reply => reply.id === requestId && reply.type !== 'progress');
  }
  const bytes = fs.readFileSync(new URL('./five-colours.3mf', import.meta.url));
  const project = readProject(await readZip(bytes)), plateId = project.plates[0].id;
  const objects = selectionFootprints(project, plateId, null);
  assert.ok(objects.length > 1);
  const omitted = objects[0].objectId;
  const selected = objects.slice(1).map(object => object.objectId);
  await request({type: 'load', bytes, light: true});
  const source = await request({type: 'preview', plateId, objects: selected, mode: 'original'});
  const layout = {...targetLayout('snapmaker', {copies: 3,
    spacing: 5, arrangement: 'objects', quantities: {[omitted]: 0}}), width: 1, depth: 1};
  assert.throws(() => layoutInstances(project, plateId, null, layout),
    error => error.code === 'LAYOUT_DOES_NOT_FIT');

  const blocked = await request({type: 'preview', plateId, objects: null, mode: 'original', layout});
  assert.equal(blocked.type, 'preview', blocked.message);
  assert.match(blocked.preview.layoutWarning, /extra copies are not arranged/);
  assert.ok(blocked.preview.positions.length > 0);
  assert.deepEqual(blocked.preview.positions, source.preview.positions, 'fallback preserves source placement');
  assert.equal(blocked.preview.pickRanges.length, selected.length, 'fallback does not pretend three copies fit');
  assert.ok(blocked.preview.pickRanges.every(range => range.objectId !== omitted), 'removed objects stay removed');

  const recoloured = await request({type: 'preview', plateId, objects: null, mode: 'result',
    colors: {1: '#00FF00'}, haveGeometry: blocked.preview.geometryId, layout});
  assert.equal(recoloured.type, 'preview', recoloured.message);
  assert.equal(recoloured.preview.positions, null, 'colour changes can reuse the fallback geometry');
  assert.equal(recoloured.preview.layoutWarning, blocked.preview.layoutWarning);

  const thumbnail = await request({type: 'thumbnail', plateId, objects: null, layout});
  assert.equal(thumbnail.type, 'error');
  assert.match(thumbnail.message, /does not fit/);
  const converted = await request({type: 'convert', plateId, objects: null, target: 'orca', layout});
  assert.equal(converted.type, 'error');
  assert.match(converted.message, /does not fit/);
  const exported = await request({type: 'export', plateId, objects: null, options: {
    target: 'orca', reels: project.colors.map(color => ({color, type: 'PLA'})),
    mapping: Object.fromEntries(project.colors.map((_, i) => [i + 1, i + 1])), recipes: [], layout,
  }});
  assert.equal(exported.type, 'error');
  assert.match(exported.message, /does not fit/);

  const fixed = await request({type: 'preview', plateId, objects: null, mode: 'original',
    haveGeometry: blocked.preview.geometryId,
    layout: targetLayout('snapmaker', {...layout, width: 270, depth: 270, copies: 2})});
  assert.equal(fixed.type, 'preview', fixed.message);
  assert.equal(fixed.preview.layoutWarning, '');
  assert.ok(fixed.preview.positions.length > blocked.preview.positions.length);
  assert.equal(fixed.preview.pickRanges.length, selected.length * 2);
});
