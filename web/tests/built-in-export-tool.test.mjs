// The command-line built-in colours export (tools/export-built-in.mjs): the plan for a set of
// source colours, and one end-to-end run through the real export on the repository's own model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as paint from '../shared/paint.js';
import {readZip} from '../zip.js';
import {BUILT_IN_PATH} from '../shared/builtInColours.js';
import {planFor, reelSet} from '../../tools/export-built-in.mjs';

const dec = new TextDecoder();
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// The twelve filament colours of the owner's model (colour values only, no geometry).
const TWELVE = ['#D3B7A7', '#FFFFFF', '#DE4343', '#000000', '#042F56', '#F99963', '#C2E189', '#68724D', '#F7D959', '#A3D8E1', '#E5B03D', '#E8AFCF'];

for (const set of ['cmyw', 'cmyk']) {
  test(`planFor gives one estimated row per source colour with ${set}`, () => {
    const plan = planFor(TWELVE, set);
    assert.equal(plan.rows.length, 12);
    assert.deepEqual(plan.rows.map(r => r.hex), TWELVE);
    for (const row of plan.rows) {
      assert.equal(row.estimated, true);
      assert.ok(row.sequence.length >= 1 && row.sequence.length <= 40, `${row.hex}: ${row.sequence.length} layers`);
      assert.ok(row.sequence.every(r => Number.isInteger(r) && r >= 1 && r <= 4), `${row.hex}: ${row.sequence}`);
      assert.match(row.shade, /^#[0-9A-F]{6}$/);
      assert.ok(Number.isFinite(row.error) && row.error >= 0);
      // The row's sequence is the one written, so it is the (phase-aligned) recipe's own.
      assert.deepEqual(row.sequence, plan.recipes.find(r => r.id === row.recipe).sequence);
    }
    assert.equal(plan.reels.length, 4);
  });
}

test('the white source maps to the single white reel under cmyw', () => {
  const plan = planFor(TWELVE, 'cmyw');
  const white = plan.rows.find(r => r.hex === '#FFFFFF');
  assert.deepEqual(white.sequence, [4]);
  assert.equal(white.error, 0);
  assert.equal(plan.backingSlot, 4);
});

test('cmyk puts black in slot 4 and backs with the lightest reel, yellow', () => {
  const plan = planFor(TWELVE, 'cmyk');
  assert.equal(plan.reels[3].color, '#000000');
  assert.equal(plan.backingSlot, 3);
  assert.deepEqual(plan.rows.find(r => r.hex === '#000000').sequence, [4]);
  assert.throws(() => planFor(TWELVE, 'rgb'), /cmyw or cmyk/);
  assert.equal(reelSet('cmyw')[3].color, '#FFFFFF');
});

test('an end-to-end run on four-colours.3mf writes a four-reel built-in project and its plan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yab3d-built-in-'));
  try {
    const out = join(dir, 'four-colours-built-in.3mf');
    const run = spawnSync(process.execPath, ['tools/export-built-in.mjs', 'web/tests/four-colours.3mf', out, '--reels=cmyw'], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const entries = await readZip(new Uint8Array(readFileSync(out)));
    const record = JSON.parse(dec.decode(entries.get(BUILT_IN_PATH)));
    assert.equal(record.layerHeight, 0.12);
    assert.equal(record.firstLayer, 0.2);
    assert.equal(record.backingSlot, 4);
    const cfg = JSON.parse(dec.decode(entries.get('Metadata/project_settings.config')));
    assert.equal(cfg.filament_colour.length, 4);
    assert.equal(cfg.layer_height, '0.12');
    const states = new Set();
    for (const [name, data] of entries) {
      if (!name.endsWith('.model')) continue;
      for (const m of dec.decode(data).matchAll(/(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/g))
        for (const s of paint.walkStates(paint.decode(m[1]))) states.add(s);
    }
    assert.ok(states.size > 0);
    assert.ok([...states].every(s => s >= 1 && s <= 4), [...states].join());
    const planPath = `${out}.plan.json`;
    assert.ok(existsSync(planPath));
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    assert.equal(plan.reelSet, 'cmyw');
    assert.match(plan.note, /never printed/);
    assert.match(plan.note, /not a check of printed colour/);
    // The model's four colours (white, black, red, green), each mapped to the recipe written for it.
    assert.deepEqual(plan.rows.map(r => r.hex), ['#FFFFFF', '#000000', '#FF0000', '#00FF00']);
    const white = plan.rows.find(r => r.hex === '#FFFFFF');
    assert.equal(white.sequence, '4');
    for (const row of plan.rows) {
      const recipe = record.recipes.find(r => r.id === row.recipe);
      assert.ok(recipe, `recipe ${row.recipe} for ${row.hex} is in the record`);
      assert.equal(recipe.sequence.join(''), row.sequence);
    }
    assert.deepEqual(record.recipes.find(r => r.id === white.recipe).sequence, [4]);
    assert.ok(plan.rows.length >= 1);
    for (const row of plan.rows) {
      assert.equal(row.estimated, true);
      assert.match(row.hex, /^#[0-9A-F]{6}$/);
      assert.match(row.shade, /^#[0-9A-F]{6}$/);
      assert.ok(row.sequence.length >= 1);
      assert.equal(typeof row.error, 'number');
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

const runTool = (args) => spawnSync(process.execPath, ['tools/export-built-in.mjs', ...args], {cwd: ROOT, encoding: 'utf8'});

test('--objects picks objects by name, and only their colours are planned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yab3d-built-in-'));
  try {
    const out = join(dir, 'beta.3mf');
    const run = runTool(['web/tests/four-colours.3mf', out, '--reels=cmyk', '--objects=Beta']);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const plan = JSON.parse(readFileSync(`${out}.plan.json`, 'utf8'));
    assert.deepEqual(plan.objects.map(o => o.name), ['Beta']);
    assert.deepEqual(plan.rows.map(r => r.hex), ['#FF0000', '#00FF00']);
    assert.equal(plan.backingSlot, 3);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a refusal exits non-zero with its message and writes nothing; a fault is not called a refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yab3d-built-in-'));
  try {
    const out = join(dir, 'x.3mf');
    const reels = runTool(['web/tests/four-colours.3mf', out, '--reels=rgb']);
    assert.equal(reels.status, 1);
    assert.match(reels.stderr, /^Refused: Choose --reels=cmyw or cmyk \(not "rgb"\)\./);
    const missing = runTool(['web/tests/four-colours.3mf', out, '--reels=cmyw', '--objects=Gamma']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /^Refused: There is no object called "Gamma"\./);
    assert.ok(!existsSync(out) && !existsSync(`${out}.plan.json`));
    const absent = runTool([join(dir, 'no-such-file.3mf'), out, '--reels=cmyw']);
    assert.notEqual(absent.status, 0);
    assert.doesNotMatch(absent.stderr, /Refused/);
    assert.match(absent.stderr, /^Error: .*ENOENT/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
