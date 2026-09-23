// Portable conversion between dialects: identity by default, explicit repaint,
// simultaneous exchanges, no foreign machine settings, visible refusals.
//
// Run from the project root:  node web/tests/convert.test.mjs
//
// Every check below is *awaited*, so a failure inside an async check is counted
// before the exit decision rather than printing after the summary.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { readZip } from "../zip.js";
import * as project from "../shared/project.js";
import * as targets from "../shared/targets.js";
import * as paint from "../shared/paint.js";

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

/** A Bambu-shaped project with `colours` palette entries and painted facets.
 *
 * Object 1 is a component pointing at an inline mesh object 2, painted with the
 * given codes, so paint, base extruder and structure all have to survive.
 */
function source({ colours, types, codes, base = 2 }) {
  const triangle = (code) => `<triangle v1="0" v2="1" v3="2"`
    + `${code ? ` paint_color="${code}"` : ""}/>`;
  const mesh = `<object id="2" type="model"><mesh><vertices>`
    + `<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>`
    + `<vertex x="0" y="1" z="0"/></vertices><triangles>`
    + codes.map(triangle).join("") + `</triangles></mesh></object>`;
  const root = `<object id="1" type="model"><components>`
    + `<component objectid="2"/></components></object>`;
  const model = `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"`
    + ` unit="millimeter"><resources>${mesh}${root}</resources>`
    + `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30"/></build></model>`;
  const config = `<config><object id="1">`
    + `<metadata key="name" value="Part"/><metadata key="extruder" value="${base}"/>`
    + `<part id="2" subtype="normal_part"><metadata key="name" value="body"/>`
    + `<metadata key="extruder" value="${base}"/></part></object>`
    + `<plate><metadata key="plater_id" value="1"/>`
    + `<model_instance><metadata key="object_id" value="1"/>`
    + `<metadata key="instance_id" value="0"/></model_instance></plate></config>`;
  return new Map([
    ["3D/3dmodel.model", encoder.encode(model)],
    ["Metadata/project_settings.config", encoder.encode(JSON.stringify({
      filament_colour: colours, filament_type: types }))],
    ["Metadata/model_settings.config", encoder.encode(config)],
  ]);
}

/** Every `.model` member of an archive, concatenated: an inline mesh may be
 *  written to its own member, so the paint is not always in the root model. */
function allModelText(entries) {
  let text = "";
  for (const [name, data] of entries) {
    if (name.endsWith(".model")) text += decoder.decode(data);
  }
  return text;
}

/** Leaf states in document order: sorting would hide a swap that cancels out. */
function statesOf(entries) {
  const text = allModelText(entries);
  const out = [];
  for (const match of text.matchAll(/(?:slic3rpe:)?(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]*)"/g)) {
    if (!match[1]) continue;
    for (const state of paint.walkStates(paint.decode(match[1]))) out.push(state);
  }
  return out;
}

function configOf(entries) {
  const member = entries.get("Metadata/project_settings.config");
  return member ? JSON.parse(decoder.decode(member)) : null;
}

/** Leaf states of a *standard colour* model: `p1`, else the object's `pindex`. */
function standardStatesOf(entries) {
  const out = [];
  for (const [name, data] of entries) {
    if (!name.endsWith(".model")) continue;
    const blob = decoder.decode(data);
    for (const object of blob.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const index = /pindex="([^"]*)"/.exec(object[1]);
      const fallback = index === null ? null : Number(index[1]);
      for (const triangle of object[2].matchAll(/<triangle\b([^>]*?)\/>/g)) {
        const first = /(?:m:)?p1="([^"]*)"/.exec(triangle[1]);
        const value = first ? Number(first[1]) : fallback;
        if (value === null || Number.isNaN(value)) continue;
        out.push(value + 1);
      }
    }
  }
  return out;
}

/** The leaf states a target writes: paint for the project dialects, colour
 *  references for the printer-agnostic Bambu model. */
function statesFor(entries, target) {
  return target === "bambu" && !allModelText(entries).includes("paint_color=")
    ? standardStatesOf(entries) : statesOf(entries);
}

const memberText = (entries, name) => decoder.decode(entries.get(name) || new Uint8Array(0));

/** How many colour entries one model document declares. */
const colourCountOf = (text) => (text.match(/<m:color\b/g) || []).length;

const FIVE = {
  colours: ["#0080C0", "#FF0000", "#FFFFFF", "#000000", "#C5C263"],
  types: ["PLA", "PLA", "PLA", "PLA", "PLA"],
  // "4" = state 1, "1C" = state 4, "2C" = state 5, plus an unpainted facet.
  codes: ["4", "1C", "2C", ""],
};

/** The same project with a second object on a second plate. */
function twoPlates() {
  const entries = source(FIVE);
  const model = decoder.decode(entries.get("3D/3dmodel.model"))
    .replace("</resources>",
      '<object id="3" type="model"><mesh><vertices>'
      + '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>'
      + '<vertex x="0" y="1" z="0"/></vertices>'
      + '<triangles><triangle v1="0" v2="1" v3="2" paint_color="8"/></triangles>'
      + "</mesh></object></resources>")
    .replace("</build>",
      '<item objectid="3" transform="1 0 0 0 1 0 0 0 1 -40 -50 -60"/></build>');
  entries.set("3D/3dmodel.model", encoder.encode(model));
  const config = decoder.decode(entries.get("Metadata/model_settings.config"))
    .replace("</config>",
      '<object id="3"><metadata key="name" value="Second"/>'
      + '<metadata key="extruder" value="3"/></object>'
      + "<plate><metadata key=\"plater_id\" value=\"2\"/>"
      + '<model_instance><metadata key="object_id" value="3"/></model_instance>'
      + "</plate></config>");
  entries.set("Metadata/model_settings.config", encoder.encode(config));
  return entries;
}

for (const target of ["snapmaker", "bambu", "orca", "prusa"]) {
  await ok(`five colours convert to ${target} with every filament kept`, () => {
    const parsed = project.readProject(source(FIVE));
    const built = project.convertProject(parsed, 1, null, { target });
    assert.deepEqual(built.problems, [], built.problems.join("; "));
    const cfg = configOf(built.entries);
    if (cfg) {
      assert.equal(cfg.filament_colour.length, 5, "five logical filaments");
      if (target !== "snapmaker") {
        for (const key of targets.MACHINE_KEYS) {
          assert.ok(!(key in cfg), `${key} must not travel to another dialect`);
        }
      }
      assert.ok(!("filament_is_mixed" in cfg), "conversion creates no mixtures");
    } else if (target === "bambu") {
      // The printer-agnostic route: a standard colour model, and no project
      // settings, printer, process or filament preset at all.
      assert.equal(built.entries.has("Metadata/project_settings.config"), false,
                   "a printer-agnostic model must carry no project settings");
      assert.equal(colourCountOf(memberText(built.entries, project.MODEL_FILE)), 5,
                   "the palette is declared in full");
      assert.ok(allModelText(built.entries).includes('<metadata name="Application">'
        + "yab3u1"), "the file names its real producer");
      assert.deepEqual([...new Set(standardStatesOf(built.entries))].sort(),
                       [1, 2, 4, 5], "every facet reference resolves inside the palette");
    }
    const model = allModelText(built.entries);
    assert.ok(target === "bambu" ? model.includes("pid=")
      : (model.includes("paint_color=") || model.includes("mmu_segmentation=")),
              "the colours travel");
    assert.ok(model.includes("1 0 0 0 1 0 0 0 1 10 20 30"),
              "the placement is preserved");
  });
}

await ok("a multi-plate project writes only the chosen plate", () => {
  const parsed = project.readProject(twoPlates());
  assert.equal(parsed.plates.length, 2, "both plates are read");
  const first = project.convertProject(parsed, 1, null, { target: "bambu" });
  const second = project.convertProject(parsed, 2, null, { target: "bambu" });
  assert.deepEqual(statesFor(first.entries, "bambu"), [1, 4, 5, 2],
                   "plate 1's facets");
  assert.deepEqual(statesFor(second.entries, "bambu"), [2],
                   "plate 2's painted facet");
  assert.ok(allModelText(first.entries).includes("1 0 0 0 1 0 0 0 1 10 20 30"),
            "plate 1 keeps its own placement");
  assert.ok(!allModelText(first.entries).includes("-40 -50 -60"),
            "plate 2's placement does not leak into plate 1");
});

await ok("identity mapping keeps every facet state exactly", () => {
  const parsed = project.readProject(source(FIVE));
  const built = project.convertProject(parsed, 1, null, { target: "bambu" });
  // The unpainted facet carries no paint attribute at all: its colour travels as
  // the part's base extruder, which is checked below.
  assert.deepEqual(statesFor(built.entries, "bambu"), [1, 4, 5, 2],
                   "three painted facets, then the unpainted facet on the base colour");
  const settings = decoder.decode(built.entries.get("Metadata/model_settings.config"));
  // The standard model has no filaments for an extruder index to mean, so the
  // unpainted facet carries the base colour as a colour reference instead.
  assert.ok(settings.includes('key="name" value="Part"'),
            "the object keeps its identity");
  const everyModel = [...built.entries].filter(([name]) => name.endsWith(".model"))
    .map(([, data]) => decoder.decode(data)).join("\n");
  assert.ok(/<object\b[^>]*pid="\d+" pindex="1"/.test(everyModel),
            "the mesh object declares the base colour as its default");
});

// A split node from the documented grammar, worked out by hand and *not* produced
// by the encoder under test: 2 bits sides=1, 2 bits special side=2, then two leaf
// children (escaped state 3, state 0).  Bit order is least-significant first, so
// 1,0 | 0,1 | 0,0,1,1,0,0,0,0 | 0,0,0,0,0,0,0,0 = 0x00C9.
const SPLIT = "00C9";

await ok("a split tree is decoded from the documented grammar", () => {
  assert.deepEqual(paint.decode(SPLIT),
                   { kind: "split", sides: 1, specialSide: 2,
                     children: [{ kind: "leaf", state: 3 },
                                { kind: "leaf", state: 0 }] });
});

await ok("a paint dialect keeps a split tree byte for byte", () => {
  const parsed = project.readProject(source({ ...FIVE, codes: ["", SPLIT] }));
  const identity = project.convertProject(parsed, 1, null, { target: "snapmaker" });
  assert.ok(allModelText(identity.entries).includes(`paint_color="${SPLIT}"`),
            "an untouched split tree is not re-encoded");
});

await ok("the standard model materialises split leaves as exact triangles", () => {
  const parsed = project.readProject(source({ ...FIVE, codes: ["", SPLIT] }));
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu", mapping: { 3: 1 } });
  const model = allModelText(built.entries);
  assert.equal(model.includes("paint_color"), false,
               "the printer-agnostic model carries no paint attribute");
  const triangles = [...model.matchAll(/<triangle\b([^>]*?)\/>/g)];
  assert.equal(triangles.length, 3, "the split facet became two real triangles");
  const p1 = triangles.map((match) => /p1="([0-9]+)"/.exec(match[1])[1]).sort();
  assert.deepEqual(p1, ["0", "1", "1"],
                   "leaf 3 -> colour 1, leaf 0 and the unpainted facet -> the base");
  // The split added exactly one midpoint, and the two children tile the parent.
  const vertices = [...model.matchAll(/<vertex\b[^>]*?\/>/g)].length;
  assert.equal(vertices, 4, "one midpoint, deduplicated");
  const areaOf = (match) => {
    const at = ["v1", "v2", "v3"].map((name) =>
      Number(new RegExp(`${name}="([0-9]+)"`).exec(match)[1]));
    const points = at.map((index) => pointOf(model, index));
    const [a, b, c] = points;
    return Math.abs(((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2);
  };
  const areas = [...model.matchAll(/<triangle\b([^>]*?)\/>/g)]
    .map((m) => Number(areaOf(m[1]).toFixed(3))).sort((a, b) => a - b);
  assert.deepEqual(areas, [0.25, 0.25, 0.5],
                   "the two children exactly tile the split parent");
});

/** The `index`th vertex of a model's first mesh, as a flat [x, y] pair. */
function pointOf(model, index) {
  const vertices = [...model.matchAll(/<vertex x="([^"]*)" y="([^"]*)" z="([^"]*)"/g)];
  const vertex = vertices[index];
  return [Number(vertex[1]), Number(vertex[2])];
}

await ok("a source-to-output assignment repaints full faces and split leaves", () => {
  const parsed = project.readProject(source(FIVE));
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu", mapping: { 4: 3, 5: 1 } });
  // "1C" (state 4) becomes 3, "2C" (state 5) becomes 1, state 1 stays put.
  assert.deepEqual(statesFor(built.entries, "bambu"), [1, 3, 1, 2]);
});

await ok("exchanging 1 and 3 is simultaneous, not a cascade", () => {
  const parsed = project.readProject(source({ ...FIVE, codes: ["4", "8"] }));
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu", mapping: { 1: 3, 3: 1 } });
  // Ordered, not sorted: identity would give [1, 2], so this cannot pass by luck.
  assert.deepEqual(statesFor(built.entries, "bambu"), [3, 2],
                   "state 1 becomes 3 and state 2 is untouched");
});

await ok("exchanging two states is not indistinguishable from identity", () => {
  const two = { ...FIVE, codes: ["4", "1C", "8"] };
  const parsed = project.readProject(source(two));
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu", mapping: { 1: 4, 4: 1 } });
  assert.deepEqual(statesFor(built.entries, "bambu"), [4, 1, 2],
                   "1 and 4 change places in one pass (identity would be [1,4,2])");
});

await ok("many source colours may map onto one filament", () => {
  const parsed = project.readProject(source(FIVE));
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu", mapping: { 4: 2, 5: 2 } });
  assert.deepEqual(statesFor(built.entries, "bambu"), [1, 2, 2, 2]);
});

await ok("a source colour outside the palette is refused, not written", () => {
  const parsed = project.readProject(source({ colours: ["#FFFFFF", "#000000"],
                                              types: ["PLA", "PLA"], codes: ["6C"] }));
  assert.throws(() => project.convertProject(parsed, 1, null, { target: "bambu" }),
                /palette (does not describe|describes)/);
});

/* ---------- arranging slots: every colour keeps its appearance ---------- */

// The four colours the user reported, in the order their project lists them:
// green in filament 1, black in 2, white in 3, grey in 4.  Codes are
// "4" -> state 1, "8" -> state 2, "0C" -> state 3, plus one unpainted facet that
// prints in the part's own default filament.
const USER = {
  colours: ["#3F8E43", "#000000", "#FFFFFF", "#8E9089"],
  types: ["PLA", "PETG", "ABS", "TPU"],
  codes: ["4", "8", "0C", ""],
  base: 1,
};

/** The slot colours an archive declares, whatever the target keeps them in. */
function paletteOf(entries, target) {
  if (target === "bambu") {
    const model = memberText(entries, project.MODEL_FILE);
    return [...model.matchAll(/<m:color color="#([0-9A-F]{6,8})"/g)]
      .map((match) => `#${match[1].slice(0, 6)}`);
  }
  if (target === "prusa") {
    const spec = JSON.parse(memberText(entries,
                                       "Metadata/Prusa_Slicer_full_spectrum.json"));
    return spec.physical_extruders.map((entry) => entry.color);
  }
  return configOf(entries).filament_colour.map((value) => value.slice(0, 7));
}

/** The same, for the material of each slot. */
function slotTypesOf(entries, target) {
  if (target === "prusa") {
    const spec = JSON.parse(memberText(entries,
                                       "Metadata/Prusa_Slicer_full_spectrum.json"));
    return spec.physical_extruders.map((entry) => entry.type);
  }
  return configOf(entries).filament_type;
}

const MOVE_GREEN_TO_3 = { 1: 3, 2: 2, 3: 1, 4: 4 };

await ok("the reported four colours move green to filament 3 and keep every colour",
         () => {
  const parsed = project.readProject(source(USER));
  const built = project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: MOVE_GREEN_TO_3,
  });
  assert.deepEqual(built.problems, []);
  const cfg = configOf(built.entries);
  // Slot 1 now holds the white that was in 3, slot 3 holds the green that was in
  // 1, and black and grey never moved.
  assert.deepEqual(cfg.filament_colour,
                   ["#FFFFFFFF", "#000000FF", "#3F8E43FF", "#8E9089FF"],
                   "the palette is written in slot order");
  assert.deepEqual(paletteOf(built.entries, "snapmaker"),
                   ["#FFFFFF", "#000000", "#3F8E43", "#8E9089"]);
  assert.deepEqual(cfg.extruder_colour, ["#FFFFFF", "#000000", "#3F8E43", "#8E9089"]);
  // Black stays in 2, which is the one thing the user asked for by name.
  assert.equal(paletteOf(built.entries, "snapmaker")[1], "#000000");
  assert.equal(cfg.filament_colour[1], "#000000FF");
  // The paint names the slot the colour moved to, so the printed appearance is
  // exactly the source's: green facets in 3, black in 2, white in 1.
  assert.deepEqual(statesOf(built.entries), [3, 2, 1]);
  const settings = decoder.decode(built.entries.get("Metadata/model_settings.config"));
  assert.ok(settings.includes('key="extruder" value="3"'),
            "the unpainted facet follows its own colour to the new slot");
});

await ok("the material type travels with its colour, not with the slot number", () => {
  const parsed = project.readProject(source(USER));
  const built = project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: MOVE_GREEN_TO_3,
  });
  assert.deepEqual(slotTypesOf(built.entries, "snapmaker"),
                   ["ABS", "PETG", "PLA", "TPU"]);
});

await ok("arranging slots writes the same arrangement to every target", () => {
  const parsed = project.readProject(source(USER));
  const expected = ["#FFFFFF", "#000000", "#3F8E43", "#8E9089"];
  for (const target of ["snapmaker", "bambu", "orca", "prusa"]) {
    const built = project.convertProject(parsed, 1, null, {
      target, assignmentMode: "slots", mapping: MOVE_GREEN_TO_3,
    });
    assert.deepEqual(built.problems, [], `${target}: ${built.problems.join("; ")}`);
    assert.deepEqual(paletteOf(built.entries, target), expected, target);
    // The printer-agnostic model writes every facet's colour, so it also carries
    // the unpainted facet, whose own default filament moved to 3 with the green.
    assert.deepEqual(statesFor(built.entries, target),
                     target === "bambu" ? [3, 2, 1, 3] : [3, 2, 1], target);
  }
});

await ok("an arranged slot export says in its metadata that it is not a repaint",
         () => {
  const parsed = project.readProject(source(USER));
  const arranged = project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: MOVE_GREEN_TO_3,
  });
  assert.ok(memberText(arranged.entries, project.MODEL_FILE)
    .includes('<metadata name="Description">Filament slots rearranged: every colour '
      + "keeps its own appearance"),
            "the saved file says which kind of assignment wrote it");
  // An identity arrangement, and every repaint, write the bytes they always did.
  const identity = project.convertProject(parsed, 1, null,
                                          { target: "snapmaker", assignmentMode: "slots" });
  assert.equal(memberText(identity.entries, project.MODEL_FILE).includes("Description"),
               false);
});

await ok("a chained arrangement still prints every colour its own colour", () => {
  const parsed = project.readProject(source(USER));
  // 1 -> 2 -> 3 -> 1 is one permutation, and every facet must come out in the
  // colour it was painted with.
  const built = project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: { 1: 2, 2: 3, 3: 1, 4: 4 },
  });
  assert.deepEqual(paletteOf(built.entries, "snapmaker"),
                   ["#FFFFFF", "#3F8E43", "#000000", "#8E9089"]);
  assert.deepEqual(statesOf(built.entries), [2, 3, 1], "state n prints colour n");
});

await ok("two slots with the same hex stay two slots through a move", () => {
  const twin = { ...USER, colours: ["#3F8E43", "#3F8E43", "#FFFFFF", "#000000"] };
  const parsed = project.readProject(source(twin));
  const built = project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: { 1: 2, 2: 1, 3: 3, 4: 4 },
  });
  assert.equal(paletteOf(built.entries, "snapmaker").length, 4,
               "an identical colour is still its own slot");
  assert.deepEqual(statesOf(built.entries), [2, 1, 3],
                   "the two identical colours swap rather than merge");
});

await ok("a larger palette arranges with every filament kept", () => {
  const six = { ...FIVE, types: ["PLA", "PETG", "ABS", "TPU", "PA"] };
  const parsed = project.readProject(source(six));
  const rule = { 1: 4, 2: 1, 3: 5, 4: 2, 5: 3 };
  const built = project.convertProject(parsed, 1, null,
                                       { target: "bambu", assignmentMode: "slots",
                                         mapping: rule });
  const palette = paletteOf(built.entries, "bambu");
  assert.equal(palette.length, 5);
  for (let source = 1; source <= 5; source += 1) {
    assert.equal(palette[rule[source] - 1], FIVE.colours[source - 1],
                 `colour ${source} still prints its own colour`);
  }
  assert.deepEqual(statesFor(built.entries, "bambu"), [4, 2, 3, 1],
                   "1 -> 4, 4 -> 2, 5 -> 3, 2 -> 1");
});

await ok("a split paint tree and a default part both follow the arrangement", () => {
  const parsed = project.readProject(source({ ...USER, base: 3, codes: ["", SPLIT] }));
  const built = project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: MOVE_GREEN_TO_3,
  });
  // The split's leaves are state 3 (the white that moves to filament 1) and 0
  // (the facet's own default, the part's filament 3, which also moves to 1).
  assert.deepEqual(paint.walkStates(paint.decode(
    /paint_color="([0-9A-Fa-f]+)"/.exec(allModelText(built.entries))[1])), [1, 0],
                   "leaf 3 follows white to filament 1; leaf 0 waits for the part's default");
  const settings = decoder.decode(built.entries.get("Metadata/model_settings.config"));
  assert.ok(settings.includes('key="extruder" value="1"'),
            "the part's own default filament is rewritten to the slot white moved to");
  // The printer-agnostic Bambu model materialises the leaves as real triangles,
  // and both of them resolve to that same white.
  const standard = project.convertProject(parsed, 1, null, {
    target: "bambu", assignmentMode: "slots", mapping: MOVE_GREEN_TO_3,
  });
  assert.deepEqual(standardStatesOf(standard.entries), [1, 1, 1],
                   "leaf 3, the split's default leaf and the unpainted facet all "
                   + "print the white that moved to filament 1");
});

await ok("a destination that cannot be a slot arrangement is refused", () => {
  const parsed = project.readProject(source(USER));
  // Explicitly confirmed by the user as a refusal: nothing may be merged here.
  assert.throws(() => project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: { 1: 2 },
  }), /both ask for filament 2/, "two colours sent to one slot");
  assert.throws(() => project.convertProject(parsed, 1, null, {
    target: "snapmaker", assignmentMode: "slots", mapping: { 1: 9 },
  }), /outside the 4/, "a destination the file cannot describe");
});

await ok("repainting keeps its many-to-one behaviour and its old bytes", () => {
  const parsed = project.readProject(source(FIVE));
  const mapping = { 4: 2, 5: 2 };
  const unnamed = project.convertProject(parsed, 1, null, { target: "bambu", mapping });
  const named = project.convertProject(parsed, 1, null,
                                       { target: "bambu", mapping,
                                         assignmentMode: "repaint" });
  assert.deepEqual(statesFor(unnamed.entries, "bambu"), [1, 2, 2, 2],
                   "three source colours print as two");
  assert.deepEqual(paletteOf(named.entries, "bambu"), FIVE.colours,
                   "a repaint writes the palette it read");
  assert.deepEqual([...named.entries.keys()], [...unnamed.entries.keys()]);
  // A fresh p:UUID is the one thing that differs between any two writes of the
  // same file, so the documents are compared with those identifiers normalised.
  const stripIds = (bytes) => decoder.decode(bytes)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "id");
  for (const [name, data] of unnamed.entries) {
    assert.equal(stripIds(named.entries.get(name)), stripIds(data),
                 `${name} is exactly what an unset mode wrote`);
  }
  // The same map under "slots" is a different file, because it is a refusal.
  assert.throws(() => project.convertProject(parsed, 1, null, {
    target: "bambu", mapping, assignmentMode: "slots",
  }), /both ask for filament 2/);
});

await ok("a part whose default extruder is outside the palette is refused", () => {
  const parsed = project.readProject(source({ colours: ["#FFFFFF", "#000000"],
                                              types: ["PLA", "PLA"], codes: ["4"],
                                              base: 7 }));
  assert.throws(() => project.convertProject(parsed, 1, null, { target: "bambu" }),
                /prints in filament 7/,
                "filament 1 must not be substituted for an unreadable base");
});

/* ---------- incoming virtual blends are refused, not flattened ---------- */

const BAMBU_BLEND = () => {
  const entries = source(FIVE);
  const cfg = JSON.parse(decoder.decode(entries.get("Metadata/project_settings.config")));
  cfg.filament_is_mixed = ["0", "0", "0", "0", "1"];
  cfg.filament_mixed_components = ["", "", "", "", "1,2"];
  entries.set("Metadata/project_settings.config", encoder.encode(JSON.stringify(cfg)));
  return entries;
};

const SNAPMAKER_BLEND = () => {
  const entries = source(FIVE);
  const cfg = JSON.parse(decoder.decode(entries.get("Metadata/project_settings.config")));
  cfg.mixed_filament_definitions = [
    "1,2,0,0,50,0,g,w,m2,z0,xa0,xb0,d1,o1,u1",     // a tombstoned auto pair
    "1,3,1,1,40,0,g,w,m2,z0,xa0,xb0,d0,o0,u2",     // a real recipe
  ].join(";");
  entries.set("Metadata/project_settings.config", encoder.encode(JSON.stringify(cfg)));
  return entries;
};

const PRUSA_BLEND = () => {
  const entries = source(FIVE);
  entries.delete("Metadata/project_settings.config");
  entries.set("Metadata/Slic3r_PE_model.config", encoder.encode(
    '<config><object id="1"><metadata type="object" key="name" value="Part"/>'
    + '<volume firstid="0" lastid="2"><metadata type="volume" key="name" value="body"/>'
    + "</volume></object></config>"));
  entries.set("Metadata/Prusa_Slicer_full_spectrum.json", encoder.encode(JSON.stringify({
    version: 1,
    physical_extruders: FIVE.colours.map((colour, index) => ({ id: index + 1,
                                                               color: colour })),
    virtual_extruders: [{ id: 6, color: "#123456",
                          components: [{ extruder: 1, ratio: 0.5 },
                                       { extruder: 2, ratio: 0.5 }] }],
  })));
  return entries;
};

for (const [label, build] of [["Bambu mixed arrays", BAMBU_BLEND],
                              ["Snapmaker mixed_filament_definitions", SNAPMAKER_BLEND],
                              ["Prusa virtual_extruders", PRUSA_BLEND]]) {
  await ok(`an incoming ${label} project is refused, not flattened`, () => {
    const entries = build();
    const parsed = project.readProject(entries);
    assert.equal(parsed.mixtures.present, true,
                 "the blend is detected whichever palette source wins");
    let built = null;
    assert.throws(() => {
      built = project.convertProject(parsed, 1, null, { target: "bambu" });
    }, /blends/);
    assert.equal(built, null, "no archive is produced");
  });
}

await ok("a profile that only lists tombstoned mixture rows still converts", () => {
  const entries = source(FIVE);
  const cfg = JSON.parse(decoder.decode(entries.get("Metadata/project_settings.config")));
  cfg.mixed_filament_definitions = "1,2,0,0,50,0,g,w,m2,z0,xa0,xb0,d1,o1,u1;"
    + "1,3,0,0,50,0,g,w,m2,z0,xa0,xb0,d1,o1,u2";
  entries.set("Metadata/project_settings.config", encoder.encode(JSON.stringify(cfg)));
  const parsed = project.readProject(entries);
  assert.equal(parsed.mixtures.present, false, "disabled rows are not a blend");
  const built = project.convertProject(parsed, 1, null, { target: "bambu" });
  assert.deepEqual(built.problems, []);
});

/* ---------- a real 4×4 roundtrip on a small fixture ---------- */

for (const from of ["bambu", "snapmaker", "prusa"]) {
  for (const to of ["snapmaker", "bambu", "orca", "prusa"]) {
    await ok(`roundtrip ${from} → ${to} keeps palette, paint and placement`, async () => {
      const first = project.readProject(source(FIVE));
      const once = project.convertProject(first, 1, null, { target: from });
      const reread = project.readProject(once.entries);
      assert.equal(reread.paletteCount, 5, "the palette survives the first write");
      const twice = project.convertProject(reread, reread.plates[0].id, null,
                                           { target: to });
      assert.deepEqual(twice.problems, []);
      const standardEdge = from === "bambu" || to === "bambu";
      assert.deepEqual(statesFor(twice.entries, to),
                       standardEdge ? [1, 4, 5, 2] : [1, 4, 5],
                       "the same leaves come out the far side in the same order");
      assert.ok(allModelText(twice.entries).includes("1 0 0 0 1 0 0 0 1 10 20 30"),
                "the placement survives the second write");
      const cfg = configOf(twice.entries);
      if (cfg) assert.equal(cfg.filament_colour.length, 5);
      if (to === "bambu") {
        assert.equal(twice.entries.has("Metadata/project_settings.config"), false);
        assert.equal(colourCountOf(memberText(twice.entries, project.MODEL_FILE)), 5);
      }
      if (to === "prusa") {
        assert.ok(twice.entries.has("Metadata/Prusa_Slicer_full_spectrum.json"));
        assert.ok(!twice.entries.has("Metadata/Slic3r_PE.config"),
                  "no Prusa print config that would override the user's preset");
      }
    });
  }
}

await ok("a blend export to OrcaSlicer is refused with a reason", () => {
  const parsed = project.readProject(source(FIVE));
  assert.throws(() => project.exportProject(parsed, 1, null, {
    target: "orca",
    physical: [{ color: "#FFFFFF", type: "PLA" }, { color: "#000000", type: "PLA" },
               { color: "#FF0000", type: "PLA" }, { color: "#00FF00", type: "PLA" }],
    recipes: [{ a: 1, b: 2, percent: 50 }],
    mapping: {},
  }), /OrcaSlicer/);
});

await ok("no portable Bambu-family export claims printer hardware", () => {
  const parsed = project.readProject(source(FIVE));
  // The pure-converter Bambu route carries no project settings at all: nothing to
  // leak a nozzle list, a printer or a process into.
  const plain = project.convertProject(parsed, 1, null, { target: "bambu" });
  assert.equal(plain.entries.has("Metadata/project_settings.config"), false,
               "a printer-agnostic model must carry no project settings");
  for (const target of ["orca"]) {
    const built = project.convertProject(parsed, 1, null, { target });
    const cfg = configOf(built.entries);
    assert.equal(cfg.filament_colour.length, 5, "five logical colours");
    assert.ok(!("nozzle_diameter" in cfg),
              `${target} must not infer one nozzle per logical colour`);
    assert.ok(!("printer_settings_id" in cfg) && !("print_settings_id" in cfg),
              `${target} must not carry a printer profile`);
  }
  // The recolour path writes the same portable shape: Bambu Studio's GUI check
  // rejects a multi-entry nozzle list without an extruder type, so a blend
  // export must not carry one either.
  const recolour = project.exportProject(parsed, 1, null, {
    target: "bambu",
    physical: [{ color: "#FFFFFF", type: "PLA" }, { color: "#000000", type: "PLA" },
               { color: "#FF9500", type: "PLA" }, { color: "#FF0080", type: "PLA" }],
    recipes: [{ a: 1, b: 2, percent: 50 }],
    mapping: { 1: 1 },
  });
  const mixed = configOf(recolour.entries);
  assert.equal(mixed.filament_is_mixed.length, 5, "four reels plus one recipe");
  assert.ok(!("nozzle_diameter" in mixed),
            "a mixed export must not claim a nozzle per filament");
});

/* ---------- the one real-file run ---------- */

await ok("a real five-colour Prusa alien converts to Bambu with every filament",
         async () => {
  const path = "C:/Users/rende/Desktop/They live alien_5 colors.3mf";
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    console.log("      (real alien not on this machine; structural checks cover it)");
    return;
  }
  const entries = await readZip(new Uint8Array(bytes));
  const parsed = project.readProject(entries);
  assert.equal(parsed.paletteCount, 8, "the file lists eight profile slots");
  assert.equal(parsed.mixtures.present, false, "it is a plain painted file");
  const built = project.convertProject(parsed, parsed.plates[0].id, null,
                                       { target: "bambu", mapping: { 1: 3, 3: 1 } });
  assert.equal(built.entries.has("Metadata/project_settings.config"), false,
               "the agnostic model carries no project settings");
  assert.equal(colourCountOf(memberText(built.entries, project.MODEL_FILE)), 8,
               "all eight source colours are declared");
  const text = allModelText(built.entries);
  assert.ok(text.includes("pid="), "the colours are written as colour references");
  // No silent drop: the output must describe the same number of triangles as the
  // source, and every source attribute must still parse on the far side.
  const count = (value) => (value.match(/<triangle\b/g) || []).length;
  // Flat paint keeps the mesh exactly; a subdivided colour facet becomes its
  // real leaf triangles, so the count grows by exactly the extra leaves.
  let extra = 0;
  for (const [name, data] of entries) {
    if (!name.endsWith(".model")) continue;
    for (const match of decoder.decode(data)
      .matchAll(/(?:slic3rpe:)?(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/g)) {
      const node = paint.decode(match[1]);
      if (node.kind === "leaf") continue;
      extra += paint.walkStates(node).length - 1;
    }
  }
  assert.equal(count(text), count(allModelText(entries)) + extra,
               `the mesh is preserved, plus ${extra} materialised colour leaf(s)`);
  for (const match of text.matchAll(/paint_color="([0-9A-Fa-f]+)"/g)) {
    paint.decode(match[1]);          // throws if the grammar does not hold
  }
  console.log(`      real alien: 8 filaments, ${built.entries.size} members, `
    + `${count(text).toLocaleString()} triangles, paint rewritten`);
});

if (failures.length) {
  console.error(`\n${failures.length} conversion check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`convert ok: ${checks} checks`);
}
