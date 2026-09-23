// U1 postprocessor. Pause placement and header conventions were informed by
// slots-u1 (MIT, Javier Albornoz); see THIRD_PARTY_NOTICES.txt.
// Kept separate from project conversion and the generic read-only planner.
import { analyse, schedule, GcodeError, MAX_BYTES } from "./planner.js";
import { colourName } from "./assignment.js";

const fail = (message) => { throw new GcodeError(message); };
const codeOf = (line) => line.split(";", 1)[0].trim();
const toolToken = /\bT(\d+)\b/g;
const MACROS = new Set(["PRINT_START", "PRINT_END", "TIMELAPSE_START", "TIMELAPSE_STOP",
  "TIMELAPSE_TAKE_FRAME", "DEFECT_DETECTION_START", "DEFECT_DETECTION_DETECT",
  "DEFECT_DETECTION_DETECT_BED", "SM_PRINT_CHECK_SWITCH_EXTRUDER",
  "MOVE_TO_DISCARD_FILAMENT_POSITION", "ROUGHLY_CLEAN_NOZZLE_WITH_DISCARD",
  "MOVE_TO_XY_IDLE_POSITION_EXTRUDER", "ROUGHLY_CLEAN_NOZZLE",
  "FINELY_CLEAN_NOZZLE_STAGE_1", "FINELY_CLEAN_NOZZLE_STAGE_2", "DETECT_BED_PLATE"]);
const SETUP = new Set(["SM_PRINT_EXTRUDER_PREHEAT", "SM_PRINT_AUTO_FEED", "SM_PRINT_FLOW_CALIBRATE"]);
const ZERO_TEMP = /^M104\b.*\bS0(?:\s|$)/;
const METADATA = new Map([
  ["filament_colour", ";"], ["extruder_colour", ";"], ["filament_type", ";"],
  ["filament_colour_type", ";"], ["filament_settings_id", ";"],
  ["nozzle_diameter", ","], ["extruder_offset", ","],
]);

function configOf(lines) {
  const cfg = {};
  for (const line of lines) {
    const m = /^;\s*([a-z_]+)\s*=\s*(.*)$/.exec(line);
    if (m) cfg[m[1]] = m[2].trim();
  }
  return cfg;
}

/** Read only a declared U1 slice; all unrecognised executable macros fail closed. */
export function inspectU1(text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) fail("This file exceeds the 96 MB limit.");
  if (text.includes("YAB3D_SWAP_EXPORT")) fail("This file already has YAB3D reel changes. Use the original slice.");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cfg = configOf(lines);
  if (!/^Snapmaker U1(?:\s|$)/i.test(cfg.printer_model || cfg.printer_settings_id || ""))
    fail("Download with pauses needs a slice made for Snapmaker U1. Convert the model, select a U1 profile and slice it first.");
  if (cfg.gcode_flavor !== "klipper") fail("This U1 slice must declare Klipper G-code.");
  if (cfg.mixed_filament_definitions && cfg.mixed_filament_definitions !== '""')
    fail("This slice uses mixed filaments. Slice with one ordinary filament per colour for reel changes.");
  const colours = (cfg.filament_colour || "").split(";");
  const types = (cfg.filament_type || "").split(";");
  const nozzles = (cfg.nozzle_diameter || "").split(",");
  if (!colours.length || colours.length > 12 || colours.some((c) => !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(c)))
    fail("The U1 slice needs a declared palette of 1–12 ordinary filament colours.");
  if (types.length !== colours.length || types.some((t) => t.trim().toUpperCase() !== "PLA"))
    fail("The first reel-change exporter supports all-PLA slices only. Use PLA for every logical colour.");
  if (nozzles.length < colours.length || nozzles.some((n) => Number(n) !== 0.4))
    fail("The first reel-change exporter supports U1 0.4 mm nozzle profiles only.");
  if (cfg.extruder_offset && cfg.extruder_offset.split(",").some((v) => !/^0(?:\.0+)?x0(?:\.0+)?$/.test(v.trim())))
    fail("The virtual U1 tools must use zero slicer offsets; physical offsets belong to the printer.");
  const clean = [], touches = [], anchors = [];
  let layer = -1, started = false, ended = false, relativeE = false, tool = 0;
  let startCount = 0, endCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], code = codeOf(line), command = code.split(/\s/)[0];
    if (/^\s*;LAYER_CHANGE\s*$/.test(line)) { layer++; anchors.push(null); }
    if (/^(?:M0|M1|M600|PAUSE|RESUME)(?:\s|$)/.test(code))
      fail(`Line ${i + 1}: the slice already contains a pause or filament change. Remove it in the slicer and export again.`);
    if (code === "M83") relativeE = true;
    // The scanner already models arcs in XY. Orca explicitly reasserts this
    // plane; other planes remain unsupported. Preserve G17 in the written file.
    if (code === "G17") { clean.push(""); continue; }
    if (code === "M82") fail("Absolute extrusion is not supported by the U1 reel-change exporter. Slice with relative E distances.");
    if (/^G[0-3]\b.*\bE/.test(code) && !relativeE) fail(`Line ${i + 1}: extrusion occurs before M83.`);
    const bare = /^T(\d+)$/.exec(code);
    if (bare) { tool = Number(bare[1]); touches.push({ line: i, layer, tool }); }
    if (/^G[0-3]\b.*\bE/.test(code)) touches.push({ line: i, layer, tool });
    if (/^M10[469]\b/.test(code)) {
      if (!/^M10[469](?:\s+[STPAR][-+]?(?:\d+(?:\.\d*)?|\.\d+))+$/.test(code))
        fail(`Line ${i + 1}: unsupported heater or fan parameters.`);
      const words = [...code.slice(command.length).matchAll(/([STPAR])([-+\d.]+)/g)];
      if (new Set(words.map((m) => m[1])).size !== words.length
          || words.some((m) => !Number.isFinite(Number(m[2]))
            || (m[1] === "T" && !/^\d+$/.test(m[2]))))
        fail(`Line ${i + 1}: ambiguous heater or fan parameters.`);
      for (const match of code.matchAll(toolToken)) {
        const t = Number(match[1]);
        if (t >= colours.length) fail(`Line ${i + 1}: T${t} is outside the declared palette.`);
        if (!ZERO_TEMP.test(code)) touches.push({ line: i, layer, tool: t });
      }
    } else if (!bare && /\bT\d+\b/.test(code)) fail(`Line ${i + 1}: an unsupported command addresses a tool.`);
    if (/\bEXTRUDER=/.test(code) && !SETUP.has(command))
      fail(`Line ${i + 1}: named-extruder commands cannot be remapped by this exporter.`);
    if (/^SET_FILAMENT_SENSOR\b/.test(code))
      fail(`Line ${i + 1}: custom filament-sensor commands are not supported by this exporter.`);
    if (command === "SM_PRINT_PREEXTRUDE_FILAMENT") {
      const match = /^SM_PRINT_PREEXTRUDE_FILAMENT INDEX=(\d+)$/.exec(code);
      if (!match) fail(`Line ${i + 1}: unsupported pre-extrusion command.`);
      touches.push({ line: i, layer, tool: Number(match[1]) });
      clean.push(""); continue;
    }
    if (SETUP.has(command)) {
      if (layer >= 0 || ended) fail(`Line ${i + 1}: automatic feed/calibration must stay in startup.`);
      const match = /^SM_PRINT_(?:EXTRUDER_PREHEAT|AUTO_FEED|FLOW_CALIBRATE) EXTRUDER=([0-3])(?: TEMP=\d+(?:\.\d+)?)?$/.exec(code);
      if (!match) fail(`Line ${i + 1}: startup must address only the four physical U1 heads.`);
      clean.push(""); continue;
    }
    if (command === "BED_MESH_CALIBRATE") {
      if (layer >= 0 || !/^BED_MESH_CALIBRATE(?: (?:PROBE_COUNT|Z_OFFSET)=[-\d.,]+)*$/.test(code))
        fail(`Line ${i + 1}: unexpected bed calibration.`);
      clean.push(""); continue;
    }
    if (MACROS.has(command)) {
      if (code !== command) fail(`Line ${i + 1}: unexpected parameters on ${command}.`);
      if (command === "PRINT_START") { startCount++; started = true; }
      if (command === "PRINT_END") { endCount++; ended = true; }
      clean.push(""); continue;
    }
    const stats = /^SET_PRINT_STATS_INFO CURRENT_LAYER=(\d+)$/.exec(code);
    if (stats && layer >= 0) {
      if (anchors[layer] !== null || Number(stats[1]) !== layer + 1)
        fail(`Line ${i + 1}: layer markers and the U1 layer counter disagree.`);
      anchors[layer] = i;
    }
    // Orca emits object-cancellation geometry and fan-off commands before its
    // machine start block. They do not activate or extrude a logical colour.
    const preamble = /^EXCLUDE_OBJECT_DEFINE NAME=[\w.-]+ CENTER=[-\d.,]+ POLYGON=\[[-\d.,\[\]]+\]$/.test(code)
      || /^M106(?: P[02])? S0$/.test(code);
    if (code && !started && !preamble && !/^M(?:73|201|203|204|205)\b/.test(code))
      fail(`Line ${i + 1}: unexpected command before PRINT_START.`);
    clean.push(line);
  }
  if (startCount !== 1 || endCount !== 1 || !started || !ended)
    fail("A complete U1 slice with PRINT_START and PRINT_END is required.");
  if (!anchors.length || anchors.some((n) => n === null))
    fail("Every layer needs the U1 CURRENT_LAYER counter before reel-change pauses can be inserted.");
  // Preserve source line positions when adapting U1's known macros for the strict
  // generic motion scanner. Its extrusion/debt checks remain unchanged.
  const evidence = analyse(";gcode_flavor = klipper\n" + clean.join("\n"));
  for (const entry of evidence.per_layer) entry.line--;
  if (evidence.layers !== anchors.length) fail("The slice has ambiguous or empty layer boundaries.");
  const startup = new Set(evidence.startup_tools);
  const perLayer = evidence.per_layer.map((l) => ({ ...l, tools: new Set(l.tools) }));
  for (const t of touches) {
    if (t.tool >= colours.length) fail(`Line ${t.line + 1}: T${t.tool} is not in the declared filament palette.`);
    (t.layer < 0 ? startup : perLayer[t.layer].tools).add(t.tool);
  }
  const usage = perLayer.map((l) => ({ ...l, tools: [...l.tools].sort((a,b) => a-b) }));
  const incompatible = usage.filter((l) => l.tools.length > 4), over = incompatible[0];
  const deposited = evidence.per_layer.filter((l) => l.tools.length > 4);
  const firstDeposit = deposited[0];
  const summary = over ? `Layer ${over.index + 1} addresses ${over.tools.length} colours. `
    + (firstDeposit ? `${deposited.length} layers actually deposit more than four colours, starting at layer ${firstDeposit.index + 1} (Z ${firstDeposit.z?.toFixed(2)} mm). ` : 'Advance heating, purge or tool selection also counts as using a colour. ')
    + 'This exporter can only change reels between layers using four heads. Recolour one source colour onto a loaded reel, or change the model/slice; no printable swap file has been generated.' : null;
  const plan = over ? { schedule: [], initial: {}, pause_count: null, reel_changes: null, summary,
    diagnosis: 'too-many-colours-per-layer' } : schedule(usage, [...startup], 4);
  const used = new Set([...startup, ...usage.flatMap((l) => l.tools)]);
  return { lines, cfg, colours, anchors, touches, evidence: {
    ...evidence, ...plan, feasible: !over, per_layer: usage,
    incompatible_count: incompatible.length, incompatible_layers: incompatible.slice(0,20),
    max_tools_per_layer: Math.max(...usage.map(l => l.tools.length)),
    startup_tools: [...startup], physical: 4,
    source_palette_count: colours.length,
    unused_colours: colours.map((_, i) => i).filter((i) => !used.has(i)),
  } };
}

function updatedMap(map, changes) {
  const next = new Map(map);
  for (const change of changes) {
    if (next.get(change.out) !== change.slot - 1) fail("The reel schedule is inconsistent.");
    next.delete(change.out); next.set(change.in, change.slot - 1);
  }
  return next;
}

function remapLine(line, map, lineNo) {
  const code = codeOf(line);
  const slot = (raw) => {
    const n = map.get(Number(raw));
    if (n === undefined) fail(`Line ${lineNo}: colour T${raw} is used before it is loaded. Re-slice without advance heating of unloaded colours.`);
    return n;
  };
  const semi = line.indexOf(";");
  const tail = semi < 0 ? "" : line.slice(semi);
  if (/^T\d+$/.test(code)) return `T${slot(code.slice(1))}${tail ? " " + tail : ""}`;
  if (/^M10[469]\b/.test(code)) {
    const refs = [...code.matchAll(toolToken)];
    if (refs.length > 1) fail(`Line ${lineNo}: multiple tool parameters.`);
    if (refs.length && !map.has(Number(refs[0][1])) && ZERO_TEMP.test(code))
      return "; YAB3D: skipped shutdown of an unloaded logical tool";
    return code.replace(toolToken, (_, n) => `T${slot(n)}`) + (tail ? " " + tail : "");
  }
  if (code.startsWith("SM_PRINT_PREEXTRUDE_FILAMENT "))
    return code.replace(/INDEX=(\d+)/, (_, n) => `INDEX=${slot(n)}`) + (tail ? " " + tail : "");
  return line;
}

function rewriteMetadata(line, initial) {
  if (/^;\s*filament (?:used \[(?:mm|cm3|g)\]|cost)\s*=/.test(line))
    return "; YAB3D original logical-colour statistic: " + line.slice(1).trim();
  if (/^;\s*printer_extruder_id\s*=/.test(line)) return "; printer_extruder_id = 1,2,3,4";
  const m = /^;\s*([a-z_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || !METADATA.has(m[1])) return line;
  const sep = METADATA.get(m[1]), values = m[2].split(sep);
  const columns = Array(4).fill(values[0]);
  for (const [raw, slot] of Object.entries(initial)) columns[slot - 1] = values[Number(raw)] || values[0];
  return `; ${m[1]} = ${columns.join(sep)}`;
}

export function operatorSheet(evidence, colours, name = "model") {
  const label = (n) => `colour ${n + 1} — ${colourName(colours[n])} (${colours[n]})`;
  const lines = [`YAB3D — U1 reel changes: ${name}`, "",
    "Print the downloaded -u1-swaps.gcode, not the original virtual-tool slice.",
    "This export inserts M600 pauses and uses physical tools T0–T3.",
    "At each pause, replace the listed reels, load/purge using the printer controls, then resume.",
    "The G-code viewer shows slot colours; reused slots change colour during the print.",
    "Initial load:"];
  Object.entries(evidence.initial).sort((a,b) => a[1]-b[1])
    .forEach(([raw, slot]) => lines.push(`  Slot ${slot}: ${label(Number(raw))}`));
  if (evidence.unused_colours.length) {
    lines.push("", "Unused colours — leave these out of the reel load:");
    evidence.unused_colours.forEach((n) => lines.push(`  ${label(n)}`));
    lines.push("Checked against the sliced commands, including support, infill and purge use.");
  }
  for (const c of evidence.schedule)
    lines.push(`Before layer ${c.layer + 1}${c.z === null ? "" : ` (Z ${c.z.toFixed(2)} mm)`}: slot ${c.slot}, remove ${label(c.out)}, load ${label(c.in)}.`);
  lines.push("", `${evidence.pause_count} pauses; ${evidence.reel_changes} reel changes.`,
    "Experimental export: verify a short print with at least two pauses before a long job.");
  return lines.join("\n") + "\n";
}

export function buildSwapExport(text, name = "model") {
  const source = inspectU1(text), { evidence, lines, anchors } = source;
  if (!evidence.feasible) {
    const error = new GcodeError(evidence.summary); error.evidence = evidence; throw error;
  }
  let map = new Map(Object.entries(evidence.initial).map(([raw, slot]) => [Number(raw), slot - 1]));
  const at = new Map();
  for (const c of evidence.schedule) {
    // After CURRENT_LAYER and the optional fan hook, matching Orca's native pause.
    let pos = anchors[c.layer] + 1;
    if (lines[pos]?.trim() === ";_SET_FAN_SPEED_CHANGING_LAYER") pos++;
    if (!at.has(pos)) at.set(pos, []);
    at.get(pos).push(c);
  }
  const output = ["; YAB3D_SWAP_EXPORT v1 — Snapmaker U1 / PLA / 0.4 mm",
    "; Reel colours change at M600 pauses. Keep the companion reel-change sheet."];
  for (let i = 0; i < lines.length; i++) {
    if (at.has(i)) {
      const changes = at.get(i);
      output.push(`; YAB3D_SWAP_BEGIN layer=${changes[0].layer + 1}`);
      for (const c of changes) output.push(`; Slot ${c.slot}: colour ${c.out + 1} -> colour ${c.in + 1} (${source.colours[c.in]})`);
      output.push("M400", ";PAUSE_PRINT", "M600", "; YAB3D_SWAP_END");
      map = updatedMap(map, changes);
    }
    output.push(rewriteMetadata(remapLine(lines[i], map, i + 1), evidence.initial));
  }
  const gcode = output.join("\n");
  verifySwapExport(source, gcode);
  return { gcode, evidence, sheet: operatorSheet(evidence, source.colours, name) };
}

/** Independent replay: every source command and motion must be accounted for,
 * output tools must fit four heads, and each pause must precede its new mapping.
 * A file is not released merely because the rewriter finished. */
export function verifySwapExport(source, gcode) {
  const out = gcode.split("\n");
  if (!out[0].startsWith("; YAB3D_SWAP_EXPORT") || out.length < source.lines.length + 2)
    fail("Output verification failed: incomplete file.");
  let j = 2, layer = -1;
  const loaded = new Map(Object.entries(source.evidence.initial).map(([tool, slot]) => [Number(tool), slot - 1]));
  let pauses = 0;
  for (let i = 0; i < source.lines.length; i++, j++) {
    if (/^\s*;LAYER_CHANGE\s*$/.test(source.lines[i])) layer++;
    if (out[j]?.startsWith("; YAB3D_SWAP_BEGIN")) {
      const changes = source.evidence.schedule.filter((c) => c.layer === layer);
      const expectedAt = source.anchors[layer] + 1 + (source.lines[source.anchors[layer]+1]?.trim() === ";_SET_FAN_SPEED_CHANGING_LAYER" ? 1 : 0);
      if (!changes.length || i !== expectedAt || out[j] !== `; YAB3D_SWAP_BEGIN layer=${layer + 1}`)
        fail("Output verification failed: misplaced pause.");
      j++;
      for (const c of changes) {
        const expected = `; Slot ${c.slot}: colour ${c.out + 1} -> colour ${c.in + 1} (${source.colours[c.in]})`;
        if (out[j++] !== expected || loaded.get(c.out) !== c.slot - 1)
          fail("Output verification failed: reel-change instructions.");
      }
      for (const expected of ["M400", ";PAUSE_PRINT", "M600", "; YAB3D_SWAP_END"])
        if (out[j++] !== expected) fail("Output verification failed: pause commands.");
      for (const c of changes) { loaded.delete(c.out); loaded.set(c.in, c.slot - 1); }
      pauses++;
    }
    const src = codeOf(source.lines[i]), dst = codeOf(out[j] || "");
    if (/^T\d+$/.test(src)) {
      if (dst !== `T${loaded.get(Number(src.slice(1)))}`) fail("Output verification failed: tool selection.");
    } else if (/^M10[469]\b/.test(src) || src.startsWith("SM_PRINT_PREEXTRUDE_FILAMENT ")) {
      const pattern = src.startsWith("SM_PRINT_") ? /INDEX=(\d+)/g : /\bT(\d+)\b/g;
      const before = [...src.matchAll(pattern)], after = [...dst.matchAll(pattern)];
      if (!dst && ZERO_TEMP.test(src) && before.length === 1 && !loaded.has(Number(before[0][1]))) continue;
      if (before.length !== after.length || src.replace(pattern, "TOOL") !== dst.replace(pattern, "TOOL"))
        fail("Output verification failed: a heater, fan or purge command changed.");
      for (let n = 0; n < before.length; n++) {
        const slot = Number(after[n][1]);
        if (slot < 0 || slot > 3 || slot !== loaded.get(Number(before[n][1])))
          fail("Output verification failed: tool parameter.");
      }
    } else if (src !== dst) fail(`Output verification failed: motion or command changed at line ${i + 1}.`);
    if (!src && out[j] !== rewriteMetadata(source.lines[i], source.evidence.initial))
      fail("Output verification failed: metadata changed unexpectedly.");
  }
  if (j !== out.length || pauses !== source.evidence.pause_count)
    fail("Output verification failed: missing or extra commands/pauses.");
  return true;
}
