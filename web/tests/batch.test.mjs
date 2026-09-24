import assert from "node:assert/strict";
import { BatchSession, MAX_BATCH_OUTPUT } from "../shared/batchSession.js";

const file = (name = "model.3mf", size = 4) => ({ name, size, arrayBuffer: async () => new ArrayBuffer(4) });
const meta = { colors: ["#FF0000", "#FFFFFF"], types:['PLA','PLA'], warnings: [], sourceSettings: {
  sparse_infill_density: "7%", sparse_infill_pattern: "gyroid", seam_position: "back" },
  plates: [{ id: 1, name: "First", objectIds: ["1"] }, { id: 2, name: "Second", objectIds: ["2"] }] };
function harness({ failFirst = false, convert = null, load = null, plates = null } = {}) {
  const saved = [], events = [], calls = [];
  let created = 0, active = 0;
  const session = new BatchSession(() => {
    const number = created++;
    active += 1;
    assert.equal(active, 1, "previous source worker released before the next");
    let disposed = false;
    return {
      load: load || (async () => { if (failFirst && number === 0) throw Error("Broken archive");
        return { meta: { ...meta, plates: plates || meta.plates }, summary: {} }; }),
      bounds: async () => ({ bounds: { min: [0, 0, 0], max: [20, 20, 20] } }),
      thumbnail: async () => ({ main: new Uint8Array([1]), small: new Uint8Array([2]) }),
      convert: convert || (async (...args) => { calls.push(args); return { bytes: new Uint8Array([3, 4]) }; }),
      dispose: () => { if (!disposed) { disposed = true; active--; events.push(`dispose-${number}`); } },
    };
  }, () => ({
    request: async (type, data) => {
      if (type === "add") { saved.push(data); return {}; }
      assert.equal(active, 0, "no parsed source is retained while packing");
      return { bytes: new Uint8Array([9]) };
    }, dispose: () => events.push("archive-disposed"),
  }));
  return { session, saved, events, calls };
}

for (const target of ["snapmaker", "bambu", "orca", "prusa"]) {
  const h = harness();
  const result = await h.session.run([file("same.3mf"), file("same.3mf")], { target });
  assert.equal(result.report.outputs, 4);
  assert.equal(new Set(h.saved.map(e => e.name)).size, 4);
  assert.deepEqual(h.calls.map(args => args[0]), [1, 2, 1, 2]);
  for (const call of h.calls) {
    assert.equal(call[2], target);
    assert.deepEqual(call[3], { 1: 1, 2: 2 });
    assert.equal(call[5].preserveSourceSettings, true);
    assert.equal(call[5].layout.copies, 1);
    assert.ok(call[5].thumbnails.main);
  }
  assert.equal(result.report.entries[0].settings[0].values[target === "prusa" ? "fill_density" : "sparse_infill_density"], "7%");
  assert.ok(h.events.includes("archive-disposed"));
}
console.log("PASS all formats, every plate, settings, thumbnails, naming and worker cleanup");

{
  const h = harness({ failFirst: true });
  const result = await h.session.run([file("broken.3mf"), file("good.3mf")]);
  assert.equal(result.report.entries[0].message, "Broken archive");
  assert.equal(result.report.outputs, 2);
}
console.log("PASS broken input does not abort remaining files");
{
  const h = harness({ convert: async id => { if (id === 1) throw Error("Unsupported paint"); return { bytes: new Uint8Array([1]) }; } });
  const result = await h.session.run([file()]);
  assert.equal(result.report.outputs, 1);
  assert.deepEqual(result.report.entries.map(e => e.status), ["failed", "converted"]);
}
console.log("PASS failed plate does not discard successful plates");
{
  const h = harness();
  const result = await h.session.run([file("wrong.stl"), file("large.3mf", 97 * 1048576)]);
  assert.equal(result.report.outputs, 0);
  assert.equal(result.report.entries.filter(e => e.status === "failed").length, 2);
  assert.ok(result.bytes.length, "report ZIP still produced");
  await assert.rejects(h.session.run(Array.from({length: 51}, () => file())), /1–50/);
}
console.log("PASS input limits and report for wholly failed batch");
{
  const h = harness({ plates: [{ id: 1, objectIds: [] }, ...meta.plates] });
  const result = await h.session.run([file("../CON.3mf")], { target: "prusa", keepSettings: false });
  assert.equal(result.report.entries[0].status, "skipped");
  assert.equal(result.report.outputs, 2);
  assert.ok(h.saved.every(e => !e.name.includes("/") && /^001-/.test(e.name)));
  assert.ok(h.calls.every(args => !args[5].preserveSourceSettings && !args[5].carrySettings));
}
console.log("PASS empty plates, safe paths and settings opt-out");
{
  let unblock;
  const gate = new Promise(r => { unblock = r; });
  const h = harness({ convert: async id => { if (id === 2) await gate; return { bytes: new Uint8Array([1]) }; } });
  h.session.hooks.row = (_, { detail }) => {
    if (detail.startsWith("Plate 2")) { h.session.cancel(); unblock(); }
  };
  const result = await h.session.run([file(), file("later.3mf")]);
  assert.equal(result.report.outputs, 1);
  assert.equal(result.report.cancelled, true);
  assert.equal(result.report.entries.at(-1).status, "cancelled");
  const again = await h.session.run([file()]);
  assert.ok(again, "can rerun after cancellation");
}
console.log("PASS cancellation keeps completed files and marks unprocessed work");
{
  const huge = new Uint8Array(MAX_BATCH_OUTPUT / 2 + 1);
  const h = harness({ convert: async () => ({ bytes: huge }) });
  const result = await h.session.run([file()]);
  assert.equal(result.report.outputs, 1);
  assert.match(result.report.entries[1].message, /256 MB/);
}
console.log("PASS output memory cap keeps previous results");
{
  let resume;
  const h = harness({ load: () => new Promise(r => { resume = r; }) });
  const run = h.session.run([file()]);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(await h.session.run([file()]), null);
  h.session.close();
  resume({ meta, summary: {} });
  assert.equal(await run, null, "a closed page never publishes stale results");
}
console.log("PASS duplicate runs and stale output after close");
