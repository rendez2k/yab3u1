// Stale-response tests for the homepage converter's session.
//
// The session decides whether a reply belongs to the file and the assignment the
// user is looking at now.  Driving it with a fake worker whose replies the test
// releases by hand shows those decisions without a browser.
//
// Run from the project root:  node web/tests/convert-race.test.mjs

import assert from "node:assert/strict";

import { ConvertSession, identityRule } from "../shared/convertSession.js";

let checks = 0;
const failures = [];

async function ok(name, fn) {
  try {
    await fn();
    checks += 1;
    console.log("PASS", name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log("FAIL", name, error.message);
  }
}

/** Let queued microtasks and one macrotask run, so a page-style race can be set up. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A worker whose every reply parks until the test releases it. */
class FakeWorker {
  constructor(project) {
    this.project = project;
    this.closed = false;
    this.calls = [];
    this.waiting = [];
  }

  park() {
    const waiter = {};
    waiter.promise = new Promise((resolve) => {
      waiter.resolve = resolve;
    });
    this.waiting.push(waiter);
    return waiter.promise;
  }

  releaseAll() {
    const waiting = this.waiting;
    this.waiting = [];
    waiting.forEach((waiter) => waiter.resolve());
  }

  async load(bytes, options) {
    this.calls.push({ type: "load", options });
    await this.park();
    if (this.closed) throw new Error("the worker was disposed");
    return { meta: this.project.meta, summary: this.project.summary };
  }

  async convert(plateId, objects, target, mapping, title, options) {
    this.calls.push({ type: "convert", plateId, target, mapping, title, options });
    await this.park();
    if (this.closed) throw new Error("the worker was disposed");
    return { bytes: new Uint8Array([1, 2, 3, 4]), ms: 1 };
  }

  dispose() {
    this.closed = true;
    this.releaseAll();
  }
}

function project(name) {
  return {
    meta: {
      kind: "bambu", title: name, colors: ["#0080C0", "#FF0000", "#FFFFFF"],
      types: ["PLA", "PLA", "PLA"], warnings: [],
      plates: [{ id: 1, name: "Plate 1" }],
    },
    summary: { triangles: 123, plate: { id: 1, name: "Plate 1", objects: 1 },
               mixtures: [] },
  };
}

const file = (name) => ({ name, arrayBuffer: async () => new ArrayBuffer(8) });

function recorder() {
  const seen = { status: [], loaded: [], output: [], error: [], busy: [] };
  return {
    seen,
    hooks: {
      status: (text) => seen.status.push(text),
      loaded: (state) => seen.loaded.push(state.title),
      output: (entry) => seen.output.push(entry ? entry.name : null),
      error: (message) => seen.error.push(message),
      busy: (value) => seen.busy.push(value),
    },
  };
}

const urls = { create: () => "blob:fake", revoke: () => {} };

/** Load a file and let both the disk read and the worker reply complete. */
async function load(session, worker, name) {
  const promise = session.load(file(name));
  await tick();
  worker.releaseAll();
  return promise;
}

await ok("a newer file wins: the older load's reply is discarded", async () => {
  const made = [];
  const hooks = recorder();
  const session = new ConvertSession(() => {
    const worker = new FakeWorker(project(`file ${made.length + 1}`));
    made.push(worker);
    return worker;
  }, hooks.hooks, urls);

  const first = session.load(file("one.3mf"));
  await tick();
  assert.equal(made.length, 1, "the first load reached its own worker");
  const second = session.load(file("two.3mf"));
  await tick();
  assert.equal(made.length, 2, "the second load has its own worker");
  assert.equal(made[0].closed, true, "the first worker was stopped, not leaked");
  made[1].releaseAll();
  assert.equal(await first, null, "the older load resolves to nothing");
  await second;
  assert.equal(session.state && session.state.title, "file 2",
               "only the newest file is loaded");
});

await ok("an export in flight is dropped when the file is replaced", async () => {
  const made = [];
  const hooks = recorder();
  const session = new ConvertSession(() => {
    const worker = new FakeWorker(project(`file ${made.length + 1}`));
    made.push(worker);
    return worker;
  }, hooks.hooks, urls);

  const victim = session.load(file("victim.3mf"));
  await tick();
  made[0].releaseAll();
  await victim;
  const exporting = session.convert("bambu");
  await tick();
  assert.equal(made[0].calls.filter((call) => call.type === "convert").length, 1);

  const replaced = session.load(file("replacement.3mf"));
  await tick();
  made[1].releaseAll();
  await replaced;
  assert.equal(await exporting, null, "the stale bytes are dropped, not published");
  assert.equal(session.output, null);
  assert.deepEqual(hooks.seen.output, [], "the page never saw a download");
  assert.equal(session.busy, false,
               "replacing the file released the export lock for the new one");
});

await ok("only one export runs at a time", async () => {
  const worker = new FakeWorker(project("single"));
  const hooks = recorder();
  const session = new ConvertSession(() => worker, hooks.hooks, urls);
  await load(session, worker, "single.3mf");

  const first = session.convert("bambu");
  const second = session.convert("bambu");          // refused, not queued
  assert.equal(await second, null, "a duplicate export is not started");
  await tick();
  assert.equal(worker.calls.filter((call) => call.type === "convert").length, 1);
  worker.releaseAll();
  const entry = await first;
  assert.ok(entry && entry.name === "single-bambu.3mf", entry && entry.name);
});

await ok("changing the assignment revokes the previous download", async () => {
  const revoked = [];
  const worker = new FakeWorker(project("assign"));
  const session = new ConvertSession(() => worker, recorder().hooks,
                                     { create: () => "blob:assign",
                                       revoke: (url) => revoked.push(url) });
  await load(session, worker, "assign.3mf");
  const exporting = session.convert("bambu");
  await tick();
  worker.releaseAll();
  const entry = await exporting;
  assert.ok(entry, "the first export produced a download");
  session.setSource(1, 3);
  assert.equal(session.output, null, "the old download is gone");
  assert.deepEqual(revoked, ["blob:assign"], "and its URL was released");
});

await ok("an exchange is simultaneous and the swapped rule reaches the worker",
         async () => {
  const worker = new FakeWorker(project("swap"));
  const session = new ConvertSession(() => worker, recorder().hooks, urls);
  await load(session, worker, "swap.3mf");
  assert.deepEqual(session.rule, identityRule(3));
  session.swap(1, 3);
  assert.deepEqual(session.rule, { 1: 3, 2: 2, 3: 1 });
  assert.deepEqual(session.changes(),
                   [{ source: 1, destination: 3 }, { source: 3, destination: 1 }]);
  const exporting = session.convert("bambu");
  await tick();
  worker.releaseAll();
  await exporting;
  const call = worker.calls.filter((entry) => entry.type === "convert").pop();
  assert.deepEqual(call.mapping, { 1: 3, 2: 2, 3: 1 },
                   "the page sends the swapped rule, not the original");
});

await ok("reset returns to identity and clears the previous download", async () => {
  const worker = new FakeWorker(project("reset"));
  const session = new ConvertSession(() => worker, recorder().hooks, urls);
  await load(session, worker, "reset.3mf");
  const exporting = session.convert("bambu");
  await tick();
  worker.releaseAll();
  await exporting;
  session.swap(1, 2);
  session.reset();
  assert.deepEqual(session.rule, identityRule(3));
  assert.equal(session.output, null);
  assert.deepEqual(session.changes(), []);
});

await ok("a refused conversion never publishes a download", async () => {
  const worker = new FakeWorker(project("refuse"));
  worker.convert = async () => {
    throw new Error("this project carries native Full Spectrum blends");
  };
  const hooks = recorder();
  const session = new ConvertSession(() => worker, hooks.hooks, urls);
  await load(session, worker, "blends.3mf");
  const entry = await session.convert("snapmaker");
  assert.equal(entry, null);
  assert.deepEqual(hooks.seen.output, [], "no download was offered");
  assert.match(hooks.seen.error.join(" "), /blends/);
});

await ok("the title is captured before the export awaits", async () => {
  const worker = new FakeWorker(project("captured"));
  const session = new ConvertSession(() => worker, recorder().hooks, urls);
  await load(session, worker, "captured.3mf");
  const exporting = session.convert("prusa");
  await tick();
  session.state.title = "changed underneath";     // a later edit must not matter
  worker.releaseAll();
  const entry = await exporting;
  assert.equal(entry.name, "captured-prusa.3mf",
              "the name comes from the snapshot, not the live state");
});

/* ---------- the two assignment modes ---------- */

await ok("a slot move displaces the colour that was there, and never merges", async () => {
  const worker = new FakeWorker(project("slots"));
  const session = new ConvertSession(() => worker, recorder().hooks, urls);
  await load(session, worker, "slots.3mf");
  assert.equal(session.assignmentMode, "slots", "the homepage opens arranging slots");
  session.setSource(1, 3);
  assert.deepEqual(session.rule, { 1: 3, 2: 2, 3: 1 },
                   "the colour in filament 3 swapped back to the one colour 1 left");
  // A destination that is free does not displace anything.
  session.setSource(2, 2);
  assert.deepEqual(session.rule, { 1: 3, 2: 2, 3: 1 }, "no-op stays a no-op");
});

await ok("the two modes keep their own assignment across a switch", async () => {
  const worker = new FakeWorker(project("both"));
  const session = new ConvertSession(() => worker, recorder().hooks, urls);
  await load(session, worker, "both.3mf");
  session.setSource(1, 3);                       // arrange a slot
  session.setAssignmentMode("repaint");
  assert.deepEqual(session.rule, identityRule(3),
                   "repaint starts from its own, own untouched map");
  session.setSource(1, 3);
  session.setSource(2, 3);
  assert.deepEqual(session.rule, { 1: 3, 2: 3, 3: 3 },
                   "repainting may merge two colours onto one filament");
  session.setAssignmentMode("slots");
  assert.deepEqual(session.rule, { 1: 3, 2: 2, 3: 1 },
                   "the slot arrangement is exactly as it was left");
  assert.equal(session.setAssignmentMode("slots"), false, "already there");
  assert.equal(session.setAssignmentMode("nonsense"), false,
               "an unknown mode does not switch away from slots");
});

await ok("a mode switch discards an export that is still writing", async () => {
  const worker = new FakeWorker(project("switch"));
  const hooks = recorder();
  const session = new ConvertSession(() => worker, hooks.hooks, urls);
  await load(session, worker, "switch.3mf");
  const exporting = session.convert("bambu");
  await tick();
  assert.equal(worker.calls.filter((call) => call.type === "convert").length, 1);
  const before = session.revision;
  session.setAssignmentMode("repaint");
  assert.ok(session.revision > before, "the mode change bumps the revision");
  worker.releaseAll();
  assert.equal(await exporting, null, "the bytes of the old mode are dropped");
  assert.equal(session.output, null);
  assert.deepEqual(hooks.seen.output, [], "the page never saw a download");
  assert.equal(session.busy, false, "and the export lock is released");
});

await ok("a slot change discards an export that is still writing", async () => {
  const worker = new FakeWorker(project("later"));
  const hooks = recorder();
  const session = new ConvertSession(() => worker, hooks.hooks, urls);
  await load(session, worker, "later.3mf");
  const exporting = session.convert("bambu");
  await tick();
  session.setSource(1, 3);
  worker.releaseAll();
  assert.equal(await exporting, null);
  assert.deepEqual(hooks.seen.output, []);
});

await ok("reset clears only the mode in force", async () => {
  const worker = new FakeWorker(project("resetmode"));
  const session = new ConvertSession(() => worker, recorder().hooks, urls);
  await load(session, worker, "resetmode.3mf");
  session.setSource(1, 3);
  session.setAssignmentMode("repaint");
  session.setSource(2, 3);
  session.reset();
  assert.deepEqual(session.rule, identityRule(3), "the repaint is cleared");
  session.setAssignmentMode("slots");
  assert.deepEqual(session.rule, { 1: 3, 2: 2, 3: 1 },
                   "the other mode kept its arrangement");
});

await ok("a new file starts arranging slots with both maps at identity", async () => {
  const made = [];
  const session = new ConvertSession(() => {
    const worker = new FakeWorker(project("next"));
    made.push(worker);
    return worker;
  }, recorder().hooks, urls);
  const first = session.load(file("arranged.3mf"));
  await tick();
  made[0].releaseAll();
  await first;
  session.setSource(1, 3);
  session.setAssignmentMode("repaint");
  session.setSource(2, 3);
  const replacement = session.load(file("replacement.3mf"));
  await tick();
  assert.equal(made.length, 2, "the new file has its own worker");
  made[1].releaseAll();
  await replacement;
  assert.equal(session.assignmentMode, "slots", "a new file opens in slots mode");
  assert.deepEqual(session.rule, identityRule(3));
  session.setAssignmentMode("repaint");
  assert.deepEqual(session.rule, identityRule(3),
                   "the replaced file's repaint is not carried over either");
});

await ok("the mode reaches the worker with the export it belongs to", async () => {
  const worker = new FakeWorker(project("mode"));
  const session = new ConvertSession(() => worker, recorder().hooks, urls);
  await load(session, worker, "mode.3mf");
  session.setSource(1, 3);
  let exporting = session.convert("bambu");
  await tick();
  worker.releaseAll();
  await exporting;
  let call = worker.calls.filter((entry) => entry.type === "convert").pop();
  assert.equal(call.options.assignmentMode, "slots");
  session.setAssignmentMode("repaint");
  exporting = session.convert("bambu");
  await tick();
  worker.releaseAll();
  await exporting;
  call = worker.calls.filter((entry) => entry.type === "convert").pop();
  assert.equal(call.options.assignmentMode, "repaint");
  assert.deepEqual(call.mapping, identityRule(3),
                   "and the repaint's own map, not the slot arrangement");
});

await ok("U1 uses its own bed while generic targets retain the user's area", async () => {
  const fixture = project("large Bambu bed");
  fixture.summary.plateSize = [350, 320];
  const worker = new FakeWorker(fixture);
  const session = new ConvertSession(() => worker, {}, urls);
  await load(session, worker, "large.3mf");
  assert.equal(session.layout.width, 270);
  assert.equal(session.layout.depth, 270);
  assert.deepEqual(session.layout.centre, [135.5, 136]);
  session.setLayout({ width: 350, depth: 320 });
  assert.equal(session.layout.width, 270, "a U1 cannot use an oversized box");
  session.setTarget("bambu");
  assert.equal(session.layout.width, 350);
  assert.equal(session.layout.depth, 320);
  assert.deepEqual(session.layout.centre, [0, 0]);
  session.setLayout({ width: 256, depth: 256 });
  session.setTarget("snapmaker");
  assert.equal(session.layout.width, 270);
  session.setTarget("bambu");
  assert.equal(session.layout.width, 256);
});

await ok('unused filaments start deselected and can be restored without stale exports', async () => {
  const fixture=project('unused');
  fixture.meta.filamentUsage={kept:[1,3],unused:[2]};
  const worker=new FakeWorker(fixture);
  const session=new ConvertSession(()=>worker,{},urls);
  await load(session,worker,'unused.3mf');
  assert.deepEqual(session.activeColourIds(),[1,3]);
  assert.equal(session.setSource(1,2),false);
  session.setUnused(2,true);
  assert.deepEqual(session.activeColourIds(),[1,2,3]);
  session.setSource(1,2);
  const pending=session.convert('bambu');
  await tick();
  assert.deepEqual(worker.calls.at(-1).options.includeUnused,[2]);
  session.setUnused(2,false);
  worker.releaseAll();
  assert.equal(await pending,null);
  assert.deepEqual(session.rule,identityRule(3));
  assert.deepEqual(session.activeColourIds(),[1,3]);
});

if (failures.length) {
  console.error(`\n${failures.length} race check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`convert race ok: ${checks} checks`);
}
