// converter.js -- the conversion itself, in the browser.
//
// This is a port of the desktop tool's u1convert.py. It reads a 3MF project
// (PrusaSlicer or Bambu/Orca container), renames the painted-triangle attributes
// into the spelling Orca's project reader looks for, rebuilds the project settings
// for the U1, lays out copies and writes a new archive.
//
// What is deliberately absent compared with the desktop version: it cannot run
// Orca to verify a plate slices (that is a desktop app), and it cannot read the
// profiles installed on your machine, so the settings come from a bundled U1
// project rather than your own Orca version.

import { BASE_SETTINGS } from "./base_settings.js";

export const TARGET_SLOTS = 4;
export const DEFAULT_MACHINE = "Snapmaker U1 (0.4 nozzle)";
export const DEFAULT_PROCESS = "0.20mm Standard @Snapmaker U1 (0.4 nozzle)";
export const DEFAULT_FILAMENT = "Snapmaker PLA Basic @U1";

export const FILAMENT_PRESETS = [
  "Snapmaker PLA Basic @U1",
  "Snapmaker PLA SnapSpeed @U1",
  "Snapmaker PLA Matte @U1",
  "Snapmaker PLA Silk @U1",
  "Snapmaker PETG HF @U1 0.4 nozzle",
  "Snapmaker ABS @U1 0.4 nozzle",
  "Snapmaker ASA @U1 0.4 nozzle",
  "Snapmaker TPU 95A HF @U1 0.4 nozzle",
  "Snapmaker PA-CF @U1",
  "Snapmaker Support For PLA @U1 0.4 nozzle",
  "Generic PLA",
  "Generic PETG",
];

export const PROCESS_PRESETS = [
  "0.20mm Standard @Snapmaker U1 (0.4 nozzle)",
  "0.16mm Optimal @Snapmaker U1 (0.4 nozzle)",
  "0.12mm Fine @Snapmaker U1 (0.4 nozzle)",
  "0.24mm Draft @Snapmaker U1 (0.4 nozzle)",
  "0.28mm Extra Draft @Snapmaker U1 (0.4 nozzle)",
];

export const MATERIALS = [
  "PLA", "PETG", "ABS", "ASA", "PLA-CF", "PETG-CF", "PC", "PA", "PA-CF",
  "TPU", "PVA", "Support For PLA",
];

const MODEL_FILE = "3D/3dmodel.model";
const MODEL_RELS = "3D/_rels/3dmodel.model.rels";
const OBJECTS_DIR = "3D/Objects/";
const SRC_PRUSA_MODEL = "Metadata/Slic3r_PE_model.config";
const SRC_PRUSA_PRINT = "Metadata/Slic3r_PE.config";
const SRC_BBL_PROJECT = "Metadata/project_settings.config";
const SRC_BBL_MODEL = "Metadata/model_settings.config";
const OUT_OBJECT_ID = 5;

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// painted-triangle bitstream
//
// One node per original triangle, least-significant bit first:
//   2 bits : number of split sides (0 = leaf triangle)
//   leaf 0..2  : 2 more bits holding the state
//   leaf 3..17 : prefix 0b11 then a nibble holding state-3
// The stream is written as a hex literal whose value read low-bit-first *is* the
// bit stream, so the first four stream bits are simply the last hex digit and the
// next four are the one before it.
// ---------------------------------------------------------------------------

export function decodeLeafState(text) {
  if (!text || !/^[0-9A-Fa-f]+$/.test(text)) return 0;
  const code = parseInt(text.slice(-1), 16);
  if (code & 0b11) return 0;                       // split triangle
  if ((code & 0b1100) !== 0b1100) return code >> 2;
  if (text.length < 2) return 0;
  const nib = parseInt(text.slice(-2, -1), 16);
  if (nib === 0b1111) return 0;                    // state >= 18, two-nibble form
  return 3 + nib;
}

export function encodeLeafState(state) {
  const bits = [0, 0];
  if (state < 3) {
    bits.push(state & 1, (state >> 1) & 1);
  } else {
    bits.push(1, 1);
    for (let i = 0; i < 4; i++) bits.push(((state - 3) >> i) & 1);
  }
  let value = 0;
  bits.forEach((b, i) => { if (b) value |= 1 << i; });
  const digits = Math.max(1, bits.length / 4);
  return value.toString(16).toUpperCase().padStart(digits, "0");
}

// ---------------------------------------------------------------------------
// matrices -- internal form is a 4x4 row matrix, point' = point * M
// ---------------------------------------------------------------------------

export function matrixFromText(text) {
  const v = text.trim().split(/\s+/).map(Number);
  if (v.length === 12) {
    // 3MF <item>/<component> transform: 4x3, translation in the LAST ROW
    return [[v[0], v[1], v[2], 0], [v[3], v[4], v[5], 0],
            [v[6], v[7], v[8], 0], [v[9], v[10], v[11], 1]];
  }
  if (v.length === 16) {
    // PrusaSlicer/Bambu 'matrix' metadata: 4x4, translation in the LAST COLUMN,
    // i.e. the conventional p' = M * p form, so take the transpose
    const rows = [v.slice(0, 4), v.slice(4, 8), v.slice(8, 12), v.slice(12, 16)];
    return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => rows[c][r]));
  }
  throw new Error(`unsupported transform (${v.length} numbers)`);
}

export function matmul(a, b) {
  return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) =>
    a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + a[i][3] * b[3][j]));
}

export function applyMatrix(m, p) {
  const [x, y, z] = p;
  return [
    x * m[0][0] + y * m[1][0] + z * m[2][0] + m[3][0],
    x * m[0][1] + y * m[1][1] + z * m[2][1] + m[3][1],
    x * m[0][2] + y * m[1][2] + z * m[2][2] + m[3][2],
  ];
}

export function worldAabb(m, lo, hi) {
  const corners = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
    corners.push(applyMatrix(m, [x, y, z]));
  }
  const loOut = [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i])));
  const hiOut = [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i])));
  return [loOut, hiOut];
}

export function transformText(m) {
  return [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2],
          m[2][0], m[2][1], m[2][2], m[3][0], m[3][1], m[3][2]]
    .map((v) => Number(v.toPrecision(9)).toString()).join(" ");
}

// ---------------------------------------------------------------------------
// source parsing
// ---------------------------------------------------------------------------

export function normColor(color) {
  let c = String(color || "").trim().replace(/^#/, "").toUpperCase();
  if (c.length === 8) c = c.slice(0, 6);
  if (!/^[0-9A-F]{6}$/.test(c)) return "";
  return "#" + c;
}

function parsePrusaIni(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^;\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const splitList = (value) => String(value || "").split(";").map((s) => s.trim());

function firstScalar(cfg, key, fallback = undefined) {
  let v = cfg[key];
  if (Array.isArray(v)) v = v.length ? v[0] : fallback;
  return v === undefined ? fallback : v;
}

const asFloat = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function extractMeshBlock(text) {
  const open = text.search(/<mesh[>\s]/);
  if (open < 0) return null;
  const bodyFrom = text.indexOf(">", open) + 1;
  const close = text.indexOf("</mesh>", bodyFrom);
  if (close < 0) return null;
  return text.slice(bodyFrom, close);
}

function locateMesh(entries) {
  const main = entries.get(MODEL_FILE);
  if (!main) throw new Error("not a 3MF archive (3D/3dmodel.model is missing)");
  if (/<mesh[>\s]/.test(decoder.decode(main))) return MODEL_FILE;
  const candidates = [];
  for (const name of entries.keys()) {
    if (!name.startsWith(OBJECTS_DIR) || !name.endsWith(".model")) continue;
    if (/<mesh[>\s]/.test(decoder.decode(entries.get(name)))) candidates.push(name);
  }
  if (candidates.length === 0) throw new Error("no triangle mesh found in the archive");
  if (candidates.length > 1) {
    throw new Error(`the archive holds ${candidates.length} meshes; only single-object ` +
                    "models are supported");
  }
  return candidates[0];
}

function scanMesh(text) {
  const out = { states: new Map(), painted: 0, undecodable: 0, supports: false, transform: null };
  const item = /<item\b[^>]*transform="([^"]*)"/.exec(text);
  if (item) out.transform = item[1];

  const paint = /(?:slic3rpe:)?mmu_segmentation="([0-9A-Fa-f]*)"|paint_color="([0-9A-Fa-f]*)"/g;
  let m;
  while ((m = paint.exec(text)) !== null) {
    const raw = m[1] || m[2] || "";
    if (!raw) continue;
    out.painted++;
    const state = decodeLeafState(raw);
    if (state) out.states.set(state, (out.states.get(state) || 0) + 1);
    else out.undecodable++;
  }
  out.supports = /(?:slic3rpe:)?custom_supports="|paint_supports="/.test(text);
  return out;
}

function prusaSupport(cfg) {
  const raw = String(cfg.support_material || "").trim().toLowerCase();
  if (!["0", "1", "true", "false"].includes(raw)) return null;
  const style = String(cfg.support_material_style || "").trim().toLowerCase();
  const auto = !["0", "false"].includes(
    String(cfg.support_material_auto === undefined ? "1" : cfg.support_material_auto)
      .trim().toLowerCase());
  const angle = asFloat(cfg.support_material_threshold || 0);
  return {
    enabled: raw === "1" || raw === "true",
    type: `${["organic", "tree"].includes(style) ? "tree" : "normal"}` +
          `(${auto ? "auto" : "manual"})`,
    angle: angle && angle > 0 ? angle : null,
  };
}

function bambuSupport(cfg) {
  const raw = firstScalar(cfg, "enable_support");
  if (raw === undefined || raw === null) return null;
  const type = firstScalar(cfg, "support_type");
  const angle = asFloat(firstScalar(cfg, "support_threshold_angle"));
  return {
    enabled: ["1", "true"].includes(String(raw).trim().toLowerCase()),
    type: type ? String(type) : null,
    angle: angle && angle > 0 ? angle : null,
  };
}

export function readSource(entries) {
  const has = (n) => entries.has(n);
  const src = {
    kind: "plain", colors: [], types: [], paletteCount: 0, paletteSource: "",
    baseExtruder: 1, usedExtruders: new Set(), support: null, objectName: "object",
    sourceFile: "", volumeMatrix: null, paintStates: new Map(), painted: 0,
    undecodable: 0, subdivided: 0, hasSupports: false, meshBounds: null, meshFile: null,
    preview: null, previewFrom: "", plateObjects: 0,
    placement: null, buildTransform: "1 0 0 0 1 0 0 0 1 0 0 0",
  };

  let prusaCfg = null;
  if (has(SRC_PRUSA_MODEL)) {
    src.kind = "prusa";
    prusaCfg = parsePrusaIni(decoder.decode(entries.get(SRC_PRUSA_PRINT)));
    const tool = splitList(prusaCfg.extruder_colour).map(normColor);
    const fil = splitList(prusaCfg.filament_colour).map(normColor);
    const types = splitList(prusaCfg.filament_type).map((t) => t.toUpperCase());
    const uniform = (cols) => new Set(cols.filter(Boolean)).size <= 1;
    let palette, why;
    if (tool.length && !uniform(tool)) { palette = tool; why = "extruder_colour"; }
    else if (fil.length && !uniform(fil)) { palette = fil; why = "filament_colour"; }
    else { palette = tool.length ? tool : (fil.length ? fil : ["#FFFFFF"]); why = "fallback"; }
    src.colors = palette;
    src.paletteSource = why;
    src.types = types.length ? types : palette.map(() => "PLA");
    src.paletteCount = Math.max(src.colors.length, src.types.length);
    src.support = prusaSupport(prusaCfg);

    const blob = decoder.decode(entries.get(SRC_PRUSA_MODEL));
    const objects = blob.match(/<object\b[^>]*>[\s\S]*?<\/object>/g) || [];
    if (objects.length !== 1) {
      throw new Error(`the project holds ${objects.length} objects; only single-object ` +
                      "PrusaSlicer projects are supported");
    }
    const body = objects[0];
    const name = /key="name"\s+value="([^"]*)"/.exec(body);
    const ext = /<metadata type="object" key="extruder" value="(\d+)"/.exec(body);
    src.objectName = name ? name[1].replace(/\.[^.]+$/, "") : "object";
    src.baseExtruder = ext ? Number(ext[1]) : 1;
    const volumes = body.match(/<volume\b[^>]*>[\s\S]*?<\/volume>/g) || [];
    if (volumes.length > 1) {
      throw new Error(`the object holds ${volumes.length} volumes; only single-volume ` +
                      "objects are supported");
    }
    if (volumes.length) {
      const f = /key="source_file"\s+value="([^"]*)"/.exec(volumes[0]);
      if (f) src.sourceFile = f[1];
      const mat = /key="matrix"\s+value="([^"]*)"/.exec(volumes[0]);
      if (mat) {
        try { src.volumeMatrix = matrixFromText(mat[1]); } catch { /* leave identity */ }
      }
    }
  } else if (has(SRC_BBL_PROJECT)) {
    src.kind = "bambu";
    const cfg = JSON.parse(decoder.decode(entries.get(SRC_BBL_PROJECT)));
    src.colors = (cfg.filament_colour || []).map(normColor);
    src.types = (cfg.filament_type || []).map((t) => String(t).toUpperCase());
    src.paletteCount = Math.max(src.colors.length, src.types.length);
    src.support = bambuSupport(cfg);
    if (has(SRC_BBL_MODEL)) {
      const blob = decoder.decode(entries.get(SRC_BBL_MODEL));
      const name = /key="name"\s+value="([^"]*)"/.exec(blob);
      if (name) src.objectName = name[1].replace(/\.[^.]+$/, "");
      // the object's own extruder: search inside the object block rather than
      // requiring it to be the first metadata, since Orca writes "name" first
      const block = /<object\b[^>]*>[\s\S]*?<\/object>/.exec(blob);
      if (block) {
        const ext = /key="extruder"\s+value="(\d+)"/.exec(block[0]);
        if (ext) src.baseExtruder = Number(ext[1]);
      }
      const used = [...blob.matchAll(/key="extruder" value="(\d+)"/g)]
        .map((m) => Number(m[1]));
      src.usedExtruders = new Set(used.filter((u) => u >= 1));
    }
  } else if (has(MODEL_FILE)) {
    src.colors = ["#FFFFFF"];
    src.types = ["PLA"];
    src.paletteCount = 1;
  } else {
    throw new Error("not a 3MF archive (3D/3dmodel.model is missing)");
  }

  src.meshFile = locateMesh(entries);
  const meshText = decoder.decode(entries.get(src.meshFile));
  const scan = scanMesh(meshText);
  src.paintStates = scan.states;
  src.painted = scan.painted;
  src.undecodable = scan.undecodable;
  src.subdivided = scan.undecodable;
  src.hasSupports = scan.supports;
  if (scan.transform) src.buildTransform = scan.transform;
  // Bambu projects keep the mesh in 3D/Objects/*.model and the <item> that places
  // it in 3dmodel.model, so the transform has to come from the main document
  if (src.meshFile !== MODEL_FILE) {
    const mainScan = scanMesh(decoder.decode(entries.get(MODEL_FILE)));
    if (mainScan.transform) src.buildTransform = mainScan.transform;
  }

  src.placement = sourcePlacement(entries, src);
  // vertex bounds, for the plate layout
  const body = extractMeshBlock(meshText);
  if (body) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const re = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      for (let i = 0; i < 3; i++) {
        const v = Number(m[i + 1]);
        if (v < lo[i]) lo[i] = v;
        if (v > hi[i]) hi[i] = v;
      }
    }
    if (lo[0] !== Infinity) src.meshBounds = [lo, hi];
  }
  /* Preview image, so the output shows a thumbnail in Explorer and Orca rather
     than a generic icon. Prefer the plate render Bambu/Orca write, and fall back
     to PrusaSlicer's model thumbnail. */
  for (const n of ["Metadata/plate_1.png", "Metadata/thumbnail.png",
                   "Metadata/top_1.png"]) {
    if (entries.has(n)) { src.preview = entries.get(n); src.previewFrom = n; break; }
  }
  return src;
}

function sourcePlacement(entries, src) {
  const item = matrixFromText(src.buildTransform);
  if (src.kind === "prusa") {
    return matmul(src.volumeMatrix || [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
                  item);
  }
  // <item> and <component> live in the main model document, not the mesh file
  const doc = decoder.decode(entries.get(MODEL_FILE));
  const items = doc.match(/<item\b[^>]*>/g) || [];
  if (!items.length) throw new Error("the project has no objects on the plate");

  const meshOf = new Map();
  for (const om of doc.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = /id="([^"]*)"/.exec(om[1])?.[1];
    const comps = om[2].match(/<component\b[^>]*>/g) || [];
    meshOf.set(id, comps.length ? (/p:path="([^"]*)"/.exec(comps[0])?.[1] ?? null) : null);
  }
  /* A plate of several objects is fine as long as they are all the same mesh: that
     is a MakerWorld-style download, or a plate someone arranged and saved. The first
     placement carries the scale and orientation and the rest are rebuilt from the
     copies/spacing controls, so the result matches the single-object path. Several
     *different* models still cannot be handled. */
  const paths = new Set(items.map((it) => meshOf.get(/objectid="([^"]*)"/.exec(it)?.[1])));
  if (paths.size > 1 || paths.has(undefined) || paths.has(null)) {
    throw new Error(`the project places ${items.length} objects on the plate and ` +
      "they are not all the same model; only plates built from one repeated mesh " +
      "are supported");
  }
  src.plateObjects = items.length;

  const objId = /objectid="([^"]*)"/.exec(items[0]);
  const itemTf = /transform="([^"]*)"/.exec(items[0]);
  let compTf = null;
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = objRe.exec(doc)) !== null) {
    if (/id="([^"]*)"/.exec(m[1])?.[1] === objId?.[1]) {
      const comps = m[2].match(/<component\b[^>]*>/g) || [];
      if (comps.length !== 1) {
        throw new Error(`the object is built from ${comps.length} component(s); only ` +
                        "single-part objects are supported");
      }
      compTf = /transform="([^"]*)"/.exec(comps[0]);
      break;
    }
  }
  let partTf = null;
  if (entries.has(SRC_BBL_MODEL)) {
    const ms = decoder.decode(entries.get(SRC_BBL_MODEL));
    while ((m = objRe.exec(ms)) !== null) {
      if (/id="([^"]*)"/.exec(m[1])?.[1] === objId?.[1]) {
        const parts = m[2].match(/<part\b[^>]*>/g) || [];
        if (parts.length !== 1) {
          throw new Error(`the object has ${parts.length} parts; only single-part ` +
                          "objects are supported");
        }
        const mm = /key="matrix"\s+value="([^"]*)"/.exec(parts[0]) ||
                   /key="matrix"\s+value="([^"]*)"/.exec(m[2]);
        if (mm) partTf = mm[1];
        break;
      }
    }
  }
  let out = partTf ? matrixFromText(partTf)
    : [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  if (compTf) out = matmul(out, matrixFromText(compTf[1]));
  if (itemTf) out = matmul(out, matrixFromText(itemTf[1]));
  return out;
}

export function colorFor(src, extruder) {
  if (extruder >= 1 && extruder <= src.colors.length && src.colors[extruder - 1]) {
    return src.colors[extruder - 1];
  }
  return "#FFFFFF";
}

export function typeFor(src, extruder) {
  if (extruder >= 1 && extruder <= src.types.length && src.types[extruder - 1]) {
    return src.types[extruder - 1];
  }
  return "PLA";
}

export function planSlots(src) {
  const used = new Set([...src.usedExtruders, ...src.paintStates.keys(), src.baseExtruder]);
  if (src.undecodable > 0 && src.kind === "prusa") {
    for (let i = 1; i <= Math.min(src.paletteCount, TARGET_SLOTS); i++) used.add(i);
  }
  const list = [...used].filter((u) => u >= 1).sort((a, b) => a - b);
  if (!list.length) list.push(1);
  if (list.length > TARGET_SLOTS) {
    throw new Error(`the model uses ${list.length} extruders (${list}) but the U1 has ` +
                    `${TARGET_SLOTS}. Reduce the colours in a slicer first.`);
  }
  const mapping = new Map();
  list.forEach((e, i) => mapping.set(e, i + 1));
  return { ordered: list, mapping };
}

// ---------------------------------------------------------------------------
// supports
// ---------------------------------------------------------------------------

export function applySupport(cfg, support, mode = "auto", painted = false) {
  if (mode === "off") {
    cfg.enable_support = "0";
    return painted
      ? "supports off (asked for it) -- NOTE the model has painted support enforcers, " +
        "which do nothing with support off; Orca will warn about them"
      : "supports off (asked for it)";
  }
  if (mode === "on") {
    cfg.enable_support = "1";
    return `supports on, profile defaults: ${cfg.support_type} at ` +
           `${cfg.support_threshold_angle} degrees`;
  }
  if (support === null) {
    return "source had no support setting, left at the profile default " +
           `(enable_support=${cfg.enable_support})`;
  }
  if (!support.enabled) {
    if (painted) {
      cfg.enable_support = "1";
      return "supports enabled: the source has them off but carries painted support " +
             "enforcers, which are meaningless without support";
    }
    cfg.enable_support = "0";
    return "supports off (the source had them off)";
  }
  cfg.enable_support = "1";
  if (support.type) cfg.support_type = support.type;
  if (support.angle) cfg.support_threshold_angle = String(Math.round(support.angle));
  return `supports carried over: ${cfg.support_type} at ${cfg.support_threshold_angle} degrees`;
}

// ---------------------------------------------------------------------------
// project settings
// ---------------------------------------------------------------------------

export function buildProjectConfig(base, colors, types, filament, machine, process) {
  const cfg = { ...base };
  for (const key of Object.keys(cfg)) {
    if (Array.isArray(cfg[key])) cfg[key] = cfg[key].slice();
  }
  const perSlot = new Set(Object.keys(base)
    .filter((k) => Array.isArray(base[k]) && base[k].length === TARGET_SLOTS));

  const rgba = (c) => (normColor(c) || "#FFFFFF") + "FF";
  const pads = (arr, fill) => {
    const out = arr.slice(0, TARGET_SLOTS);
    while (out.length < TARGET_SLOTS) out.push(fill);
    return out;
  };
  cfg.filament_colour = pads(colors.map(rgba), "#FFFFFFFF");
  cfg.extruder_colour = pads(colors.map((c) => normColor(c) || "#FFFFFF"), "#FFFFFF");
  cfg.filament_type = pads(types.map((t) => String(t).toUpperCase()), "PLA");
  cfg.filament_settings_id = new Array(TARGET_SLOTS).fill(filament);
  cfg.printer_settings_id = machine;
  cfg.printer_model = "Snapmaker U1";
  cfg.printer_variant = "0.4";
  cfg.nozzle_diameter = new Array(TARGET_SLOTS).fill("0.4");
  cfg.print_settings_id = process;
  cfg.from = "project";

  for (const key of Object.keys(cfg)) {
    const v = cfg[key];
    if (!perSlot.has(key) || !Array.isArray(v) || v.length === TARGET_SLOTS) continue;
    if (v.length === 1) cfg[key] = new Array(TARGET_SLOTS).fill(v[0]);
    else {
      const out = v.slice(0, TARGET_SLOTS);
      while (out.length < TARGET_SLOTS) out.push(v[v.length - 1]);
      cfg[key] = out;
    }
  }

  // The bundled baseline used a different filament profile for slot 1 than for
  // slots 2-4 (SnapSpeed vs Basic). Since one profile is chosen for all four here,
  // flatten the remaining per-slot filament numbers onto the last slot so the four
  // are consistent -- otherwise slot 1 keeps a stray flow ratio and density that
  // belong to a profile the file no longer claims to use.
  const explicit = new Set(["filament_colour", "filament_type", "filament_settings_id"]);
  for (const key of Object.keys(cfg)) {
    if (!key.startsWith("filament_") || explicit.has(key)) continue;
    const v = cfg[key];
    if (Array.isArray(v) && v.length === TARGET_SLOTS && new Set(v.map(String)).size > 1) {
      cfg[key] = new Array(TARGET_SLOTS).fill(v[TARGET_SLOTS - 1]);
    }
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// plate layout
// ---------------------------------------------------------------------------

export function printableBounds(cfg) {
  const area = cfg.printable_area || ["0.5x1", "270.5x1", "270.5x271", "0.5x271"];
  const xs = [], ys = [];
  for (const p of area) {
    const [x, y] = String(p).split("x").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  if (!xs.length) return [0.5, 270.5, 1, 271];
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

function brimAllowance(cfg) {
  const type = String(firstScalar(cfg, "brim_type", "")).trim().toLowerCase();
  if (!type || ["no_brim", "none"].includes(type)) return 0;
  return Math.max(0, asFloat(firstScalar(cfg, "brim_width", 0)) || 0);
}

// Measured against a real slice: with prime_tower_width 30, brim 5 and the tower
// anchored at (13, 211), the tower's first layer covers x 3.3..50.2, y 201.3..248.8.
const TOWER_ALLOWANCE = 8;
const TOWER_INSET = 5;

export function towerBox(cfg, margin = 4) {
  const enabled = String(firstScalar(cfg, "enable_prime_tower", "0")).trim();
  if (["", "0", "false"].includes(enabled.toLowerCase())) return null;
  const tx = asFloat(firstScalar(cfg, "wipe_tower_x"));
  const ty = asFloat(firstScalar(cfg, "wipe_tower_y"));
  if (tx === null || ty === null) return null;
  const width = asFloat(firstScalar(cfg, "prime_tower_width", 30)) || 30;
  const brim = asFloat(firstScalar(cfg, "prime_tower_brim_width", 5)) || 5;
  const inset = TOWER_INSET + brim;
  const size = width + 2 * brim + TOWER_ALLOWANCE + 2 * margin;
  const x0 = tx - inset - margin;
  const y0 = ty - inset - margin;
  return [x0, x0 + size, y0, y0 + size];
}

function placeOnBed(transform, bounds, cfg, enabled) {
  if (!enabled || !bounds) return [transform, false];
  const [wlo, whi] = worldAabb(transform, bounds[0], bounds[1]);
  const [ax0, ax1, ay0, ay1] = printableBounds(cfg);
  if (wlo[0] >= ax0 - 1e-6 && whi[0] <= ax1 + 1e-6 &&
      wlo[1] >= ay0 - 1e-6 && whi[1] <= ay1 + 1e-6 && wlo[2] >= -1e-3) {
    return [transform, false];
  }
  const moved = transform.map((r) => r.slice());
  moved[3][0] += (ax0 + ax1) / 2 - (wlo[0] + whi[0]) / 2;
  moved[3][1] += (ay0 + ay1) / 2 - (wlo[1] + whi[1]) / 2;
  moved[3][2] += -wlo[2];
  return [moved, true];
}

export function layoutCopies(transform, bounds, cfg, reposition, copies, gap,
                             avoidTower = true) {
  const [base] = placeOnBed(transform, bounds, cfg, reposition);
  if (!bounds) return { transforms: [base], cols: 1, rows: 1, capacity: 1 };

  const [ax0, ax1, ay0, ay1] = printableBounds(cfg);
  const bedW = ax1 - ax0, bedH = ay1 - ay0;
  const [wlo, whi] = worldAabb(base, bounds[0], bounds[1]);
  const sx = Math.max(whi[0] - wlo[0], 1e-3);
  const sy = Math.max(whi[1] - wlo[1], 1e-3);

  gap = Math.max(0, Number(gap) || 0);
  const cols = Math.max(1, Math.floor((bedW + gap) / (sx + gap)));
  const rows = Math.max(1, Math.floor((bedH + gap) / (sy + gap)));
  const blockW = cols * sx + (cols - 1) * gap;
  const blockH = rows * sy + (rows - 1) * gap;

  const box = avoidTower ? towerBox(cfg) : null;
  const pad = brimAllowance(cfg) + 1;

  const clashes = (ox, oy) => {
    if (ox - pad < ax0 - 1e-6 || ox + blockW + pad > ax1 + 1e-6 ||
        oy - pad < ay0 - 1e-6 || oy + blockH + pad > ay1 + 1e-6) return null;
    if (!box) return 0;
    const [bx0, bx1, by0, by1] = box;
    let bad = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = ox + i * (sx + gap);
        const y = oy + j * (sy + gap);
        const clear = x + sx + pad <= bx0 || x - pad >= bx1 ||
                      y + sy + pad <= by0 || y - pad >= by1;
        if (!clear) bad++;
      }
    }
    return bad;
  };

  let originX = ax0 + Math.max(0, (bedW - blockW) / 2);
  let originY = ay0 + Math.max(0, (bedH - blockH) / 2);

  // Slide the block aside to clear the tower rather than deleting copies. A
  // hand-made 12-up plate for this model does exactly that.
  if (box && clashes(originX, originY)) {
    let best = null;
    const step = 1;
    const nx = Math.floor(Math.max(0, bedW - blockW - 2 * pad) / step);
    const ny = Math.floor(Math.max(0, bedH - blockH - 2 * pad) / step);
    for (let jy = 0; jy <= ny; jy++) {
      const oy = ay0 + pad + jy * step;
      for (let ix = 0; ix <= nx; ix++) {
        const ox = ax0 + pad + ix * step;
        const bad = clashes(ox, oy);
        if (bad === null) continue;
        const off = Math.abs(ox + blockW / 2 - (ax0 + ax1) / 2) +
                    Math.abs(oy + blockH / 2 - (ay0 + ay1) / 2);
        if (!best || bad < best.bad || (bad === best.bad && off < best.off)) {
          best = { bad, off, ox, oy };
        }
      }
    }
    if (best && best.bad < clashes(originX, originY)) {
      originX = best.ox;
      originY = best.oy;
    }
  }

  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = originX + i * (sx + gap);
      const y = originY + j * (sy + gap);
      if (box) {
        const [bx0, bx1, by0, by1] = box;
        const clear = x + sx + pad <= bx0 || x - pad >= bx1 ||
                      y + sy + pad <= by0 || y - pad >= by1;
        if (!clear) continue;
      }
      cells.push([i, j]);
    }
  }

  const capacity = Math.max(1, cells.length);
  const n = Math.max(1, Math.min(Number(copies) || 1, capacity));
  if (n <= 1) return { transforms: [base], cols: 1, rows: 1, capacity };

  const used = cells.slice(0, n);
  const transforms = used.map(([i, j]) => {
    const t = base.map((r) => r.slice());
    t[3][0] += originX + i * (sx + gap) - wlo[0];
    t[3][1] += originY + j * (sy + gap) - wlo[1];
    return t;
  });
  const imax = Math.max(...used.map(([i]) => i));
  const jmax = Math.max(...used.map(([, j]) => j));
  return { transforms, cols: imax + 1, rows: jmax + 1, capacity };
}

export function plateInputs(src, options = {}) {
  const { ordered, mapping } = planSlots(src);
  const cfg = buildProjectConfig(
    BASE_SETTINGS,
    ordered.map((e) => colorFor(src, e)),
    ordered.map((e) => typeFor(src, e)),
    options.filament || DEFAULT_FILAMENT,
    options.machine || DEFAULT_MACHINE,
    options.process || DEFAULT_PROCESS,
  );
  const note = applySupport(cfg, src.support, options.supports || "auto", src.hasSupports);
  return { cfg, mapping, ordered, note, placement: src.placement, bounds: src.meshBounds };
}

export function plateCapacity(src, gap = 5, avoidTower = true, options = {}) {
  const { cfg, placement, bounds } = plateInputs(src, options);
  return layoutCopies(placement, bounds, cfg, true, 1e6, gap, avoidTower).capacity;
}

export function describe(src, options = {}) {
  const { ordered, mapping } = planSlots(src);
  const { cfg, note } = plateInputs(src, options);
  let footprint = { x: 0, y: 0, z: 0 };
  let capacity = 1;
  if (src.meshBounds) {
    const [wlo, whi] = worldAabb(src.placement, src.meshBounds[0], src.meshBounds[1]);
    footprint = {
      x: +(whi[0] - wlo[0]).toFixed(2),
      y: +(whi[1] - wlo[1]).toFixed(2),
      z: +(whi[2] - wlo[2]).toFixed(2),
    };
    capacity = layoutCopies(src.placement, src.meshBounds, cfg, true, 1e6,
                            options.gap ?? 5, true).capacity;
  }
  const [ax0, ax1, ay0, ay1] = printableBounds(cfg);
  return {
    kind: src.kind,
    object: src.objectName,
    sourceFile: src.sourceFile,
    paletteSource: src.paletteSource,
    filamentsInSource: src.paletteCount,
    paintedTriangles: src.painted,
    subdividedTriangles: src.subdivided,
    supportsPainted: src.hasSupports,
    support: src.support,
    supportNote: note,
    footprint,
    capacity,
    bed: { x: +(ax1 - ax0).toFixed(2), y: +(ay1 - ay0).toFixed(2) },
    slots: ordered.map((e) => ({
      slot: mapping.get(e),
      sourceExtruder: e,
      color: colorFor(src, e),
      type: typeFor(src, e),
      paintedTriangles: src.paintStates.get(e) || 0,
      isBase: e === src.baseExtruder,
    })),
  };
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const uuid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2).padEnd(12, "0"));

const CONTENT_TYPES = XML_HEADER +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
  ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
  ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
  ' <Default Extension="png" ContentType="image/png"/>\n' +
  ' <Default Extension="gcode" ContentType="text/x.gcode"/>\n' +
  "</Types>\n";

const ROOT_RELS = XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
  ` <Relationship Target="/${MODEL_FILE}" Id="rel-1" ` +
  'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
  "</Relationships>\n";

const modelRels = (objectFile) => XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
  ` <Relationship Target="/${objectFile}" Id="rel-1" ` +
  'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
  "</Relationships>\n";

const SLICE_INFO = XML_HEADER +
  "<config>\n  <header>\n" +
  '    <header_item key="X-BBL-Client-Type" value="slicer"/>\n' +
  '    <header_item key="X-BBL-Client-Version" value=""/>\n' +
  "  </header>\n</config>\n";

const OBJECT_OPEN = XML_HEADER +
  '<model unit="millimeter" xml:lang="en-US" ' +
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ' +
  'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" ' +
  'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ' +
  'requiredextensions="p">\n' +
  ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
  " <resources>\n" +
  `  <object id="1" p:UUID="${uuid()}" type="model">\n   <mesh>\n`;

const OBJECT_CLOSE = "   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n";

// One <object> per copy, all sharing the same mesh -- what Orca itself produces
// when you copy a model.
function mainModelXml(objectFile, title, transforms) {
  const n = Math.max(1, transforms.length);
  let resources = "";
  for (let k = 0; k < n; k++) {
    resources += `  <object id="${OUT_OBJECT_ID + k}" p:UUID="${uuid()}" type="model">\n` +
      "   <components>\n" +
      `    <component p:path="/${esc(objectFile)}" objectid="1" ` +
      `p:UUID="${uuid()}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n` +
      "   </components>\n  </object>\n";
  }
  let items = "";
  transforms.forEach((tf, k) => {
    items += `  <item objectid="${OUT_OBJECT_ID + k}" p:UUID="${uuid()}" ` +
             `transform="${tf}" printable="1"/>\n`;
  });
  return XML_HEADER +
    '<model unit="millimeter" xml:lang="en-US" ' +
    'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ' +
    'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" ' +
    'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ' +
    'requiredextensions="p">\n' +
    ' <metadata name="Application">Snapmaker Orca</metadata>\n' +
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
    ` <metadata name="Title">${esc(title)}</metadata>\n` +
    " <resources>\n" + resources + " </resources>\n" +
    ` <build p:UUID="${uuid()}">\n` + items + " </build>\n</model>\n";
}

function modelSettingsXml(name, extruder, sourceFile, count) {
  let out = XML_HEADER + "<config>\n";
  for (let k = 0; k < Math.max(1, count); k++) {
    out += `  <object id="${OUT_OBJECT_ID + k}">\n` +
      `    <metadata key="name" value="${esc(name)}"/>\n` +
      `    <metadata key="extruder" value="${extruder}"/>\n` +
      '    <part id="1" subtype="normal_part">\n' +
      `      <metadata key="name" value="${esc(sourceFile || name + ".stl")}"/>\n` +
      '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
      `      <metadata key="source_file" value="${esc(sourceFile || name)}"/>\n` +
      '      <metadata key="source_object_id" value="0"/>\n' +
      '      <metadata key="source_volume_id" value="0"/>\n' +
      `      <metadata key="extruder" value="${extruder}"/>\n` +
      '      <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" ' +
      'facets_reversed="0" backwards_edges="0"/>\n' +
      "    </part>\n  </object>\n";
  }
  return out + "</config>\n";
}

// Prusa attribute name -> Bambu/Orca attribute name. The bitstream is identical;
// only the name differs, which is the whole reason a conversion is needed.
const PAINT_ATTRS = {
  mmu_segmentation: "paint_color",
  custom_supports: "paint_supports",
  custom_seam: "paint_seam",
  fuzzy_skin: "paint_fuzzy_skin",
};

/**
 * Rewrite the mesh body in one pass: rename the paint attributes into the spelling
 * Orca's project reader uses, and collect the vertex bounds on the way.
 */
function rewriteMesh(body, mapping) {
  const remap = new Map();
  for (const [from, to] of mapping) if (from !== to) remap.set(from, to);

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;

  const re = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"|<triangle\b|(?:slic3rpe:)?(mmu_segmentation)="([0-9A-Fa-f]*)"|slic3rpe:(custom_supports|custom_seam|fuzzy_skin)="/g;

  const text = body.replace(re, (match, vx, vy, vz, paintName, paint, other) => {
    if (vx !== undefined) {
      const vals = [+vx, +vy, +vz];
      for (let i = 0; i < 3; i++) {
        if (vals[i] < lo[i]) lo[i] = vals[i];
        if (vals[i] > hi[i]) hi[i] = vals[i];
      }
      return match;
    }
    if (paintName) {
      let value = paint;
      if (remap.size) {
        const state = decodeLeafState(paint);
        if (remap.has(state)) value = encodeLeafState(remap.get(state));
      }
      return `${PAINT_ATTRS.mmu_segmentation}="${value}"`;
    }
    if (other) return `${PAINT_ATTRS[other]}="`;
    if (match === "<triangle") triangles++;
    return match;
  });

  return {
    text,
    bounds: lo[0] === Infinity ? null : [lo, hi],
    triangles,
  };
}

/**
 * Convert an archive.
 *
 * entries : Map of name -> Uint8Array (from readZip)
 * options : { copies, gap, avoidTower, supports, colors, types, filament,
 *             process, machine, reposition, log }
 * returns : { items: [{name, data}], log: string[], info }
 */
export async function convert(entries, options = {}) {
  const log = [];
  const say = (line) => { log.push(line); options.log?.(line); };

  const src = readSource(entries);
  const { ordered, mapping } = planSlots(src);
  const colors = ordered.map((e) => colorFor(src, e));
  const types = ordered.map((e) => typeFor(src, e));
  // the UI sends one colour/type per slot it showed, aligned to `ordered`
  if (Array.isArray(options.colors)) {
    options.colors.forEach((c, i) => {
      if (i < colors.length && normColor(c)) colors[i] = normColor(c);
    });
  }
  if (Array.isArray(options.types)) {
    options.types.forEach((t, i) => {
      if (i < types.length && t) types[i] = String(t).toUpperCase();
    });
  }

  const filament = options.filament || DEFAULT_FILAMENT;
  const machine = options.machine || DEFAULT_MACHINE;
  const process = options.process || DEFAULT_PROCESS;

  const cfg = buildProjectConfig(BASE_SETTINGS, colors, types, filament, machine, process);
  const supportNote = applySupport(cfg, src.support, options.supports || "auto",
                                  src.hasSupports);

  say(`input        : ${src.kind === "bambu" ? "Bambu Studio / Orca" : "PrusaSlicer"} project`);
  say(`object       : ${src.objectName}  (${src.painted.toLocaleString()} painted triangles)`);
  if (src.plateObjects > 1) {
    say(`plate        : ${src.plateObjects} copies of that one model on the source ` +
        "plate; the original layout is dropped and rebuilt from the copies/spacing settings");
  }
  say("thumbnail    : " + (src.preview
    ? `carried over from ${src.previewFrom} (${Math.round(src.preview.length / 1024)} KB)`
    : "none in the source to carry over"));
  if (src.paintStates.size) {
    say("paint        : " + [...src.paintStates].sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `extruder ${k} on ${v.toLocaleString()} tris`).join(", "));
  }
  if (src.subdivided) say(`paint        : ${src.subdivided} sub-divided triangles copied through`);
  say("slots        : " + ordered.map((e) =>
    `${mapping.get(e)}<-${e} ${colorFor(src, e)}`).join(", "));
  say(`printer      : ${machine}`);
  say(`process      : ${process}  (bundled base settings)`);
  say(`filament     : ${filament}`);
  say("supports     : " + supportNote);

  const placement = src.placement;
  const gap = Math.max(0, Number(options.gap ?? 5) || 0);
  const avoidTower = options.avoidTower !== false;
  const requested = Math.max(1, Number(options.copies) || 1);
  const { transforms, cols, rows, capacity } = layoutCopies(
    placement, src.meshBounds, cfg, options.reposition !== false, requested, gap, avoidTower);

  // the mesh: rename the paint attributes and measure it in one pass
  const meshText = decoder.decode(entries.get(src.meshFile));
  const rawBody = extractMeshBlock(meshText);
  if (!rawBody) throw new Error("no <mesh> found in the source model file");
  // the body starts right after "<mesh>" and ends just before "</mesh>", so it
  // carries the newline and the closing tag's indentation with it; drop both so
  // the reassembled document matches the source's formatting exactly
  const body = rawBody.replace(/^\n/, "").replace(/[ \t]+$/, "");
  const rewritten = rewriteMesh(body, mapping);
  if (rewritten.bounds) src.meshBounds = rewritten.bounds;

  const objectFile = OBJECTS_DIR + src.objectName + ".model";
  const objectXml = OBJECT_OPEN + rewritten.text + OBJECT_CLOSE;
  const itemTransforms = transforms.map(transformText);

  say(`triangles    : ${rewritten.triangles.toLocaleString()}`);
  if (transforms.length > 1) {
    say(`copies       : ${transforms.length} (${cols} x ${rows} grid, ${gap} mm apart, ` +
        `plate holds ${capacity})`);
  } else if (capacity > 1) {
    say(`copies       : 1 (plate would hold ${capacity})`);
  }
  if (transforms.length > 1 && transforms.length < requested) {
    say(`note         : asked for ${requested}, only ${capacity} fit at this spacing`);
  }

  const items = [
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: MODEL_RELS, data: encoder.encode(modelRels(objectFile)) },
    { name: "Metadata/slice_info.config", data: encoder.encode(SLICE_INFO) },
    { name: "Metadata/model_settings.config", data: encoder.encode(
        modelSettingsXml(src.objectName, mapping.get(src.baseExtruder) || 1,
                         src.sourceFile, transforms.length)) },
    { name: SRC_BBL_PROJECT, data: encoder.encode(JSON.stringify(cfg, null, 4)) },
    /* Written under both names on purpose: Windows/PrusaSlicer look for
       thumbnail.png, Bambu Studio and Orca look for plate_1.png. */
    ...(src.preview ? [
      { name: "Metadata/thumbnail.png", data: src.preview },
      { name: "Metadata/plate_1.png", data: src.preview },
    ] : []),
    { name: objectFile, data: encoder.encode(objectXml) },
    { name: MODEL_FILE, data: encoder.encode(
        mainModelXml(objectFile, src.objectName, itemTransforms)) },
  ];

  return {
    items,
    log,
    info: {
      kind: src.kind,
      object: src.objectName,
      copies: transforms.length,
      capacity,
      cols,
      rows,
      colors,
      types,
      filament,
      process,
      machine,
      supportNote,
      painted: src.painted,
      triangles: rewritten.triangles,
    },
  };
}
