import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseChangelog,segments} from './whats-new.mjs';

test('bold runs are split out and nothing else is treated as markup',()=>{
  assert.deepEqual(segments('**One strip.** A row of `walls` <b>x</b>'),[{bold:true,text:'One strip.'},{text:' A row of walls <b>x</b>'}]);
  assert.deepEqual(segments('plain'),[{text:'plain'}]);
});
test('releases, paragraphs and list items are read in order, newest first',()=>{
  const got=parseChangelog('# Changes\n\n## 2.0.1 — Second\n\nWhy.\n\n- **A.** one\n- two\n  wrapped\n\n## 2.0.0 - First\n- only\n\n## 1.9.0\nold',2);
  assert.equal(got.length,2);
  assert.deepEqual([got[0].version,got[0].title],['2.0.1','Second']);
  assert.deepEqual(got[0].blocks.map(b=>b.kind),['p','li','li']);
  assert.equal(got[0].blocks[2].parts.map(p=>p.text).join(''),'two wrapped');
  assert.deepEqual([got[1].version,got[1].title,got[1].blocks.length],['2.0.0','First',1]);
});
test('the real changelog starts with the version the shell shows',()=>{
  const releases=parseChangelog(readFileSync(new URL('../../CHANGELOG.md',import.meta.url),'utf8'),10);
  assert.equal(releases.length,10);
  const shown=/id="whats-new"[^>]*>v([0-9.]+)</.exec(readFileSync(new URL('./index.html',import.meta.url),'utf8'))?.[1];
  assert.equal(releases[0].version,shown,'the newest changelog entry matches the version label');
  for(const r of releases){assert.ok(r.title,`${r.version} has a title`);assert.ok(r.blocks.length,`${r.version} has notes`);}
});
