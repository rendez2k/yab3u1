// The sliced-G-code planner, shared with u1gcode.py.
//
// The two implementations are kept in step by a parity test that runs both over
// the same files and compares the whole per-layer result. Commands are matched
// exactly (G90.1 is not G90, M820 is not M82), a layer starts at `;LAYER_CHANGE`
// while `;Z:`/`;HEIGHT:`/`SET_PRINT_STATS_INFO` are metadata, retract debt is
// modelled before an unretraction counts as material, and movement is measured by
// the coordinates actually changing.

export const MAX_BYTES = 96 * 1024 * 1024;
export const MAX_LAYERS = 40000;

export class GcodeError extends Error {}

const LAYER_START_RE = /^\s*;\s*(?:LAYER_CHANGE|CHANGE_LAYER)\b/i;
// `m`, because the hook has to be found on its own line inside a whole file:
// without it `^` only matches the very start of the text and a real header
// followed by hook-only layers looked like a file with no layer markers at all.
const LAYER_HOOK_RE = /^[ \t]*;[ \t]*(?:BEFORE_LAYER_CHANGE|AFTER_LAYER_CHANGE)\b/im;
const LAYER_AFTER_RE = /^\s*;\s*AFTER_LAYER_CHANGE\b/i;
const LAYER_START_ALT_RE = /^\s*;\s*LAYER\b\s*$/i;
const LAYER_Z_RE = /^\s*;\s*Z\s*[:=]\s*(-?[0-9.]+)/i;
const LAYER_HEIGHT_RE = /^\s*;\s*HEIGHT\s*[:=]\s*(-?[0-9.]+)/i;
const STATS_LAYER_RE = /^\s*;?\s*SET_PRINT_STATS_INFO\s+CURRENT_LAYER\s*[:=]\s*(\d+)/i;
const TOTAL_LAYER_RE = /^\s*;?\s*SET_PRINT_STATS_INFO\s+TOTAL_LAYER\s*[:=]\s*(\d+)/i;
const TIME_RE = /^\s*;\s*(?:estimated printing time[^=:=]*|model printing time[^=:=]*|total estimated time[^=:=]*)\s*[:=]\s*(.+?)\s*$/i;
const FILAMENT_RE = /^\s*;\s*(?:filament|filament_settings_id|filament_type)\w*\s*[:=]\s*(.+?)\s*$/i;
const TOOL_RE = /^\s*T(\d+)\s*$/;
const MOVE_RE = /^\s*(G[0-3])\b(.*)$/i;
const PARAM_RE = /([XYZEFIJ])(-?(?:[0-9]+\.?[0-9]*|\.[0-9]+))/gi;
const WORD_RE = /([A-Za-z])([^\s;]*)/gi;
const NUMBER_RE = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/;

const EXACT = {
  M82: /^M82(?:\s|$)/i,
  M83: /^M83(?:\s|$)/i,
  G90: /^G90(?:\s|$)/i,
  G91: /^G91(?:\s|$)/i,
  G92: /^G92(?:\s|$)/i,
  G20: /^G20(?:\s|$)/i,
  G10: /^G10(?:\s|$)/i,
  G11: /^G11(?:\s|$)/i,
  M600: /^M600(?:\s|$)/i,
  M0: /^M0(?:\s|$)/i,
  M1: /^M1(?:\s|$)/i,
  G90_1: /^G90\.1(?:\s|$)/i,
  M200_D: /^M200\b.*\bD/i,
};

const UNMODELLED = [
  [/^ACTIVATE_EXTRUDER\b/i,
   "the file activates a tool with ACTIVATE_EXTRUDER, which this planner does not "
   + "model"],
  [/^M62[0-3](?:\s|$)/i,
   "the file uses conditional tool commands (M620-M623), which this planner does "
   + "not model"],
  // SET_PRESSURE_ADVANCE / SET_FILAMENT_SENSOR / EXCLUDE_OBJECT are passive: none
  // of them changes which reel extrudes material, so they are ignored on purpose
  // (see PASSIVE_RE) rather than refused.
];

// Commands this planner understands well enough to ignore: none of them can
// change *which* reel extrudes material.  Anything else that looks like a
// command (a macro, a mode lookalike such as M820, a conditional tool change) is
// refused with a sentence rather than skipped, because skipping it would let the
// plan look confident about a file it did not really read.
const PASSIVE_RE = new RegExp("^(?:"
  + ["G4", "G21", "G28", "G29", "G80", "M18", "M84", "M73", "M117", "M118",
     "M104", "M105", "M109", "M140", "M141", "M155", "M190", "M191", "M106",
     "M107", "M204", "M205", "M201", "M203", "M220", "M221", "M400", "M900",
     "M572", "M566", "M593", "M594", "SET_PRESSURE_ADVANCE", "SET_VELOCITY_LIMIT",
     "SET_FAN_SPEED", "SET_GCODE_OFFSET", "SET_FILAMENT_SENSOR",
     "EXCLUDE_OBJECT\\w*"].join("|")
  + ")(?:\\s|$)", "i");
const FLAVOUR_RE = /^\s*;\s*gcode_flavor\s*[:=]\s*(\S+)/i;

export function decode(data) {
  if (!data || !data.length) throw new GcodeError("the file is empty");
  if (data.length > MAX_BYTES) {
    throw new GcodeError(`the file is ${(data.length / 1048576).toFixed(1)} MB; this `
      + `reader stops at ${Math.floor(MAX_BYTES / 1048576)} MB`);
  }
  const head = data.subarray(0, 8192);
  if (head.includes(0)) {
    throw new GcodeError("this looks like a binary file, not ASCII G-code (a .gcode "
      + "member inside a sliced 3MF has to be chosen explicitly)");
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const sample = text.slice(0, 20000);
  if (sample) {
    let printable = 0;
    for (const ch of sample) {
      const code = ch.codePointAt(0);
      if ((code >= 32 && code < 127) || ch === "\n" || ch === "\r" || ch === "\t") {
        printable += 1;
      }
    }
    if (printable < 0.98 * sample.length) {
      throw new GcodeError("this is not plain-text G-code");
    }
  }
  return text;
}

export function flavour(text) {
  const head = text.slice(0, 200000).toLowerCase();
  for (const [needle, name] of [["orcaslicer", "orca"], ["prusaslicer", "prusa"],
                                ["bambustudio", "bambu"], ["bambu studio", "bambu"],
                                ["snapmaker", "snapmaker"]]) {
    if (head.includes(needle)) return name;
  }
  return "unknown";
}

function params(text, lineNo) {
  const out = {};
  for (const match of text.matchAll(PARAM_RE)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      throw new GcodeError(`line ${lineNo}: ${match[1]}${match[2]} is not a finite `
        + "number");
    }
    out[match[1].toUpperCase()] = value;
  }
  // A word is only a number if the *whole* token is one: `E1oops` must not pass
  // as an extrusion of 1.
  for (const match of text.matchAll(WORD_RE)) {
    if (!NUMBER_RE.test(match[2] || "")) {
      throw new GcodeError(`line ${lineNo}: ${match[1]} has no number in `
        + `"${text.trim()}"`);
    }
  }
  return out;
}

export function analyse(text, { physical = 4 } = {}) {
  if (physical < 1) throw new GcodeError("a machine needs at least one slot");
  if (!text.trim()) throw new GcodeError("the file has no G-code in it");
  try {
    return scan(text, physical, false);
  } catch (error) {
    if (!(error instanceof NoLayers) || !LAYER_HOOK_RE.test(text)) throw error;
    // Only the *after* hook counts: counting both would make every layer two.
    return scan(text, physical, true);
  }
}

class NoLayers extends GcodeError {}

function scan(text, physical, hooksAsMarkers) {
  let absoluteE = true;
  let absoluteXyz = true;
  // How this firmware's G90/G91 treats the extruder.  Klipper keeps E on its own
  // M82/M83 switch; Marlin resets E with the XYZ mode.  When the file does not
  // say which, an E word after a mode change is refused until M82/M83 settles it.
  const modeMatch = FLAVOUR_RE.exec(text.slice(0, 100000));
  const firmware = (modeMatch ? modeMatch[1] : "").toLowerCase();
  const klipperLike = firmware === "klipper" || firmware === "reprapfirmware"
    || firmware === "rrf" || firmware === "smoothieware";
  const marlinLike = firmware === "marlin" || firmware === "marlin2";
  let eModeUnclear = false;
  let tool = 0;
  const position = { X: 0, Y: 0, Z: 0 };
  let ePosition = 0;
  // Debt is per tool: a retraction on T0 must not hide material from T4.
  const debt = new Map();
  const debtOf = (which) => debt.get(which) || 0;
  let swapSeen = false;

  const layers = [];
  let current = null;
  const startup = {};
  let markers = 0;
  let retractions = 0;
  let primes = 0;
  let moves = 0;
  let anomalies = 0;
  const sentinels = [];
  let reportedTime = "";
  let statsLayers = 0;
  let totalLayers = null;
  const legend = [];
  let pending = { z: null, height: null };

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const line = lines[index].trim();
    if (!line) continue;

    if (line.startsWith(";")) {
      const starts = LAYER_START_RE.test(line) || LAYER_START_ALT_RE.test(line)
        || (hooksAsMarkers && LAYER_AFTER_RE.test(line));
      if (starts) {
        // A repeated start marker before anything is deposited is the same layer
        // written twice (some dialects emit both spellings); the first boundary
        // stays the layer's line.
        if (current && !current.deposited) {
          markers += 1;
          continue;
        }
        if (layers.length >= MAX_LAYERS) {
          throw new GcodeError(`more than ${MAX_LAYERS} layers; this reader stops `
            + "there");
        }
        current = { index: layers.length, z: null, height: null, line: lineNo,
                    tools: {}, deposited: false };
        if (pending.z !== null || pending.height !== null) {
          current.z = pending.z;
          current.height = pending.height;
          pending = { z: null, height: null };
        }
        layers.push(current);
        markers += 1;
        continue;
      }
      const z = LAYER_Z_RE.exec(line);
      if (z) {
        const value = Number(z[1]);
        if (!Number.isFinite(value)) {
          throw new GcodeError(`line ${lineNo}: a layer Z is not finite`);
        }
        if (!current || current.z !== null) pending.z = value;
        else current.z = value;
        continue;
      }
      const height = LAYER_HEIGHT_RE.exec(line);
      if (height) {
        const value = Number(height[1]);
        if (!current || current.height !== null) pending.height = value;
        else current.height = value;
        continue;
      }
      if (STATS_LAYER_RE.test(line)) { statsLayers += 1; continue; }
      const total = TOTAL_LAYER_RE.exec(line);
      if (total) { totalLayers = Number(total[1]); continue; }
      const stamp = TIME_RE.exec(line);
      if (stamp && !reportedTime) { reportedTime = stamp[1].trim(); continue; }
      const spool = FILAMENT_RE.exec(line);
      if (spool) legend.push(spool[1].trim());
      continue;
    }

    const head = line.split(";", 1)[0].trim();
    if (!head) continue;
    const tail = head.includes(" ") ? head.slice(head.indexOf(" ") + 1) : "";

    if (STATS_LAYER_RE.test(head)) { statsLayers += 1; continue; }
    const totalHead = TOTAL_LAYER_RE.exec(head);
    if (totalHead) { totalLayers = Number(totalHead[1]); continue; }
    if (EXACT.G90_1.test(head)) {
      throw new GcodeError("this file switches to G90.1 extrusion, whose semantics "
        + "this planner does not model");
    }
    let refused = false;
    for (const [pattern, message] of UNMODELLED) {
      if (pattern.test(head)) {
        refused = true;
        throw new GcodeError(message);
      }
    }
    if (refused) continue;
    if (EXACT.G20.test(head)) {
      throw new GcodeError("this file switches to inches (G20), which this planner "
        + "does not model");
    }
    if (EXACT.M200_D.test(head)) {
      throw new GcodeError("this file uses volumetric extrusion (M200 with a "
        + "diameter), which this planner does not model");
    }
    if (EXACT.G10.test(head) || EXACT.G11.test(head)) {
      throw new GcodeError("this file uses firmware retraction (G10/G11), which this "
        + "planner does not model");
    }
    if (EXACT.M600.test(head)) {
      sentinels.push({ kind: "filament-change", command: head, line: lineNo,
                       layer: current ? current.index : null });
      swapSeen = true;
      continue;
    }
    if (EXACT.M0.test(head) || EXACT.M1.test(head)) {
      sentinels.push({ kind: "pause", command: head, line: lineNo,
                       layer: current ? current.index : null });
      continue;
    }
    if (EXACT.M82.test(head)) { absoluteE = true; eModeUnclear = false; continue; }
    if (EXACT.M83.test(head)) { absoluteE = false; eModeUnclear = false; continue; }
    if (EXACT.G90.test(head) || EXACT.G91.test(head)) {
      absoluteXyz = EXACT.G90.test(head);
      if (marlinLike) absoluteE = absoluteXyz;
      else if (!klipperLike) eModeUnclear = true;
      continue;
    }
    if (EXACT.G92.test(head)) {
      const values = params(tail, lineNo);
      // G92 E moves the *coordinate*, not the physical material: the filament
      // still owes whatever a previous retraction took out.
      if ("E" in values) ePosition = values.E;
      for (const axis of ["X", "Y", "Z"]) {
        if (axis in values) position[axis] = values[axis];
      }
      continue;
    }
    const toolMatch = TOOL_RE.exec(head);
    if (toolMatch) {
      const number = Number(toolMatch[1]);
      if (number >= 250) {
        throw new GcodeError(`line ${lineNo}: T${number} looks like a slicer sentinel `
          + "rather than a tool; this planner will not guess which reel it means");
      }
      tool = number;
      continue;
    }

    const move = MOVE_RE.exec(head);
    if (!move) {
      if (PASSIVE_RE.test(head)) continue;
      throw new GcodeError(`line ${lineNo}: this file uses "${head}", which this `
        + "planner does not model; it will not guess whether that changes extrusion "
        + "or which reel is in the head");
    }
    const values = params(move[2], lineNo);
    if (!Object.keys(values).length) continue;
    moves += 1;
    if ((move[1].toUpperCase() === "G2" || move[1].toUpperCase() === "G3")
        && "E" in values && !("X" in values) && !("Y" in values)) {
      // A full circle deposits even though the end point is the start point.
      if (!("I" in values)) values.I = 0;
    }

    const before = { ...position };
    for (const axis of ["X", "Y", "Z"]) {
      if (axis in values) {
        position[axis] = absoluteXyz ? values[axis] : position[axis] + values[axis];
      }
    }
    const moved = Math.abs(position.X - before.X) > 1e-9
      || Math.abs(position.Y - before.Y) > 1e-9;
    if (current && current.z === null) current.z = position.Z;

    if (!("E" in values)) continue;
    if (eModeUnclear) {
      throw new GcodeError(`line ${lineNo}: this file changes the move mode without `
        + "saying whether extrusion is absolute or relative (no M82/M83 after "
        + "G90/G91), so this planner will not guess how much filament this move uses");
    }
    if (swapSeen) {
      throw new GcodeError(`line ${lineNo}: this G-code changes filament itself `
        + "(M600) and then prints again, so which reel is in the head is unknown; "
        + "this planner will not give a confident schedule for it");
    }
    let delta = absoluteE ? values.E - ePosition : values.E;
    ePosition = absoluteE ? values.E : ePosition + values.E;
    if (delta < -1e-9) {
      retractions += 1;
      debt.set(tool, debtOf(tool) + -delta);
      continue;
    }
    if (delta <= 1e-9) continue;
    const moving = moved || "I" in values || "J" in values;
    if (debtOf(tool) > 1e-9) {
      const consumed = Math.min(debtOf(tool), delta);
      debt.set(tool, debtOf(tool) - consumed);
      delta -= consumed;
      // Printing through a retracted nozzle is worth reporting; the payback
      // itself is not new material.
      if (moving) anomalies += 1;
      if (delta <= 1e-9) continue;
    }
    if (!moving) primes += 1;
    const bucket = current ? current.tools : startup;
    bucket[tool] = (bucket[tool] || 0) + delta;
    if (current) current.deposited = true;
  }

  if (markers === 0) {
    throw new NoLayers("this G-code has no layer markers, so no per-layer plan can "
      + "be made from it");
  }
  if (!layers.length) throw new NoLayers("no layers were found in this G-code");

  const used = [...new Set([
    ...layers.flatMap((layer) => Object.keys(layer.tools).map(Number)),
    ...Object.keys(startup).map(Number)])].sort((a, b) => a - b);
  if (!used.length) {
    throw new GcodeError("no filament is deposited anywhere in this G-code");
  }

  const perLayer = layers.map((layer) => ({
    index: layer.index, z: layer.z, height: layer.height, line: layer.line,
    tools: Object.keys(layer.tools).map(Number).sort((a, b) => a - b),
  }));
  const incompatible = perLayer.filter((entry) => entry.tools.length > physical);
  const result = {
    flavour: flavour(text),
    layers: layers.length,
    total_layers: totalLayers,
    moves,
    retractions,
    primes,
    anomalies,
    stats_layer_markers: statsLayers,
    sentinels: sentinels.slice(0, 40),
    startup_tools: Object.keys(startup).map(Number).sort((a, b) => a - b),
    tools: used,
    legend: legend.slice(0, 8),
    max_tools_per_layer: perLayer.reduce((best, entry) =>
      Math.max(best, entry.tools.length), 0),
    incompatible_layers: incompatible.slice(0, 20),
    incompatible_count: incompatible.length,
    reported_time: reportedTime,
    per_layer: perLayer,
    physical,
  };
  if (incompatible.length) {
    const worst = Math.max(...incompatible.map((entry) => entry.tools.length));
    const first = incompatible[0];
    return {
      ...result,
      feasible: false,
      schedule: [], initial: {}, pause_count: null, reel_changes: null,
      diagnosis: "too-many-colours-per-layer",
      summary: `${incompatible.length} of ${layers.length} layers deposit more than `
        + `${physical} colours (worst ${worst}, first at layer ${first.index}, `
        + `line ${first.line}`
        + (first.z !== null ? `, Z ${first.z.toFixed(2)} mm` : "")
        + "). Colours inside one layer cannot be separated by changing reels between "
        + "layers, so there is no layer-boundary plan for this file. Recolour the "
        + "model or slice it differently.",
    };
  }
  return { ...result, ...schedule(perLayer, Object.keys(startup).map(Number), physical),
           feasible: true, diagnosis: "ok" };
}

export function schedule(perLayer, startup, physical) {
  if (new Set([...(perLayer[0] ? perLayer[0].tools : []), ...startup]).size > physical) {
    throw new GcodeError("the first layer already needs more colours than the machine "
      + "has");
  }
  const firstUse = new Map();
  startup.forEach((tool) => firstUse.set(tool, -1));
  perLayer.forEach((layer, index) => {
    layer.tools.forEach((tool) => {
      if (!firstUse.has(tool)) firstUse.set(tool, index);
    });
  });
  const ordered = [...firstUse.keys()]
    .sort((a, b) => (firstUse.get(a) - firstUse.get(b)) || (a - b));
  const needed = ordered.slice(0, physical);

  // Where each tool is used next, as sorted layer lists searched with bisect, so a
  // file with thousands of layers is not quadratic.
  const uses = new Map();
  perLayer.forEach((layer, index) => {
    layer.tools.forEach((tool) => {
      if (!uses.has(tool)) uses.set(tool, []);
      uses.get(tool).push(index);
    });
  });
  const nextUse = (tool, fromLayer) => {
    const where = uses.get(tool);
    if (!where || !where.length) return perLayer.length + 1;
    let lo = 0;
    let hi = where.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (where[mid] < fromLayer) lo = mid + 1;
      else hi = mid;
    }
    return lo < where.length ? where[lo] : perLayer.length + 1;
  };

  const loaded = new Map();
  const initial = {};
  needed.forEach((tool, index) => {
    loaded.set(index + 1, tool);
    initial[tool] = index + 1;
  });
  let nextSlot = loaded.size + 1;

  const changes = [];
  perLayer.forEach((layer, position) => {
    const required = layer.tools;
    for (const tool of required) {
      if ([...loaded.values()].includes(tool)) continue;
      let slot;
      if (nextSlot <= physical) {
        slot = nextSlot;
        nextSlot += 1;
      } else {
        const keep = new Set([...loaded.values()].filter((t) => required.includes(t)));
        const options = [...loaded.keys()].filter((s) => !keep.has(loaded.get(s)))
          .sort((a, b) => a - b);
        if (!options.length) {
          throw new GcodeError(`layer ${layer.index} needs ${required.length} colours `
            + "and no slot can be freed for it");
        }
        slot = options.reduce((best, option) => {
          const better = nextUse(loaded.get(option), position + 1);
          const currentBest = nextUse(loaded.get(best), position + 1);
          return (better > currentBest
                  || (better === currentBest && option < best)) ? option : best;
        }, options[0]);
        changes.push({ layer: layer.index, z: layer.z, line: layer.line, slot,
                       out: loaded.get(slot), in: tool });
      }
      loaded.set(slot, tool);
    }
  });

  const sim = new Map(Object.entries(initial).map(([tool, slot]) => [slot, Number(tool)]));
  const byLayer = new Map();
  changes.forEach((change) => {
    if (!byLayer.has(change.layer)) byLayer.set(change.layer, []);
    byLayer.get(change.layer).push(change);
  });
  const problems = [];
  for (const layer of perLayer) {
    for (const change of byLayer.get(layer.index) || []) {
      const slot = [...sim.entries()].find(([, t]) => t === change.out);
      if (!slot || slot[0] !== change.slot) {
        problems.push(`layer ${layer.index}: reel ${change.out} is not in slot `
          + `${change.slot}`);
        continue;
      }
      sim.set(change.slot, change.in);
    }
    for (const tool of layer.tools) {
      if (![...sim.values()].includes(tool)) {
        problems.push(`layer ${layer.index} needs tool ${tool}, which is not loaded`);
      }
    }
  }
  if (problems.length) {
    throw new GcodeError("the schedule does not satisfy the file: "
      + problems.slice(0, 3).join("; "));
  }

  const initialOut = {};
  Object.entries(initial).sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([tool, slot]) => { initialOut[String(tool)] = slot; });
  const pauses = byLayer.size;
  const maxPerLayer = perLayer.reduce((best, layer) =>
    Math.max(best, layer.tools.length), 0);
  return {
    initial: initialOut,
    schedule: changes,
    pause_count: pauses,
    reel_changes: changes.length,
    heuristic: true,
    startup,
    summary: `${perLayer.length} layers, never more than ${maxPerLayer} colours in `
      + `one layer; ${changes.length} reel change${changes.length === 1 ? "" : "s"} `
      + `at ${pauses} pause${pauses === 1 ? "" : "s"}`
      + (changes.length ? "" : " — the four loaded reels cover every layer")
      + ". The pause positions come from the slicer's own layer markers; the "
      + "sequence is deterministic, not proven minimal.",
  };
}

export function planText(evidence, name = "model", member = "") {
  const lines = [`U1 reel-change plan for ${name}`];
  if (member) lines.push(`  (read from ${member} inside that file)`);
  lines.push(
    "=".repeat(60),
    "",
    "This is a PLAN, not printable G-code.",
    "The sliced file still selects the slicer's own tools (including any virtual",
    "mixture tools). Before printing on a U1 the tool commands have to be remapped",
    "so each logical colour maps to one of the four loaded reels, and verified",
    "pauses inserted at the boundaries below. Nothing here rewrites the file, and",
    "this schedule alone does not make it four-tool compatible.",
    "",
    "Evidence (read from the sliced file, not from the mesh)",
    "-------------------------------------------------------",
    `  flavour           : ${evidence.flavour || "unknown"}`,
    `  layers            : ${evidence.layers}`
      + (evidence.total_layers ? ` (the file declares ${evidence.total_layers})` : ""),
    `  machining moves   : ${evidence.moves}`,
    `  retractions       : ${evidence.retractions} (ignored: no material)`,
    `  prime moves       : ${evidence.primes} (purge with no travel: counted as `
      + "material for the reel in the head, and in the layer it happens in)",
    `  unanswered extrude: ${evidence.anomalies}`,
    `  layer-stat markers: ${evidence.stats_layer_markers} (metadata)`,
    `  startup tools     : ${labels(evidence.startup_tools)}`,
    `  colours deposited : ${labels(evidence.tools)}`,
    `  slicer time mark  : ${evidence.reported_time || "none in the file"}`,
    `  content           : ${evidence.fingerprint || "not recorded"}`,
    "",
  );
  if ((evidence.legend || []).length) {
    lines.push("Palette named by the file itself", "--------------------------------");
    evidence.legend.forEach((entry) => lines.push(`  ${entry}`));
    lines.push("");
  }
  if ((evidence.sentinels || []).length) {
    lines.push("Operator actions already in the file",
               "-----------------------------------");
    evidence.sentinels.slice(0, 10).forEach((item) => {
      lines.push(`  ${item.kind}: ${item.command} (line ${item.line}`
        + (item.layer === null || item.layer === undefined ? "" : `, layer ${item.layer}`)
        + ")");
    });
    lines.push("");
  }
  if (!evidence.feasible) {
    lines.push("Result: no layer-boundary plan", "---------------------------------",
               evidence.summary || "", "");
    return lines.join("\n") + "\n";
  }
  lines.push("Initial load", "------------");
  Object.entries(evidence.initial || {}).sort((a, b) => a[1] - b[1])
    .forEach(([tool, slot]) => lines.push(`  slot ${slot} -> tool ${tool}`));
  const changes = evidence.schedule || [];
  lines.push("");
  if (!changes.length) {
    lines.push("No reel changes: the four loaded reels cover every layer.");
  } else {
    lines.push(`${changes.length} reel change${changes.length === 1 ? "" : "s"} at `
      + `${evidence.pause_count} pause${evidence.pause_count === 1 ? "" : "s"}:`);
    changes.forEach((change) => {
      const where = typeof change.z === "number"
        ? `Z ${change.z.toFixed(2)} mm` : "the layer";
      lines.push(`  layer ${String(change.layer).padStart(5)} (line ${change.line})  `
        + `before ${where.padStart(12)}  slot ${change.slot}: tool ${change.out} -> `
        + `tool ${change.in}`);
    });
    lines.push("");
    lines.push("Pause positions come from the slicer's layer markers; the sequence is "
      + "deterministic, not proven minimal.");
  }
  return lines.join("\n") + "\n";
}

function labels(tools) {
  if (!tools || !tools.length) return "none";
  return tools.map((tool) => `T${tool}`).join(", ");
}
