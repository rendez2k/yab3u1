// The plate layout: capacity, centring, copies as build items over one mesh.
//
// Run from the project root:  node web/tests/layout.test.mjs

import assert from "node:assert/strict";

import { layoutCapacity, layoutOffsets, planLayout, targetLayout } from "../shared/layout.js";
import { encodePng } from "../shared/png.js";
import * as project from "../shared/project.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
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

/** The user's pumpkin, as root measured it: bounds and the source placement. */
const PUMPKIN = {
  min: [-31.951, -28.465, -25.657], max: [31.951, 28.465, 25.657],
};
const PUMPKIN_SIZE = [63.902, 56.93, 51.314];

await ok("capacity follows the box, the model and the spacing", () => {
  const grid = layoutCapacity(PUMPKIN_SIZE, { width: 270, depth: 270, spacing: 5 });
  assert.equal(grid.columns, Math.floor((270 + 5) / (63.902 + 5)));
  assert.equal(grid.rows, Math.floor(270 + 5) / (56.93 + 5) | 0);
  assert.ok(grid.capacity >= 12, `expected at least a dozen, got ${grid.capacity}`);
  const tiny = layoutCapacity(PUMPKIN_SIZE, { width: 70, depth: 70, spacing: 5 });
  assert.equal(tiny.capacity, 1, "a box barely bigger than the model holds one");
  const reserved = layoutCapacity(PUMPKIN_SIZE, { width: 270, depth: 270, spacing: 5,
                                                   tower: true });
  assert.ok(reserved.capacity <= grid.capacity,
            "reserving the prime tower cannot add copies");
});

await ok("one copy is centred on the layout box and grounded", () => {
  const plan = planLayout(PUMPKIN, { copies: 1, spacing: 5, width: 270, depth: 270 });
  const offsets = layoutOffsets(PUMPKIN, plan);
  assert.equal(offsets.length, 1);
  const [dx, dy, dz] = offsets[0];
  assert.ok(Math.abs((PUMPKIN.min[0] + PUMPKIN.max[0]) / 2 + dx) < 1e-9,
            "the group's centre lands on X=0");
  assert.ok(Math.abs((PUMPKIN.min[1] + PUMPKIN.max[1]) / 2 + dy) < 1e-9,
            "the group's centre lands on Y=0, so the file is bed-agnostic");
  assert.equal(PUMPKIN.min[2] + dz, 0, "the group sits on Z=0");
});

await ok("copies form a centred grid that stays inside the box", () => {
  const plan = planLayout(PUMPKIN, { copies: 4, spacing: 5, width: 270, depth: 270 });
  assert.equal(plan.copies, 4);
  const offsets = layoutOffsets(PUMPKIN, plan);
  assert.equal(offsets.length, 4);
  assert.equal(new Set(offsets.map((o) => o.join(","))).size, 4, "distinct places");
  for (const [dx, dy] of offsets) {
    const minX = PUMPKIN.min[0] + dx;
    const maxX = PUMPKIN.max[0] + dx;
    const minY = PUMPKIN.min[1] + dy;
    const maxY = PUMPKIN.max[1] + dy;
    assert.ok(minX >= -270 / 2 - 1e-6 && maxX <= 270 / 2 + 1e-6,
              `copy outside the box in X: ${minX}..${maxX}`);
    assert.ok(minY >= -270 / 2 - 1e-6 && maxY <= 270 / 2 + 1e-6,
              `copy outside the box in Y: ${minY}..${maxY}`);
  }
  const left = Math.min(...offsets.map((o) => o[0]));
  const right = Math.max(...offsets.map((o) => o[0]));
  assert.ok(Math.abs(left + right) < 1e-6, "the block is centred");
});

await ok("an impossible copy count is capped, not faked", () => {
  const plan = planLayout(PUMPKIN, { copies: 40, spacing: 5, width: 70, depth: 70 });
  assert.equal(plan.copies, plan.capacity, "copies are capped at what fits");
  assert.equal(plan.capped, true, "and the page is told");
});

await ok("the source placement is replaced by the layout, never doubled", () => {
  // The pumpkin's source file carries Y=264.757 (a U1-plate placement).  With a
  // layout the exports must end up centred, not at that offset.
  const parsed = project.readProject(pumpkinLike());
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu",
                                         layout: { copies: 1, spacing: 5,
                                                   width: 270, depth: 270 } });
  const model = decoder.decode(built.entries.get(project.MODEL_FILE));
  const item = /<item\b[^>]*transform="([^"]*)"/.exec(model);
  assert.ok(item, "the build item carries the placement");
  const numbers = item[1].split(/\s+/).map(Number);
  const [, , , , , , , , , tx, ty, tz] = numbers;
  // The composed placement puts the group's world centre on the layout box centre
  // (X=Y=0) and grounds it, so the source's 264mm offset is gone, not doubled.
  assert.ok(Math.abs(tx) < 1e-3, `X should be centred, got ${tx}`);
  assert.ok(Math.abs(ty) < 1e-3, `Y should be centred, got ${ty}`);
  assert.ok(Math.abs(tz - 25.6570015) < 1e-3,
            `Z should ground the local mesh, got ${tz}`);
  const localMinZ = -25.657;
  assert.ok(Math.abs((localMinZ + tz)) < 1e-3, "the group rests on Z=0");
});

await ok("N copies are N build items over one mesh, paint unchanged", () => {
  const parsed = project.readProject(pumpkinLike());
  const single = project.convertProject(parsed, 1, null, { target: "bambu" });
  const filled = project.convertProject(parsed, 1, null,
                                        { target: "bambu",
                                          layout: { copies: 6, spacing: 5,
                                                    width: 270, depth: 270 } });
  const items = (entries) => [...decoder.decode(entries.get(project.MODEL_FILE))
    .matchAll(/<item\b/g)].length;
  const objects = (entries) => [...decoder.decode(entries.get(project.MODEL_FILE))
    .matchAll(/<object\b/g)].length;
  assert.equal(items(single.entries), 1);
  assert.equal(items(filled.entries), 6, "one item per copy");
  assert.equal(objects(filled.entries), objects(single.entries),
               "the copies share one object and one mesh member");
  const mesh = (entries) => [...decoder.decode(entries.get("3D/Objects/object_inline.model"))
    .matchAll(/<triangle\b/g)].length;
  assert.equal(mesh(filled.entries), mesh(single.entries),
               "the mesh is written once, not once per copy");
  assert.ok(!decoder.decode(filled.entries.get("3D/Objects/object_inline.model"))
    .includes("paint_color"), "the standard model still carries no paint");
});

await ok("the source-settings control is opt-in, narrow and native-shaped", () => {
  const parsed = project.readProject(pumpkinLike({
    layer_height: "0.2", first_layer_height: "0.2", support_material: "1",
    support_material_auto: "0", support_material_style: "organic",
    support_material_threshold: "40",
  }));
  assert.equal(parsed.sourceSettings.layer_height, "0.2");
  const layout = { copies: 1, spacing: 5, width: 270, depth: 270 };
  const off = project.convertProject(parsed, 1, null, { target: "bambu", layout });
  const on = project.convertProject(parsed, 1, null,
                                    { target: "bambu", layout,
                                      preserveSourceSettings: true });
  const settings = (built) => decoder.decode(
    built.entries.get("Metadata/model_settings.config"));
  assert.ok(!/layer_height|enable_support/.test(settings(off)),
            "the default export carries no source settings");
  const carried = settings(on);
  assert.ok(carried.includes('<metadata key="layer_height" value="0.2"/>'));
  assert.ok(carried.includes('<metadata key="enable_support" value="1"/>'));
  assert.ok(carried.includes('<metadata key="support_type" value="tree(manual)"/>'),
            "organic + manual maps to the native tree(manual) type");
  assert.ok(carried.includes('<metadata key="support_style" value="tree_organic"/>'),
            "the real native organic style is named");
  assert.ok(carried.includes('<metadata key="support_threshold_angle" value="40"/>'));
  assert.ok(!carried.includes("first_layer_height"),
            "the destination's first layer is left alone");
  // Still a printer-agnostic colour model with all its colours declared.
  assert.equal(on.entries.has("Metadata/project_settings.config"), false);
  assert.equal((decoder.decode(on.entries.get(project.MODEL_FILE))
    .match(/<m:color color=/g) || []).length, 2);
  const reread = project.readProject(on.entries);
  assert.equal([...reread.meta.values()][0].settings.support_style, "tree_organic",
               "our own reader reads the settings back");
});

/** A small project whose group is placed at the pumpkin's source translation. */
function pumpkinLike(extra = {}) {
  const mesh = `<object id="2" type="model"><mesh><vertices>`
    + '<vertex x="-31.951" y="-28.465" z="-25.657"/>'
    + '<vertex x="31.951" y="-28.465" z="-25.657"/>'
    + '<vertex x="0" y="28.465" z="25.657"/></vertices><triangles>'
    + '<triangle v1="0" v2="1" v3="2" paint_color="4"/>'
    + "</triangles></mesh></object>";
  const root = '<object id="1" type="model"><components>'
    + '<component objectid="2"/></components></object>';
  const model = '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"'
    + ` unit="millimeter"><resources>${mesh}${root}</resources><build>`
    + '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 140.626388 264.757218 '
    + '25.6570015"/></build></model>';
  const config = '<config><object id="1"><metadata key="name" value="Flippin Pumpkin"/>'
    + '<metadata key="extruder" value="1"/></object>'
    + "<plate><metadata key=\"plater_id\" value=\"1\"/>"
    + '<model_instance><metadata key="object_id" value="1"/></model_instance>'
    + "</plate></config>";
  return new Map([
    ["3D/3dmodel.model", encoder.encode(model)],
    ["Metadata/project_settings.config", encoder.encode(JSON.stringify({
      filament_colour: ["#FF9500", "#000000"],
      filament_type: ["PLA", "PLA"],
      ...extra,
    }))],
    ["Metadata/model_settings.config", encoder.encode(config)],
  ]);
}

await ok("U1 fill ignores a larger source bed and configures every copy", async () => {
  const parsed = project.readProject(pumpkinLike());
  const thumbnails = {
    main: await encodePng(new Uint8Array(512 * 512 * 4), 512, 512),
    small: await encodePng(new Uint8Array(128 * 128 * 4), 128, 128),
  };
  const built = project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: { 1: 2, 2: 1 },
    layout: { copies: 99, width: 350, depth: 320, spacing: 5, tower: true },
    thumbnails,
  });
  const reread = project.readProject(built.entries);
  const all = project.selectionInstances(reread, 1, null);
  assert.equal(all.length, 12, "only the U1 capacity, and all copies on its plate");
  assert.equal(new Set(all.map(([id]) => id)).size, 12, "distinct configured roots");
  for (const [id] of all) {
    assert.equal(Number(reread.meta.get(id).extruder), 2);
    assert.equal(Number(reread.meta.get(id).parts[0].extruder), 2);
    const bounds = project.selectionBounds(reread, 1, [id]);
    assert.ok(bounds.min[0] >= 0.5 && bounds.max[0] <= 270.5);
    assert.ok(bounds.min[1] >= 1 && bounds.max[1] <= 271);
    assert.ok(Math.abs(bounds.min[2]) < 1e-6);
  }
  assert.equal([...built.entries.keys()].filter((key) => key.startsWith("3D/Objects/")).length, 1);
  const withoutThumbnail = project.convertProject(parsed, 1, null, {
    target: "snapmaker", layout: { copies: 4, width: 270, depth: 270, spacing: 5 },
  });
  assert.equal(project.selectionInstances(project.readProject(withoutThumbnail.entries), 1, null).length, 4);
});

await ok("Bambu shared copies all remain registered when a thumbnail is saved", async () => {
  const built = project.convertProject(project.readProject(pumpkinLike()), 1, null, {
    target: "bambu", layout: { copies: 6, width: 270, depth: 270, spacing: 5 },
    thumbnails: {
      main: await encodePng(new Uint8Array(512 * 512 * 4), 512, 512),
      small: await encodePng(new Uint8Array(128 * 128 * 4), 128, 128),
    },
  });
  assert.equal(project.selectionInstances(project.readProject(built.entries), 1, null).length, 6);
});

await ok("U1 rejects a model taller than its build volume", () => {
  assert.equal(planLayout({ min: [0, 0, 0], max: [20, 20, 300] },
    targetLayout("snapmaker", { width: 350, depth: 320 })).blocked, true);
});

if (failures.length) {
  console.error(`\n${failures.length} layout check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`layout ok: ${checks} checks`);
}
