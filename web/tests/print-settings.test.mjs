// The U1 print-settings transfer: what a Snapmaker export carries from the source,
// what it refuses to carry, and the support decision the page's controls take.
//
// Run from the project root:  node web/tests/print-settings.test.mjs
//
// The oracle is the desktop converter (u1convert.py), whose decisions this browser
// code has to match; evidence/pumpkin-oracle-U1.3mf is one run of it on the real
// pumpkin model, kept beside the phase report.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { readZip } from "../zip.js";
import { BASE_SETTINGS } from "../base_settings.js";
import * as project from "../shared/project.js";
import { CARRY_KEYS, appliedSettings, supportOf, planningAllowance, transferSettings } from "../shared/printSettings.js";
import { ConvertSession } from "../shared/convertSession.js";

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

const PUMPKIN = "C:/Users/rende/Desktop/Flippin Pumpkin flat bottom painted.3mf";
const ORACLE = "docs/agent-work/restore-u1-settings/evidence/pumpkin-oracle-U1.3mf";

/* ------------------------------------------------------------------ fixtures */

/** A Bambu-shaped project: palette and print settings in the project config, one
 *  painted object whose facets name their colours. */
function bambuSource({ settings = {}, painted = false }) {
  const model = '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"'
    + ' unit="millimeter"><resources>'
    + '<object id="2" type="model"><mesh><vertices>'
    + '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>'
    + '<vertex x="0" y="1" z="0"/></vertices><triangles>'
    + '<triangle v1="0" v2="1" v3="2" paint_color="4"'
    + (painted ? ' paint_supports="4"' : "") + "/>"
    + "</triangles></mesh></object>"
    + '<object id="1" type="model"><components>'
    + '<component objectid="2"/></components></object>'
    + "</resources>"
    + '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30"/></build></model>';
  const config = '<config><object id="1"><metadata key="name" value="Part"/>'
    + '<metadata key="extruder" value="2"/>'
    + '<part id="2" subtype="normal_part"><metadata key="name" value="body"/>'
    + '<metadata key="extruder" value="2"/></part></object>'
    + '<plate><metadata key="plater_id" value="1"/>'
    + '<model_instance><metadata key="object_id" value="1"/></model_instance></plate>'
    + "</config>";
  const cfg = {
    filament_colour: ["#0080C0", "#FF0000", "#FFFFFF", "#000000"],
    filament_type: ["PLA", "PLA", "PLA", "PLA"],
    ...settings,
  };
  return new Map([
    ["3D/3dmodel.model", encoder.encode(model)],
    ["Metadata/project_settings.config", encoder.encode(JSON.stringify(cfg))],
    ["Metadata/model_settings.config", encoder.encode(config)],
  ]);
}

/** A PrusaSlicer-shaped project: the print config is a commented-out INI, and the
 *  paint uses the `slic3rpe:` spelling. */
function prusaSource(settings = {}) {
  const model = '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"'
    + ' unit="millimeter"><resources>'
    + '<object id="1" type="model"><mesh><vertices>'
    + '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>'
    + '<vertex x="0" y="1" z="0"/></vertices><triangles>'
    + '<triangle v1="0" v2="1" v3="2" paint_color="8"/>'
    + "</triangles></mesh></object></resources>"
    + '<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30"/></build></model>';
  const print = Object.entries({
    extruder_colour: "#0080C0;#FF0000;#FFFFFF;#000000",
    filament_type: "PLA;PLA;PLA;PLA",
    ...settings,
  }).map(([key, value]) => `${key} = ${value}`).join("\n");
  const modelConfig = '<config><object id="1"><metadata type="object" key="name"'
    + ' value="Part.3mf"/><volume firstid="0" lastid="0">'
    + '<metadata type="volume" key="name" value="body"/></volume></object></config>';
  return new Map([
    ["3D/3dmodel.model", encoder.encode(model)],
    ["Metadata/Slic3r_PE.config", encoder.encode(print)],
    ["Metadata/Slic3r_PE_model.config", encoder.encode(modelConfig)],
  ]);
}

/** Convert a source to a Snapmaker project and read its settings back. */
function u1ConfigOf(entries, options = {}) {
  const parsed = project.readProject(entries);
  const built = project.convertProject(parsed, 1, null,
                                       { target: "snapmaker", ...options });
  const cfg = JSON.parse(decoder.decode(built.entries.get(project.SRC_BBL_PROJECT)));
  return { parsed, built, cfg };
}

/** One `.model` member holding a painted object *and* a clean one, with a plate
 *  for each: the support scan has to follow the plate, not the member. */
function sharedMemberTwoPlates({ supportPaint = ' paint_supports="4"' } = {}) {
  const mesh = (id, extra) => `<object id="${id}" type="model"><mesh><vertices>`
    + '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>'
    + '<vertex x="0" y="1" z="0"/></vertices><triangles>'
    + `<triangle v1="0" v2="1" v3="2" paint_color="4"${extra}/>`
    + "</triangles></mesh></object>";
  const model = '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"'
    + ' unit="millimeter"><resources>'
    + mesh(2, supportPaint)
    + mesh(3, "")
    + '<object id="1" type="model"><components><component objectid="2"/></components>'
    + "</object>"
    + '<object id="4" type="model"><components><component objectid="3"/></components>'
    + "</object></resources><build>"
    + '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>'
    + '<item objectid="4" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>'
    + "</build></model>";
  const config = "<config>"
    + '<object id="1"><metadata key="name" value="Painted"/>'
    + '<metadata key="extruder" value="1"/>'
    + '<part id="2" subtype="normal_part"><metadata key="name" value="body"/>'
    + '<metadata key="extruder" value="1"/></part></object>'
    + '<object id="4"><metadata key="name" value="Clean"/>'
    + '<metadata key="extruder" value="1"/>'
    + '<part id="3" subtype="normal_part"><metadata key="name" value="body"/>'
    + '<metadata key="extruder" value="1"/></part></object>'
    + '<plate><metadata key="plater_id" value="1"/>'
    + '<model_instance><metadata key="object_id" value="1"/>'
    + '<metadata key="instance_id" value="0"/></model_instance></plate>'
    + '<plate><metadata key="plater_id" value="2"/>'
    + '<model_instance><metadata key="object_id" value="4"/>'
    + '<metadata key="instance_id" value="0"/></model_instance></plate>'
    + "</config>";
  return new Map([
    ["3D/3dmodel.model", encoder.encode(model)],
    ["Metadata/project_settings.config", encoder.encode(JSON.stringify({
      filament_colour: ["#0080C0", "#FF0000", "#FFFFFF", "#000000"],
      filament_type: ["PLA", "PLA", "PLA", "PLA"],
      enable_support: "0",
    }))],
    ["Metadata/model_settings.config", encoder.encode(config)],
  ]);
}

/* ------------------------------------------------------------- the allowlist */

await ok("only reviewed keys with acceptable values are offered to the user", () => {
  const applied = Object.fromEntries(appliedSettings({
    layer_height: "0.28",
    first_layer_height: "0.3",
    perimeters: "4",
    top_solid_layers: "5",
    fill_density: "20%",
    fill_pattern: "grid",
    ironing_type: "top",
    // An "auto" -1 and an enum this Orca does not know: dropped rather than carried
    // into a project Orca would warn about or refuse.
    resolution: "-1",
    ironing_pattern: "unknown-pattern",
  }).map(({ key, value }) => [key, value]));
  assert.equal(applied.layer_height, "0.28", "a number is carried");
  assert.equal(applied.initial_layer_print_height, "0.3",
               "the Prusa spelling of the first-layer height is carried");
  assert.equal(applied.wall_loops, "4", "perimeters carry as wall_loops");
  assert.equal(applied.top_shell_layers, "5",
               "top_solid_layers carry as top_shell_layers");
  assert.equal(applied.sparse_infill_density, "20%", "fill_density carries");
  assert.equal(applied.sparse_infill_pattern, "grid", "fill_pattern carries");
  assert.equal(applied.ironing_type, "top", "a reviewed enum carries");
  assert.equal(applied.resolution, undefined, "a negative number is refused");
  assert.equal(applied.ironing_pattern, undefined,
               "an enum value this Orca does not know is refused");
  assert.equal(appliedSettings({ layer_height: "0.28" }, false).length, 0,
               "carrying switched off contributes nothing");
  assert.ok(CARRY_KEYS.includes("layer_height"), "the reviewed allowlist is used");
  // A file that states the current Orca name outright is judged on that value: the
  // PrusaSlicer spelling is a fallback, never a way to smuggle in a value the
  // direct key already gave and this Orca does not accept.
  const both = Object.fromEntries(appliedSettings({
    sparse_infill_pattern: "wet noodle", fill_pattern: "grid",
  }).map(({ key, value }) => [key, value]));
  assert.equal(both.sparse_infill_pattern, undefined,
               "an unknown direct value is not replaced by the alias");
});

/* ------------------------------------------ carrying onto the U1 profile --- */

await ok("a Bambu source carries the allowlisted print settings, not its machine", () => {
  const { cfg, built } = u1ConfigOf(bambuSource({ settings: {
    layer_height: "0.28",
    wall_loops: "3",
    sparse_infill_density: "25%",
    sparse_infill_pattern: "gyroid",
    printer_settings_id: "Bambu Lab X1 Carbon 0.4 nozzle",
    nozzle_temperature: ["220"],
    machine_start_gcode: "G28 ; the source's own start",
    printable_area: ["0x0", "256x0", "256x256", "0x256"],
    enable_support: "1",
    support_type: "tree(auto)",
    support_threshold_angle: "45",
  } }));
  assert.equal(cfg.layer_height, "0.28", "the layer height travels");
  assert.equal(cfg.wall_loops, "3", "the shell count travels");
  assert.equal(cfg.sparse_infill_density, "25%", "the infill density travels");
  assert.equal(cfg.sparse_infill_pattern, "gyroid", "the infill pattern travels");
  assert.equal(cfg.printer_settings_id, BASE_SETTINGS.printer_settings_id,
               "the printer stays the U1");
  assert.notEqual(cfg.machine_start_gcode, "G28 ; the source's own start",
                  "the source's start g-code is not copied");
  assert.deepEqual(cfg.printable_area, BASE_SETTINGS.printable_area,
                   "the source's bed is not copied");
  assert.deepEqual(cfg.nozzle_temperature, BASE_SETTINGS.nozzle_temperature,
                   "the source's temperature is not copied");
  assert.ok(built.settings.carried.includes("layer_height"),
            "the export reports what it carried");
  assert.equal(built.settings.carry, true, "carrying is on by default");
});

await ok("a PrusaSlicer source carries through its own spelling of each key", () => {
  const { cfg } = u1ConfigOf(prusaSource({
    layer_height: "0.2",
    first_layer_height: "0.2",
    perimeters: "2",
    top_solid_layers: "5",
    top_solid_min_thickness: "0.7",
    fill_density: "15%",
    fill_pattern: "grid",
    brim_width: "0",
    elefant_foot_compensation: "0.2",
  }));
  assert.equal(cfg.layer_height, "0.2", "the layer height travels");
  assert.equal(cfg.initial_layer_print_height, "0.2",
               "first_layer_height becomes the Orca name");
  assert.equal(cfg.wall_loops, "2", "perimeters becomes wall_loops");
  assert.equal(cfg.top_shell_layers, "5", "top_solid_layers becomes top_shell_layers");
  assert.equal(cfg.top_shell_thickness, "0.7",
               "top_solid_min_thickness becomes top_shell_thickness");
  assert.equal(cfg.sparse_infill_density, "15%", "fill_density becomes the Orca name");
  assert.equal(cfg.sparse_infill_pattern, "grid", "fill_pattern becomes the Orca name");
  assert.equal(cfg.brim_width, "0", "a zero is a value, not a missing one");
  assert.equal(cfg.elefant_foot_compensation, "0.2", "the elephant foot carries");
});

await ok("carrying switched off leaves the U1 profile's own values", () => {
  const { cfg, built } = u1ConfigOf(prusaSource({
    layer_height: "0.3", perimeters: "6", fill_density: "60%",
    support_material: "1", support_material_style: "organic",
    support_material_auto: "0", support_material_threshold: "40",
  }), { carrySettings: false });
  assert.equal(cfg.layer_height, BASE_SETTINGS.layer_height,
               "the layer height is the profile's own");
  assert.equal(cfg.wall_loops, BASE_SETTINGS.wall_loops, "so is the shell count");
  assert.equal(cfg.sparse_infill_density, BASE_SETTINGS.sparse_infill_density,
               "so is the infill density");
  assert.deepEqual(built.settings.carried, [], "nothing is reported as carried");
  // The support decision is its own control and is not switched off with it.
  assert.equal(cfg.enable_support, "1", "supports still follow the source");
});

/* ----------------------------------------------------- the support decision */

await ok("supports follow the source: Prusa's organic tree, manual, at 40 degrees", () => {
  const source = {
    support_material: "1", support_material_style: "organic",
    support_material_auto: "0", support_material_threshold: "40",
  };
  assert.deepEqual(supportOf(source),
                   { enabled: true, type: "tree(manual)", angle: 40 },
                   "the decision is read the way the legacy converter read it");
  const { cfg, built } = u1ConfigOf(prusaSource({
    layer_height: "0.2", support_material: "1", support_material_style: "organic",
    support_material_auto: "0", support_material_threshold: "40",
  }));
  assert.equal(cfg.enable_support, "1", "supports are enabled");
  assert.equal(cfg.support_type, "tree(manual)", "the source's type is written");
  assert.equal(cfg.support_threshold_angle, "40", "the source's angle is written");
  assert.equal(cfg.support_style, "tree_organic",
               "Prusa organic style is translated to Orca tree_organic");
  assert.match(built.settings.support, /tree\(manual\) at 40 degrees/,
               "the export says what it wrote");
});

await ok("a support control overrides the source, and Off is honest about enforcers", () => {
  const off = u1ConfigOf(prusaSource({ support_material: "0" }));
  assert.equal(off.cfg.enable_support, "0", "a source with supports off keeps them off");

  const forcedOn = u1ConfigOf(prusaSource({ support_material: "0" }),
                              { supportMode: "on" });
  assert.equal(forcedOn.cfg.enable_support, "1", "the control can switch them on");
  assert.match(forcedOn.built.settings.support, /profile defaults/,
               "switching on says the profile's own type is used");

  const forcedOff = u1ConfigOf(bambuSource({
    settings: { enable_support: "1", support_type: "normal(auto)" },
  }), { supportMode: "off" });
  assert.equal(forcedOff.cfg.enable_support, "0", "the control can switch them off");
  assert.match(forcedOff.built.settings.support, /asked for it/,
               "switching off says it was asked for");

  // Painted enforcers are meaningless with support off, and Orca refuses to let
  // that contradiction pass: say so rather than quietly writing a file that warns.
  const painted = u1ConfigOf(bambuSource({
    painted: true,
    settings: { enable_support: "1", support_type: "normal(auto)" },
  }), { supportMode: "off" });
  assert.match(painted.built.settings.support, /painted support enforcers/,
               "the enforcer contradiction is named");
  assert.equal(painted.built.settings.supportsPainted, true,
               "the painted enforcers were detected");
});

await ok("a source with supports off but painted enforcers is enabled, as before", () => {
  const { cfg, built } = u1ConfigOf(bambuSource({
    painted: true,
    settings: { enable_support: "0", support_type: "tree(auto)" },
  }));
  assert.equal(cfg.enable_support, "1",
               "painted enforcers are meaningless without support, so it is enabled");
  assert.match(built.settings.support, /carries painted support enforcers/,
               "the reason is reported");
});

await ok("a source that states nothing gets no invented support decision", () => {
  const { cfg, built } = u1ConfigOf(bambuSource({}));
  assert.equal(cfg.enable_support, BASE_SETTINGS.enable_support,
               "the profile's own value stays");
  assert.match(built.settings.support, /no support setting/,
               "the export says it left the profile alone");
  assert.deepEqual(built.settings.carried, [], "and carried nothing");
});

/* ------------------------------------------------- the Snapmaker project ---- */

await ok("painted enforcers are judged per selected object, not per member", () => {
  const entries = sharedMemberTwoPlates();
  const parsed = project.readProject(entries);
  assert.equal(parsed.plates.length, 2, "the fixture has two plates");
  assert.equal(project.supportPaintPresent(parsed, 1, null), true,
               "plate 1 selects the painted object");
  assert.equal(project.supportPaintPresent(parsed, 2, null), false,
               "plate 2 selects the clean object in the same .model member");

  // The unselected painted object must not switch supports on for the clean plate.
  const clean = project.convertProject(parsed, 2, null, { target: "snapmaker" });
  const cleanCfg = JSON.parse(decoder.decode(
    clean.entries.get(project.SRC_BBL_PROJECT)));
  assert.equal(clean.settings.supportsPainted, false,
               "the export reports the selection's own enforcers");
  assert.equal(cleanCfg.enable_support, BASE_SETTINGS.enable_support,
               "supports stay at the profile's value for the clean selection");
  assert.doesNotMatch(clean.settings.support, /painted support enforcers/,
                      "the note does not claim enforcers the selection does not have");

  const painted = project.convertProject(parsed, 1, null, { target: "snapmaker" });
  const paintedCfg = JSON.parse(decoder.decode(
    painted.entries.get(project.SRC_BBL_PROJECT)));
  assert.equal(painted.settings.supportsPainted, true,
               "the painted selection is recognised");
  assert.equal(paintedCfg.enable_support, "1",
               "and its enforcers enable supports, as the legacy converter did");

  // An attribute with no value is not paint.
  const empty = sharedMemberTwoPlates({ supportPaint: ' paint_supports=""' });
  const emptyParsed = project.readProject(empty);
  assert.equal(project.supportPaintPresent(emptyParsed, 1, null), false,
               "an empty support attribute is not an enforcer");
});

await ok("a U1 export is still a U1 project with every source filament", () => {
  const { cfg } = u1ConfigOf(bambuSource({
    settings: { layer_height: "0.28", wall_loops: "3" },
  }));
  assert.ok(cfg.printer_settings_id, "the U1 printer profile is written");
  assert.equal(cfg.filament_colour.length, 4, "every source filament keeps its slot");
  assert.deepEqual(cfg.nozzle_diameter, ["0.4", "0.4", "0.4", "0.4"],
                   "the U1 nozzle is written");
});

/* ---------------------------------------------- the session's own controls -- */

class FakeWorker {
  constructor() {
    this.converts = [];
  }

  async load() {
    return {
      meta: {
        kind: "bambu", title: "Part", colors: ["#0080C0", "#FF0000"],
        types: ["PLA", "PLA"], warnings: [], plates: [{ id: 1, name: "Plate 1" }],
        sourceSettings: { layer_height: "0.28" }, objectSettings: [],
      },
      summary: { triangles: 12, plate: { id: 1, name: "Plate 1", objects: 1 },
                 mixtures: [], bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
    };
  }

  async bounds() {
    return { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] };
  }

  async convert(plateId, objects, target, mapping, title, options) {
    this.converts.push({ target, options });
    return { bytes: new Uint8Array([1, 2, 3]), ms: 1, settings: { carry: true } };
  }

  dispose() {}
}

await ok("the page's controls are part of the export snapshot", async () => {
  const worker = new FakeWorker();
  const session = new ConvertSession(() => worker, {}, {
    create: () => "blob:stub", revoke: () => {},
  });
  const file = { name: "part.3mf", arrayBuffer: async () => new ArrayBuffer(8) };
  await session.load(file);
  assert.equal(session.carrySettings, true, "carrying starts on");
  assert.equal(session.supportMode, "auto", "supports start at the source's decision");
  const before = session.revision;
  assert.equal(session.setCarrySettings(false), true, "the control reports the change");
  assert.ok(session.revision > before, "a change invalidates in-flight work");
  session.setSupportMode("off");
  assert.equal(session.supportMode, "off", "the support mode is the session's");
  await session.convert("snapmaker", 1);
  const call = worker.converts[worker.converts.length - 1];
  assert.equal(call.options.carrySettings, false, "carry reaches the worker");
  assert.equal(call.options.supportMode, "off", "the support mode reaches the worker");
  assert.equal(call.target, "snapmaker", "the target is the U1");
  session.setSupportMode("nonsense");
  assert.equal(session.supportMode, "auto", "an unknown mode falls back to the source");
});

/** A worker whose conversion parks until the test releases it. */
class ParkingWorker extends FakeWorker {
  constructor() {
    super();
    this.waiters = [];
  }

  park() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  releaseAll() {
    const waiting = this.waiters;
    this.waiters = [];
    waiting.forEach((resolve) => resolve());
  }

  async convert(plateId, objects, target, mapping, title, options) {
    this.converts.push({ target, options });
    await this.park();
    return { bytes: new Uint8Array([1, 2, 3]), ms: 1, settings: { carry: true } };
  }
}

await ok("a control changed during an export drops the file that was already writing", async () => {
  const worker = new ParkingWorker();
  const published = [];
  const session = new ConvertSession(() => worker,
                                     { output: (entry) => published.push(entry) },
                                     { create: () => "blob:stub", revoke: () => {} });
  await session.load({ name: "part.3mf", arrayBuffer: async () => new ArrayBuffer(8) });
  const pending = session.convert("snapmaker", 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(worker.converts.length, 1, "the export started");
  session.setCarrySettings(false);          // the user changes their mind mid-export
  worker.releaseAll();
  assert.equal(await pending, null, "the older export publishes nothing");
  assert.equal(published.length, 0, "no download is offered for a superseded file");
});

/** A worker whose bounds answer describes the plate, enforcers and all. */
class PlateWorker extends FakeWorker {
  async load() {
    const reply = await super.load();
    reply.meta.plates = [{ id: 1, name: "Painted plate" },
                         { id: 2, name: "Clean plate" }];
    reply.summary.supportsPainted = true;      // what the first plate holds
    return reply;
  }

  async bounds(plateId) {
    return { bounds: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
             supportsPainted: Number(plateId) === 1 };
  }
}

await ok("a plate switch refreshes the selection's painted enforcers", async () => {
  const worker = new PlateWorker();
  let settingsCalls = 0;
  const session = new ConvertSession(() => worker,
                                     { settings: () => { settingsCalls += 1; } },
                                     { create: () => "blob:stub", revoke: () => {} });
  await session.load({ name: "part.3mf", arrayBuffer: async () => new ArrayBuffer(8) });
  assert.equal(session.state.supportsPainted, true,
               "the load reports the first plate's enforcers");
  const before = settingsCalls;
  session.setPlate(2);
  await session.refreshBounds();
  assert.equal(session.state.supportsPainted, false,
               "the clean plate replaces the flag rather than leaving it stale");
  assert.ok(settingsCalls > before,
            "the settings panel is re-synced for the plate in force");
  session.setPlate(1);
  await session.refreshBounds();
  assert.equal(session.state.supportsPainted, true,
               "and switching back reads the painted plate again");
});

await ok("a bounds reply without the flag leaves the load's value alone", async () => {
  const worker = new FakeWorker();
  worker.bounds = async () => ({ min: [0, 0, 0], max: [2, 2, 2], size: [2, 2, 2] });
  const session = new ConvertSession(() => worker, {}, {
    create: () => "blob:stub", revoke: () => {},
  });
  await session.load({ name: "part.3mf", arrayBuffer: async () => new ArrayBuffer(8) });
  session.state.supportsPainted = true;
  const bounds = await session.refreshBounds();
  assert.deepEqual(bounds.size, [2, 2, 2], "the older reply shape still installs bounds");
  assert.equal(session.state.supportsPainted, true,
               "an answer with no flag does not invent one");
});

/* ------------------------------- the real model, against the desktop's run -- */

await ok("the pumpkin carries exactly what the desktop converter carried", async () => {
  if (!existsSync(PUMPKIN)) {
    console.log(`      SKIP: ${PUMPKIN} is not on this machine`);
    return;
  }
  const entries = await readZip(new Uint8Array(readFileSync(PUMPKIN)));
  const { cfg, built } = u1ConfigOf(entries);
  // The decisions parity_check.mjs compares between the two converters, with the
  // values the desktop tool wrote for this file.
  const expected = {
    enable_support: "1",
    support_type: "tree(manual)",
    support_threshold_angle: "40",
    layer_height: "0.2",
    initial_layer_print_height: "0.2",
    wall_loops: "2",
    top_shell_layers: "5",
    top_shell_thickness: "0.7",
    bottom_shell_layers: "3",
    sparse_infill_density: "15%",
    sparse_infill_pattern: "grid",
    brim_width: "0",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(cfg[key], value, `${key} matches the desktop converter`);
  }
  if (existsSync(ORACLE)) {
    const oracle = JSON.parse(decoder.decode((await readZip(
      new Uint8Array(readFileSync(ORACLE)))).get("Metadata/project_settings.config")));
    for (const key of Object.keys(expected)) {
      assert.equal(cfg[key], oracle[key], `${key} matches the recorded oracle run`);
    }
  }
  assert.equal(cfg.filament_colour.length, 5,
               "the conversion keeps all five source filaments, unlike the four-reel "
               + "desktop tool");
  assert.ok(built.settings.carried.length >= 20,
            `the shell and infill settings come with it (${built.settings.carried.length})`);
  assert.equal(built.settings.supportsPainted, true,
               "the pumpkin's painted support enforcers were found");

  const off = u1ConfigOf(entries, { carrySettings: false });
  assert.equal(off.cfg.layer_height, BASE_SETTINGS.layer_height,
               "switching the carry off resets the print settings to the profile");
  assert.equal(off.cfg.support_type, "tree(manual)",
               "and leaves the support control to make its own decision");
});

await ok("support placement flags survive as explicit on and off values", () => {
  const flags = ["support_on_build_plate_only", "support_critical_regions_only",
                 "support_remove_small_overhang"];
  for (const value of ["0", "1"]) {
    const parsed = project.readProject(bambuSource({ settings: {
      enable_support: "1", support_type: "tree(auto)", support_threshold_angle: "30",
      ...Object.fromEntries(flags.map((key) => [key, value])),
    } }));
    const built = project.convertProject(parsed, 1, null, { target: "snapmaker" });
    const cfg = JSON.parse(decoder.decode(built.entries.get("Metadata/project_settings.config")));
    for (const key of flags) assert.equal(cfg[key], value, key);
    assert.equal(cfg.enable_support, "1");
    assert.equal(cfg.support_type, "tree(auto)");
    assert.equal(cfg.support_threshold_angle, "30");
    const off = project.convertProject(parsed, 1, null, { target: "snapmaker", carrySettings: false });
    const base = JSON.parse(decoder.decode(off.entries.get("Metadata/project_settings.config")));
    for (const key of flags) assert.equal(base[key], BASE_SETTINGS[key]);
  }
});

await ok("all four formats retain designer settings through every destination", () => {
  const original = project.readProject(bambuSource({ settings: {
    seam_position: "back", sparse_infill_density: "7%", sparse_infill_pattern: "gyroid",
    sparse_infill_anchor: "350%", sparse_infill_anchor_max: "17", wall_loops: "4",
    top_shell_layers: "6", bottom_shell_layers: "4", layer_height: "0.16",
    enable_support: "1", support_type: "tree(auto)", support_threshold_angle: "30",
    support_on_build_plate_only: "1", support_critical_regions_only: "1",
    support_remove_small_overhang: "0", raft_layers: "2", raft_expansion: "3",
  } }));
  const targets = ["snapmaker", "bambu", "orca", "prusa"];
  for (const from of targets) {
    const first = project.readProject(project.convertProject(original, 1, null,
      { target: from, preserveSourceSettings: true }).entries);
    for (const target of targets) {
      const result = project.readProject(project.convertProject(first, 1, null,
        { target, preserveSourceSettings: true }).entries);
      const own = [...result.meta.values()].find(o => o.settings)?.settings || {};
      const canonical = transferSettings({ ...(result.sourceSettings || {}), ...own }, "snapmaker").values;
      for (const [key, value] of Object.entries({ seam_position: "back", sparse_infill_density: "7%",
        sparse_infill_pattern: "gyroid", infill_anchor: "350%", infill_anchor_max: "17", wall_loops: "4",
        top_shell_layers: "6", bottom_shell_layers: "4", layer_height: "0.16",
        enable_support: "1", support_on_build_plate_only: "1", raft_layers: "2", raft_expansion: "3" })) {
        assert.equal(canonical[key], value, `${from} → ${target}: ${key}`);
      }
    }
  }
});

await ok("brims, rafts and support reach contribute to clone clearance", () => {
  const brim = planningAllowance([{ brim_type: "outer_only", brim_width: "5", brim_object_gap: "0.1" }], "bambu", true);
  assert.equal(brim.padding, 5.1);
  const raft = planningAllowance([{ raft_layers: "3", raft_expansion: "4", raft_first_layer_expansion: "2", layer_height: "0.2" }], "bambu", true);
  assert.equal(raft.padding, 6);
  assert.ok(Math.abs(raft.extraHeight - 0.6) < 1e-6);
  const auto = planningAllowance([{ enable_support: "1", support_type: "tree(auto)", brim_type: "auto_brim" }], "bambu", true);
  assert.equal(auto.padding, 3);
  assert.equal(auto.footprintNotes.length, 2);
  assert.equal(planningAllowance([{ brim_type: "outer_only", brim_width: "10" }], "bambu", false).padding, 0);
  assert.equal(planningAllowance([{ brim_width: "5", brim_separation: "0.1" }], "prusa", true).padding, 5.1);
  assert.ok(planningAllowance([{ enable_support: "0" }], "snapmaker", true, "auto", true).padding >= 3);
  assert.ok(planningAllowance([{ raft_layers: "2", raft_first_layer_expansion: "-1" }], "bambu", true)
    .footprintNotes.some(note => note.includes("automatic raft")));
});

await ok("painted supports remain enabled on each cloned U1 object", () => {
  const { built } = u1ConfigOf(bambuSource({ settings: { enable_support: "0" }, painted: true }),
    { layout: { copies: 3, width: 270, depth: 270, spacing: 5 } });
  const objects = [...project.readProject(built.entries).meta.values()].filter(o => o.settings);
  assert.equal(objects.length, 3);
  for (const object of objects) assert.equal(object.settings.enable_support, "1");
});

if (failures.length) {
  console.error(`\n${failures.length} print-settings check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`print settings ok: ${checks} checks`);
}
