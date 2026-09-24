// Reading, assessing and rewriting a 3MF in the browser.
//
// This is the client-side counterpart of u1project.py: the same structures (an
// object graph that can point at other mesh members, per-part extruders in the
// project metadata, paint in `paint_color` / `mmu_segmentation`) and the same
// refusal to guess.  What it does *not* do is silently flatten a project it does
// not understand: an unresolvable component, a missing member or an unsupported
// paint value stops the export with a sentence the page can show.
//
// Geometry is never rebuilt.  Members are copied as text with the paint attribute
// remapped, exactly as the Python exporter streams them, so the triangles in the
// output are the source's own.

import { norm } from "./colour.js";
import * as paint from "./paint.js";
import { SLOTS, arrange, bijectionProblem, completeRule, isIdentity }
  from "./assignment.js";
import { COLOUR_NS, colourOf, colourGroupXml, leafTriangles, parseColourGroups } from "./standard.js";
import { relationshipXml, thumbnailPlan } from "./thumbnail.js";
import { SOURCE_KEYS, applySupport, carryPrintSettings, normaliseSupportMode, supportOf, transferSettings, planningAllowance, setProcessOverrides }
  from "./printSettings.js";
import { addBox, addPoint, boxSize, boxValid, emptyBox, layoutOffsets, planLayout,
         transformBox, targetLayout }
  from "./layout.js";
import {
  APPLICATION, BAMBU_ONLY_KEYS, MACHINE_KEYS, PAINT_ATTR, PRUSA_MODEL_CONFIG,
  PRUSA_SPECTRUM_JSON, SEAM_ATTR, SUPPORT_ATTR, TargetError,
  bambuConfig, check as checkRecipes, checkTypes, normalise as normaliseTarget,
  palette, prusaSpectrumJson, snapmakerConfig, virtualId,
} from "./targets.js";
import { readFilamentProfiles, applyFilamentProfiles, prusaFilamentConfig } from './filamentProfiles.js';
import { buildU1Profile, conservativeSpeeds, constrainLayers, resolveLayerHeight } from './u1Profiles.js';
import { BASE_SETTINGS } from "../base_settings.js";

export const SNAPMAKER_SPECTRUM_APPLICATION = "BambuStudio-2.3.5";
// The agnostic colour model is written by this tool and says so: no Bambu Studio
// version is invented, because the file carries no Bambu project settings.
export const OWN_APPLICATION = "yab3u1 2.3.0";
export const COLOUR_GROUP_ID = 1;

export const MODEL_FILE = "3D/3dmodel.model";
export const MODEL_RELS = "3D/_rels/3dmodel.model.rels";
export const OBJECTS_DIR = "3D/Objects/";
export const SRC_PRUSA_MODEL = "Metadata/Slic3r_PE_model.config";
export const SRC_PRUSA_PRINT = "Metadata/Slic3r_PE.config";
export const SRC_PRUSA_SPECTRUM = "Metadata/Prusa_Slicer_full_spectrum.json";
export const SRC_BBL_PROJECT = "Metadata/project_settings.config";
export const SRC_BBL_MODEL = "Metadata/model_settings.config";

export const MAX_SOURCE_BYTES = 96 * 1024 * 1024;
export const PREVIEW_TRIANGLE_CAP = 200000;
// Paint states are serialised with a two-bit escape; 16 is the highest id this
// writer can name without changing the encoding (see paint.js).
export const MAX_SOURCE_COLOURS = 16;

export class ProjectError extends Error {}

const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();

const text = (entries, name) => {
  const data = entries.get(name);
  return data ? decoder.decode(data) : null;
};

const attr = (tag, name) => {
  const match = new RegExp(`\\b${name.replace(/[:]/g, "[:]")}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
};

const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
const COMPONENT_RE = /<component\b([^>]*?)\/>/g;
const TRIANGLE_RE = /<triangle\b([^>]*?)\/>/g;
const VERTEX_RE = /<vertex x="([-0-9.eE+]+)" y="([-0-9.eE+]+)" z="([-0-9.eE+]+)"/g;
const PAINT_RE = /(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"/;

export function matrixFromText(value) {
  const text = String(value ?? "").trim();
  // No transform attribute at all is the identity: plenty of real files omit it.
  if (!text) return IDENTITY_MATRIX();
  const numbers = text.split(/\s+/).map(Number);
  if (numbers.length !== 12 || numbers.some((n) => !Number.isFinite(n))) {
    throw new ProjectError(`a transform is not 12 finite numbers: ${value}`);
  }
  return [
    [numbers[0], numbers[1], numbers[2], 0],
    [numbers[3], numbers[4], numbers[5], 0],
    [numbers[6], numbers[7], numbers[8], 0],
    [numbers[9], numbers[10], numbers[11], 1],
  ];
}

export const IDENTITY_MATRIX = () => [[1, 0, 0, 0], [0, 1, 0, 0],
                                      [0, 0, 1, 0], [0, 0, 0, 1]];

export function transformText(matrix) {
  const values = [
    matrix[0][0], matrix[0][1], matrix[0][2],
    matrix[1][0], matrix[1][1], matrix[1][2],
    matrix[2][0], matrix[2][1], matrix[2][2],
    matrix[3][0], matrix[3][1], matrix[3][2],
  ];
  return values.map((v) => Number(v.toFixed(9)).toString()).join(" ");
}

export function matmul(a, b) {
  const out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[i][k] * b[k][j];
      out[i][j] = sum;
    }
  }
  return out;
}

export function applyMatrix(m, point) {
  const [x, y, z] = point;
  return [
    x * m[0][0] + y * m[1][0] + z * m[2][0] + m[3][0],
    x * m[0][1] + y * m[1][1] + z * m[2][1] + m[3][1],
    x * m[0][2] + y * m[1][2] + z * m[2][2] + m[3][2],
  ];
}

// ---------------------------------------------------------------- reading ----

export function readProject(entries, options = {}) {
  const main = text(entries, MODEL_FILE);
  if (main === null) {
    throw new ProjectError("this archive has no 3D/3dmodel.model, so it is not a 3MF");
  }
  for (const [member, data] of entries) {
    if (member.endsWith(".model")) requireMillimetres(decoder.decode(data), member);
  }
  const project = {
    kind: "plain", title: "", colors: [], types: [], paletteSource: "",
    paletteCount: 0, objects: new Map(), items: [], plates: [], meta: new Map(),
    warnings: [], mixtures: { present: false, sources: [] }, entries, main,
  };
  const title = /<metadata name="Title" value="([^"]*)"/.exec(main);
  if (title) project.title = title[1];

  readPalette(entries, project);
  readObjects(project);
  readMeta(entries, project);
  readItems(project);
  // After the object graph, so a colour group declared in a *member* model is
  // found and the member's own facets can be normalised.
  readStandardColours(entries, project);
  readMixtures(entries, project);
  guessKind(project);
  if (project.kind === "prusa") refusePrusaVolumeRanges(project);
  refuseHiddenRoles(project, options.allowNegative === true);
  return project;
}

/** The converter preserves native negative parts. Other modifier roles still
 * require settings handling that this reader/writer does not provide. UI
 * callers must explain that the preview does not perform boolean subtraction. */
function refuseHiddenRoles(project, allowNegative = false) {
  for (const meta of project.meta.values()) {
    for (const part of meta.parts || []) {
      if (isHiddenPart(part.subtype)) {
        if (part.subtype === "negative_part") {
          if (allowNegative) continue;
          throw new ProjectError(`${meta.name || 'This model'} contains a negative cutout volume. Enable native negative-volume preservation to open it.`);
        }
        throw new ProjectError(`${meta.name || "an object"} has a `
          + `${part.subtype} volume (a negative, modifier or support-blocker part). `
          + "The settings and behaviour of this volume type cannot yet be carried across faithfully, so this project cannot be opened.");
      }
    }
  }
}

export function hasNegativeVolumes(project, objectIds = null) {
  return [...project.meta.values()].some(meta=>(!objectIds || objectIds.map(String).includes(String(meta.id)))
    && (meta.parts || []).some(part=>part.subtype==='negative_part'));
}

/** PrusaSlicer volumes are triangle ranges inside one mesh.
 *
 * This reader works in whole meshes: it cannot yet split one by range, so a
 * multi-volume object would be drawn -- and exported -- with every volume on the
 * object's own filament.  Refuse it here, exactly as the Python reader does,
 * before the page offers anything.
 */
function refusePrusaVolumeRanges(project) {
  for (const meta of project.meta.values()) {
    if (meta.parts.length > 1) {
      throw new ProjectError(`${meta.name || "an object"} is described by `
        + `${meta.parts.length} PrusaSlicer volumes; this tool reads whole meshes, `
        + "so their triangle-range filaments would be lost. Open it in PrusaSlicer "
        + "and save one volume, or split it into separate objects first");
    }
  }
}

function readPalette(entries, project) {
  const blob = text(entries, SRC_BBL_PROJECT);
  if (blob) {
    let cfg;
    try {
      cfg = JSON.parse(blob);
    } catch (error) {
      cfg = null;
    }
    if (cfg) {
      project.colors = (cfg.filament_colour || []).map((c) => norm(c));
      project.types = (cfg.filament_type || []).map((t) => String(t || "PLA"));
      project.paletteSource = "filament_colour";
      project.paletteCount = project.colors.length;
      // The narrow slice of source intent the optional preservation control may
      // carry into a printer-agnostic model: a layer height and the support
      // intent.  Nothing else -- no printer, process or filament settings.
      project.sourceSettings = pickleSourceSettings(cfg);
      project.sourcePrinter = String(cfg.printer_settings_id || cfg.printer_model || '').slice(0,200);
      project.filamentProfiles=readFilamentProfiles(cfg,project.types);
      return;
    }
  }
  const prusa = text(entries, SRC_PRUSA_PRINT);
  if (prusa) {
    // PrusaSlicer writes its config commented out (`; key = value`); a reader that
    // insists on the bare form sees a palette-less project.
    const read = (key) => {
      const match = new RegExp(`^\\s*;?\\s*${key}\\s*=\\s*(.*)$`, "m").exec(prusa);
      return match ? match[1].split(";").map((s) => s.trim()) : [];
    };
    const extruder = read("extruder_colour");
    const filament = read("filament_colour");
    const colours = extruder.length ? extruder : filament;
    if (colours.length) {
      project.colors = colours.map((c) => norm(c));
      project.types = read("filament_type").map((t) => t || "PLA");
      project.paletteSource = extruder.length ? "extruder_colour" : "filament_colour";
      project.paletteCount = project.colors.length;
      project.sourceSettings = picklePrusaSettings(read);
      project.sourcePrinter = read('printer_settings_id').join(';').slice(0,200);
      const fcfg=Object.fromEntries(['filament_settings_id','filament_vendor','temperature','first_layer_temperature','bed_temperature','first_layer_bed_temperature','extrusion_multiplier','filament_max_volumetric_speed','filament_density','filament_diameter'].map(k=>[k,read(k)]));
      project.filamentProfiles=readFilamentProfiles(fcfg,project.types);
      return;
    }
  }
  // A portable colour project (what this tool writes, and what PaintPort's format
  // notes describe) leaves Slic3r_PE.config out so it cannot override the user's
  // print preset.  Its palette is the Full Spectrum description: physical
  // extruders, then the virtual recipes, in extruder-id order.
  const spectrum = readFullSpectrum(entries, project);
  if (spectrum) return;
  project.colors = ["#FFFFFF"];
  project.types = ["PLA"];
  project.paletteSource = "default";
  project.paletteCount = 1;
}

/** The source's print intent and support decision, or null.
 *
 * The reviewed allowlist in printSettings.js is what a Snapmaker export may carry,
 * so the reader keeps those keys (and the PrusaSlicer spellings of them) alongside
 * the support vocabulary.  Everything about the printer, the process speeds and
 * the filaments stays out: the U1 profile's own values are right for a U1.
 */
function pickleSourceSettings(cfg) {
  const out = {};
  let found = false;
  for (const key of SOURCE_KEYS) {
    if (cfg[key] === undefined || cfg[key] === null || cfg[key] === "") continue;
    out[key] = cfg[key];
    found = true;
  }
  return found ? out : null;
}

/** The same narrow slice as read back from a PrusaSlicer print config. */
function picklePrusaSettings(read) {
  const settings = {};
  for (const key of SOURCE_KEYS) {
    const values = read(key);
    if (values.length && values[0] !== "") settings[key] = values[0];
  }
  return pickleSourceSettings(settings);
}

/** The palette of a portable Prusa project, or null when it is not readable. */
function readFullSpectrum(entries, project) {
  const blob = text(entries, SRC_PRUSA_SPECTRUM);
  if (blob === null) return null;
  const fail = (why) => {
    // The same stop the Python reader makes: white defaults would be a guess, and
    // a wrong colour is worse than a sentence the page can show.
    throw new ProjectError(`${SRC_PRUSA_SPECTRUM} could not be used (${why}), so `
      + "there is no palette to read this project's colours from");
  };
  let data;
  try {
    data = JSON.parse(blob);
  } catch (error) {
    return fail(`not JSON: ${error.message}`);
  }
  if (!data || typeof data !== "object") return fail("not an object");
  const entriesById = new Map();
  const all = [...(data.physical_extruders || []), ...(data.virtual_extruders || [])];
  for (const entry of all) {
    const id = Number(entry && entry.id);
    if (!Number.isInteger(id) || id < 1) {
      return fail("an extruder has no numeric id");
    }
    entriesById.set(id, entry);
  }
  const physical = (data.physical_extruders || []).length;
  if (!physical) return fail("it lists no physical extruders");
  const ids = [...entriesById.keys()].sort((a, b) => a - b);
  if (ids.length !== ids[ids.length - 1]
      || ids.some((value, index) => value !== index + 1)) {
    return fail(`its extruder ids are ${ids.join(",")} rather than 1..N`);
  }
  const typeOf = (entry) => {
    if (entry.type) return String(entry.type).toUpperCase();
    // A recipe carries no type of its own: it is made of physical filaments.
    for (const component of entry.components || []) {
      const source = entriesById.get(Number(component && component.extruder));
      if (source && source.type) return String(source.type).toUpperCase();
    }
    return "PLA";
  };
  project.colors = ids.map((id) => norm(entriesById.get(id).color));
  project.types = ids.map((id) => typeOf(entriesById.get(id)));
  if (!project.colors.some((colour) => colour)) return fail("it carries no readable "
    + "colours");
  project.paletteSource = "Prusa_Slicer_full_spectrum.json";
  project.paletteCount = project.colors.length;
  return project.colors;
}

const STANDARD_TRIANGLE_RE = /<triangle\b([^>]*?)\/>/g;
const MM_UNITS = new Set(["millimeter", "millimetre", "millimeters", "millimetres", "mm"]);

/** Refuse a document that is not in millimetres rather than writing wrong sizes. */
function requireMillimetres(text_, member) {
  const unit = /<model\b[^>]*\bunit\s*=\s*["']([^"']*)["']/.exec(text_);
  const value = unit ? unit[1].trim().toLowerCase() : "millimeter";
  if (!MM_UNITS.has(value)) {
    throw new ProjectError(`${member} is in "${value}", and this tool writes `
      + "millimetres; open it in a slicer and save it in millimetres first");
  }
}

/**
 * A standard-colour model: `m:colorgroup` resources plus per-triangle colour
 * references.  Colours are resolved *per document*: two members may reuse a group
 * id for a different table, so each document's complete ordered table gets its own
 * offset in the project palette (identical tables share one offset, and duplicate
 * RGB entries inside a table are never deduplicated).  Anything the reader cannot
 * resolve exactly -- a missing group, an out-of-range index, an unreadable colour
 * table, a non-millimetre document -- is refused rather than guessed.
 */
function readStandardColours(entries, project) {
  const members = [MODEL_FILE];
  for (const object of project.objects.values()) {
    for (const component of object.components) {
      members.push(component.path ? component.path.replace(/^\//, "") : MODEL_FILE);
    }
  }
  const documents = new Map();
  for (const member of new Set(members)) {
    const blob = text(entries, member);
    if (blob === null) continue;
    if (/<[a-zA-Z0-9]*:?colorgroup\b/.test(blob) && !blob.includes("<m:colorgroup")) {
      throw new ProjectError(`${member} declares a colour group under a namespace `
        + "this tool does not read; the export would have to guess its palette");
    }
    const groups = parseColourGroups(blob);
    if (!groups.size) {
      if (/\bpid\s*=|colorgroup\b/.test(blob)) {
        throw new ProjectError(`${member} references material properties without a readable colour group`);
      }
      continue;
    }
    requireMillimetres(blob, member);
    documents.set(member, groups);
  }
  if (!documents.size) return;
  for (const member of documents.keys()) {
    if (/(?:paint_color|mmu_segmentation)="[0-9a-fA-F]+"/.test(text(entries, member))) {
      throw new ProjectError(`${member} mixes native paint with standard colour properties; this combination cannot be resolved without guessing`);
    }
  }
  const palette = [];
  const tables = [];
  const byMember = new Map();
  for (const [member, groups] of documents) {
    const ids = [...groups.keys()].sort((a, b) => Number(a) - Number(b));
    const colours = [];
    const base = new Map();
    const length = new Map();
    for (const id of ids) {
      const entries_ = groups.get(id);
      base.set(String(id), colours.length);
      length.set(String(id), entries_.length);
      for (const entry of entries_) {
        const colour = colourOf(entry);
        if (!colour) {
          throw new ProjectError(`${member} colour group ${id} declares "${entry}", `
            + "which is not a #RRGGBB colour");
        }
        colours.push(colour);
      }
    }
    // The *table* is what identifies the palette, not the group ids: our own root
    // and member documents declare the same colours under different ids and must
    // share one offset, while a genuinely different table gets its own.
    const key = colours.join(",");
    let table = tables.find((entry) => entry.key === key);
    if (!table) {
      table = { key, offset: palette.length, colours };
      palette.push(...colours);
      tables.push(table);
    }
    byMember.set(member, { table, base, length });
  }
  if (palette.length > MAX_SOURCE_COLOURS) {
    throw new ProjectError(`these documents declare ${palette.length} colours, and `
      + `this tool carries at most ${MAX_SOURCE_COLOURS} across its export formats`);
  }
  for (const member of documents.keys()) {
    const blob = text(entries, member);
    const rewritten = standardMemberToPaint(blob, member, byMember.get(member));
    if (rewritten !== null) entries.set(member, encoder.encode(rewritten));
  }
  project.colors = palette;
  project.types = palette.map(() => "PLA");
  project.paletteSource = "colorgroup";
  project.paletteCount = palette.length;
}

/** Rewrite one member's colour references into the paint attribute the rest of
 *  the pipeline reads.  Unknown groups and bad indices are refused. */
function standardMemberToPaint(blob, member, document) {
  let touched = false;
  const stateOf = (group, index, where) => {
    const id = String(group);
    if (!document.base.has(id)) {
      throw new ProjectError(`${where} references colour group ${id}, which `
        + `${member} does not declare`);
    }
    const length = document.length.get(id);
    if (!Number.isInteger(index) || index < 0 || index >= length) {
      throw new ProjectError(`${where} references colour ${index} of group ${id}, `
        + `which has ${length} colour(s)`);
    }
    return document.table.offset + document.base.get(id) + index + 1;
  };
  const out = blob.replace(OBJECT_RE, (full) => {
    if (!full.includes("pid=")) return full;
    const defaultIndex = objectDefaultIndex(full);
    const body = full.replace(STANDARD_TRIANGLE_RE, (tag, attrs) => {
      const reference = triangleColour(attrs, defaultIndex, member);
      if (reference === null) return tag;
      const state = stateOf(reference.group, reference.index,
                            `a facet in ${member}`);
      if (state > MAX_SOURCE_COLOURS) {
        throw new ProjectError(`a facet in ${member} uses colour ${state} of a `
          + "document with more colours than this tool carries");
      }
      touched = true;
      const stripped = attrs.replace(/\s*(?:m:)?pid="[^"]*"/g, "")
        .replace(/\s*(?:m:)?p[123]="[^"]*"/g, "")
        .replace(/\s+(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="[^"]*"/g, "");
      return `<triangle${stripped} paint_color="${paint.encode({ kind: "leaf", state })}"/>`;
    });
    return body;
  });
  const cleaned = touched ? out.replace(/<object\b([^>]*)>/g,
    (full, attrs) => `<object${attrs.replace(/\s*(?:m:)?pid="[^"]*"/g, "")
      .replace(/\s*(?:m:)?pindex="[^"]*"/g, "")}>`) : out;
  return touched ? cleaned : null;
}

/** The `pid`/`pindex` default declared on an object tag, if any. */
function objectDefaultIndex(objectTag) {
  const open = /<object\b([^>]*)>/.exec(objectTag);
  if (!open) return null;
  const group = /(?:m:)?pid="([^"]*)"/.exec(open[1]);
  if (!group) return null;
  const index = /(?:m:)?pindex="([^"]*)"/.exec(open[1]);
  return { group: String(group[1]),
           index: index === null ? 0 : Number(index[1]) };
}

/** One triangle's colour reference: its own `pid`/`p1`, else the object default. */
function triangleColour(attrs, defaultIndex, member) {
  if (/\bp2="/.test(attrs) || /\bp3="/.test(attrs)) {
    throw new ProjectError(`a triangle in ${member} carries per-corner colours `
      + "(p2/p3), which this tool does not read; it accepts one colour per facet");
  }
  const group = /(?:m:)?pid="([^"]*)"/.exec(attrs);
  if (group) {
    const first = /(?:m:)?p1="([^"]*)"/.exec(attrs);
    return { group: String(group[1]), index: first ? Number(first[1])
             : (defaultIndex ? defaultIndex.index : 0) };
  }
  const first = /\bp1="([^"]*)"/.exec(attrs);
  if (first && !defaultIndex) throw new ProjectError(`${member} has a colour index without a colour group`);
  return defaultIndex ? { group: defaultIndex.group,
                         index: first ? Number(first[1]) : defaultIndex.index }
    : null;
}

/** Native virtual blends the source carries, whichever dialect wrote them.
 *
 * A Full Spectrum mixture is not an ordinary filament: writing it as one more
 * solid reel silently replaces the blend with a plain colour.  Which palette
 * source won does not matter -- the definitions are read from the archive, so a
 * blend is caught even when (say) a Prusa print config supplied the colours.
 */
function readMixtures(entries, project) {
  const found = new Set();
  const blob = text(entries, SRC_BBL_PROJECT);
  if (blob) {
    let cfg = null;
    try {
      cfg = JSON.parse(blob);
    } catch (error) {
      cfg = null;
    }
    if (cfg) {
      if (Array.isArray(cfg.filament_is_mixed)
          && cfg.filament_is_mixed.some((value) => value === true || String(value) === "1")) {
        found.add("filament_is_mixed");
      }
      if (Array.isArray(cfg.filament_mixed_components)
          && cfg.filament_mixed_components.some((value) => String(value || "").trim())) {
        found.add("filament_mixed_components");
      }
      const rows = String(cfg.mixed_filament_definitions || "").split(";")
        .map((line) => line.split(","));
      // A stock U1 profile lists all six automatic pairs tombstoned (`d1`); only
      // an *enabled* row is a mixture someone actually asked for.
      if (rows.some((tokens) => tokens.length >= 5 && tokens[2] === "1"
                                 && !tokens.includes("d1"))) {
        found.add("mixed_filament_definitions");
      }
    }
  }
  const spectrum = text(entries, SRC_PRUSA_SPECTRUM);
  if (spectrum) {
    let data = null;
    try {
      data = JSON.parse(spectrum);
    } catch (error) {
      data = null;
    }
    if (data && Array.isArray(data.virtual_extruders) && data.virtual_extruders.length) {
      found.add("virtual_extruders");
    }
  }
  project.mixtures = { present: found.size > 0, sources: [...found].sort() };
}

/** Refuse a project whose virtual blends this writer cannot translate faithfully. */
function refuseMixtures(project, verb) {
  const info = project.mixtures;
  if (!info || !info.present) return;
  throw new ProjectError(`this project carries native Full Spectrum blends `
    + `(${info.sources.join(", ")}), and this tool will not ${verb} them: writing a `
    + "blend as an ordinary filament would quietly replace the mixed colour with a "
    + "solid one. Export a version without virtual blends from the slicer that made it");
}

function readObjects(project) {
  OBJECT_RE.lastIndex = 0;
  let match;
  while ((match = OBJECT_RE.exec(project.main)) !== null) {
    const id = attr(match[1], "id");
    if (id === null) continue;
    const body = match[2];
    const components = [];
    COMPONENT_RE.lastIndex = 0;
    let comp;
    while ((comp = COMPONENT_RE.exec(body)) !== null) {
      components.push({
        path: attr(comp[1], "p:path"),
        objectid: attr(comp[1], "objectid"),
        transform: attr(comp[1], "transform"),
      });
    }
    const hasMesh = /<mesh\b/.test(body);
    project.objects.set(String(id), {
      id: String(id), components, hasMesh,
      member: components.some((c) => c.path) ? null : MODEL_FILE,
    });
  }
  if (!project.objects.size) throw new ProjectError("this 3MF has no objects in it");
}

function readMeta(entries, project) {
  const blob = text(entries, SRC_BBL_MODEL);
  if (blob) {
    for (const object of blob.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = attr(object[1], "id");
      if (id === null) continue;
      const entry = { id: String(id), name: "", extruder: null, parts: [],
                      subtype: attr(object[1], "subtype") || "normal_part" };
      const name = /<metadata(?: type="[^"]*")? key="name" value="([^"]*)"/.exec(object[2]);
      if (name) entry.name = name[1];
      const extruder = /<metadata(?: type="[^"]*")? key="extruder" value="([^"]*)"/.exec(object[2]);
      if (extruder) entry.extruder = Number(extruder[1]);
      // Per-object intent the optional preservation control may carry: an object
      // that says more than the file's global settings wins for that object.  Only
      // the object's own metadata is read -- a nested <part> may carry its own and
      // must not be mistaken for the object's.
      const ownBody = object[2].split(/<part\b/)[0];
      entry.settings = {};
      for (const key of SOURCE_KEYS) {
        const found = new RegExp(`<metadata key="${key}" value="([^"]*)"`).exec(ownBody);
        if (found) entry.settings[key] = found[1];
      }
      if (!Object.keys(entry.settings).length) delete entry.settings;
      for (const part of object[2].matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
        const partId = attr(part[1], "id");
        const partName = /<metadata(?: type="[^"]*")? key="name" value="([^"]*)"/.exec(part[2]);
        const partExtruder = /<metadata(?: type="[^"]*")? key="extruder" value="([^"]*)"/.exec(part[2]);
        entry.parts.push({
          id: partId === null ? "" : String(partId),
          name: partName ? partName[1] : "",
          extruder: partExtruder ? Number(partExtruder[1]) : null,
          subtype: attr(part[1], "subtype") || "normal_part",
          firstid: null, lastid: null, range: false,
        });
      }
      project.meta.set(String(id), entry);
    }
    for (const plate of blob.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
      const name = /<metadata key="plater_name" value="([^"]*)"/.exec(plate[1]);
      // The instance id is what selects the matching build item: without it a
      // plate that carries one copy of an object would drag in every copy.
      const entries = [...plate[1].matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)]
        .map((instance) => {
          const objectId = /<metadata key="object_id" value="([^"]*)"/.exec(instance[1]);
          if (!objectId) return null;
          const instanceId = /<metadata key="instance_id" value="([^"]*)"/.exec(instance[1]);
          return { id: String(objectId[1]),
                   instanceId: instanceId ? instanceId[1] : null };
        }).filter(Boolean);
      project.plates.push({ id: project.plates.length + 1,
                            name: name ? name[1] : `Plate ${project.plates.length + 1}`,
                            entries,
                            objectIds: entries.map((entry) => entry.id) });
    }
    return;
  }
  const prusa = text(entries, SRC_PRUSA_MODEL);
  if (prusa) {
    for (const object of prusa.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = attr(object[1], "id");
      const entry = { id: String(id), name: "", extruder: null, parts: [],
                      subtype: "normal_part" };
      const name = /<metadata(?: type="[^"]*")? key="name" value="([^"]*)"/.exec(object[2]);
      if (name) entry.name = name[1];
      // PrusaSlicer puts the object's own extruder on a typed metadata line; the
      // Bambu spelling above does not match it, and losing it would drop a
      // part-coloured object back onto tool 1.
      const extruder = /<metadata type="object" key="extruder" value="([^"]*)"/.exec(
        object[2]);
      if (extruder) entry.extruder = Number(extruder[1]);
      entry.settings = {};
      const ownBody = object[2].split(/<volume\b/)[0];
      for (const key of SOURCE_KEYS) {
        const found = new RegExp(`<metadata(?: type="object")? key="${key}" value="([^"]*)"`).exec(ownBody);
        if (found) entry.settings[key] = found[1];
      }
      if (!Object.keys(entry.settings).length) delete entry.settings;
      for (const volume of object[2].matchAll(/<volume\b([^>]*)>([\s\S]*?)<\/volume>/g)) {
        const volumeName = /<metadata(?: type="[^"]*")? key="name" value="([^"]*)"/.exec(volume[2]);
        const volumeExtruder = /<metadata(?: type="[^"]*")? key="extruder" value="([^"]*)"/.exec(volume[2]);
        const volumeType = /<metadata(?: type="[^"]*")? key="volume_type" value="([^"]*)"/.exec(volume[2]);
        const first = attr(volume[1], "firstid");
        const last = attr(volume[1], "lastid");
        entry.parts.push({
          id: String(id),
          name: volumeName ? volumeName[1] : "",
          extruder: volumeExtruder ? Number(volumeExtruder[1]) : null,
          subtype: (volumeType ? volumeType[1] : "ModelPart"),
          firstid: first === null ? null : Number(first),
          lastid: last === null ? null : Number(last),
          range: first !== null && last !== null,
        });
      }
      project.meta.set(String(id), entry);
    }
  }
}

/** True when the part is allowed to contribute visible printed geometry. */
export function isPrintablePart(subtype) {
  const text = String(subtype || "normal_part").toLowerCase();
  return text === "normal_part" || text === "modelpart" || text === "";
}

/** True when the part only modifies or subtracts from the model. */
export function isHiddenPart(subtype) {
  const text = String(subtype || "").toLowerCase();
  return text.includes("negative") || text.includes("modifier")
    || text.includes("support_blocker") || text.includes("supportblocker");
}

function readItems(project) {
  for (const item of project.main.matchAll(/<item\b([^>]*)\/>/g)) {
    const objectId = attr(item[1], "objectid");
    if (objectId === null) continue;
    project.items.push({
      objectid: String(objectId),
      transform: attr(item[1], "transform"),
      printable: attr(item[1], "printable") !== "0",
    });
  }
  if (!project.plates.length) {
    const ids = [...new Set(project.items.map((item) => item.objectid))]
      .filter((id) => project.objects.has(id));
    if (ids.length) project.plates.push({ id: 1, name: "Plate 1", objectIds: ids });
  }
}

function guessKind(project) {
  // Slic3r_PE_model.config is what makes it a Prusa project; a portable one has no
  // print config at all, so it must not fall through to "plain".
  if (project.entries.has(SRC_PRUSA_PRINT) || project.entries.has(SRC_PRUSA_MODEL)
      || project.entries.has(SRC_PRUSA_SPECTRUM)) {
    project.kind = "prusa";
  }
  else if (project.entries.has(SRC_BBL_PROJECT)) project.kind = "bambu";
  else project.kind = "plain";
}

export function colorFor(project, extruder) {
  const index = Number(extruder) - 1;
  if (index >= 0 && index < project.colors.length && project.colors[index]) {
    return project.colors[index];
  }
  return "#FFFFFF";
}

export function typeFor(project, extruder) {
  const index = Number(extruder) - 1;
  if (index >= 0 && index < project.types.length && project.types[index]) {
    return project.types[index];
  }
  return "PLA";
}

export function plate(project, plateId) {
  return project.plates.find((entry) => Number(entry.id) === Number(plateId)) || null;
}

/** Every object the plate can export, in a stable order. */
export function eligibleObjects(project, plateId) {
  const chosen = plate(project, plateId);
  const ids = chosen ? chosen.objectIds : project.items.map((item) => item.objectid);
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const key = String(id);
    if (seen.has(key) || !project.objects.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  if (!out.length) {
    for (const id of project.objects.keys()) out.push(id);
  }
  return out;
}

export function selectionInstances(project, plateId, objectIds) {
  // An explicit empty list means "nothing selected", never "everything": a page
  // that has unticked every object must not export the whole plate.
  if (Array.isArray(objectIds) && objectIds.length === 0) {
    throw new ProjectError("nothing is selected, so there is nothing to build");
  }
  const list = objectIds && objectIds.length ? objectIds.map(String)
    : eligibleObjects(project, plateId);
  const out = [];
  const chosenPlate = plate(project, plateId);
  const printableItems = (id) => project.items.filter((item) => item.objectid === id
    && item.printable !== false);
  if (chosenPlate && chosenPlate.entries && chosenPlate.entries.length) {
    const seen = new Map();
    for (const entry of chosenPlate.entries) {
      const id = String(entry.id);
      if (!list.includes(id) || !project.objects.has(id)) continue;
      const items = printableItems(id);
      if (!items.length) continue;
      const index = seen.get(id) || 0;
      seen.set(id, index + 1);
      const slot = entry.instanceId === null || entry.instanceId === undefined
        ? index : Number(entry.instanceId);
      if (!Number.isInteger(slot) || slot < 0 || slot >= items.length) {
        throw new ProjectError(`plate ${chosenPlate.id} lists instance `
          + `${entry.instanceId} of object ${id}, which is not among that object's `
          + `${items.length} printable build item(s), so the placement is unknown`);
      }
      out.push([id, items[slot].transform]);
    }
    return out;
  }
  for (const id of list) {
    for (const item of printableItems(id)) out.push([id, item.transform]);
  }
  return out;
}

const translationMatrix = (offset) => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0],
                                       [offset[0], offset[1], offset[2], 1]];

/** The local bounding box of one mesh object, cached per member/object. */
function meshBox(entries, member, id, cache) {
  const key = `${member}|${id}`;
  if (cache.has(key)) return cache.get(key);
  const blob = text(entries, member);
  let box = null;
  if (blob !== null) {
    OBJECT_RE.lastIndex = 0;
    let match;
    while ((match = OBJECT_RE.exec(blob)) !== null) {
      if (String(attr(match[1], "id")) !== String(id)) continue;
      const mesh = /<mesh\b[\s\S]*?<\/mesh>/.exec(match[2]);
      if (!mesh) break;
      box = emptyBox();
      VERTEX_RE.lastIndex = 0;
      let vertex;
      while ((vertex = VERTEX_RE.exec(mesh[0])) !== null) {
        addPoint(box, [Number(vertex[1]), Number(vertex[2]), Number(vertex[3])]);
      }
      if (!boxValid(box)) box = null;
      break;
    }
  }
  cache.set(key, box);
  return box;
}

/**
 * The world-space bounds of a whole selection: every instance, every component
 * transform, every part -- the number the layout box is measured against.
 */
export function selectionBounds(project, plateId, objectIds) {
  const box = emptyBox();
  const cache = new Map();
  for (const [objectId, itemTransform] of selectionInstances(project, plateId,
                                                             objectIds)) {
    const object = project.objects.get(objectId);
    if (!object) continue;
    const item = matrixFromText(itemTransform);
    const meta = project.meta.get(String(objectId));
    for (const component of object.components) {
      const part = meta?.parts?.find(part=>String(part.id)===String(component.objectid));
      if (part && isHiddenPart(part.subtype)) continue;
      const member = component.path ? component.path.replace(/^\//, "") : MODEL_FILE;
      const local = meshBox(project.entries, member, component.objectid, cache);
      if (!local) continue;
      const matrix = matmul(matrixFromText(component.transform), item);
      addBox(box, transformBox(local, (point) => applyMatrix(matrix, point)));
    }
    if (object.hasMesh) {
      const local = meshBox(project.entries, MODEL_FILE, object.id, cache);
      if (local) addBox(box, transformBox(local, (point) => applyMatrix(item, point)));
    }
  }
  return box;
}

/**
 * A selection placed for export: one entry per copy, all referencing the same
 * meshes.  `plan` is the grid the copies came from, so the page can say what
 * happened (and why a copy count may have been capped).
 */
export function layoutInstances(project, plateId, objectIds, layout) {
  const base = selectionInstances(project, plateId, objectIds);
  if (!layout) return { instances: base, plan: null, bounds: null };
  const bounds = selectionBounds(project, plateId, objectIds);
  if (!boxValid(bounds)) {
    throw new ProjectError("this selection has no measurable geometry, so it "
      + "cannot be laid out on a plate");
  }
  const plan = planLayout(bounds, layout);
  if (plan.blocked) {
    throw new ProjectError(`a ${plan.size[0].toFixed(1)} × ${plan.size[1].toFixed(1)} mm `
      + `model does not fit the ${plan.width} × ${plan.depth} mm layout box, so there `
      + "is nothing to write; widen the box or reduce the spacing");
  }
  const offsets = layoutOffsets(bounds, plan, layout.centre || [0, 0]);
  const instances = [];
  for (const [objectId, itemTransform] of base) {
    for (const offset of offsets) {
      // Row-vector maths: the source transform is applied first and the world
      // offset after it, so a rotated or scaled placement is moved, not scaled.
      const matrix = matmul(matrixFromText(itemTransform), translationMatrix(offset));
      instances.push([objectId, transformText(matrix)]);
    }
  }
  return { instances, plan, bounds };
}

/** One inner object's facets: counts per state, for the assessment. */
export function scanMember(entries, member, wanted) {
  const blob = text(entries, member);
  if (blob === null) {
    throw new ProjectError(`${member} is referenced but not in the archive`);
  }
  const out = new Map();
  OBJECT_RE.lastIndex = 0;
  let match;
  while ((match = OBJECT_RE.exec(blob)) !== null) {
    const id = attr(match[1], "id");
    if (id === null || !wanted.has(String(id))) continue;
    const entry = { id: String(id), triangles: 0, states: new Map(), unpainted: 0,
                    split: 0, splitStates: new Map(), unknown: 0, components: [] };
    COMPONENT_RE.lastIndex = 0;
    let comp;
    while ((comp = COMPONENT_RE.exec(match[2])) !== null) {
      entry.components.push({ path: attr(comp[1], "p:path"),
                              objectid: attr(comp[1], "objectid"),
                              transform: attr(comp[1], "transform") });
    }
    TRIANGLE_RE.lastIndex = 0;
    let triangle;
    while ((triangle = TRIANGLE_RE.exec(match[2])) !== null) {
      entry.triangles += 1;
      const paintMatch = PAINT_RE.exec(triangle[1]);
      if (!paintMatch || !paintMatch[1]) {
        entry.unpainted += 1;
        continue;
      }
      let node;
      try {
        node = paint.decode(paintMatch[1]);
      } catch (error) {
        entry.unknown += 1;
        continue;
      }
      const states = paint.walkStates(node);
      if (states.some((state) => state > paint.SUPPORTED_STATE_MAX)) entry.unknown += 1;
      if (node.kind === "leaf") {
        entry.states.set(node.state, (entry.states.get(node.state) || 0) + 1);
      } else {
        entry.split += 1;
        for (const state of new Set(states)) {
          entry.splitStates.set(state, (entry.splitStates.get(state) || 0)
            + states.filter((s) => s === state).length);
        }
      }
    }
    out.set(String(id), entry);
  }
  return out;
}

/** The inner objects one selection needs, per member, transitively. */
export function neededMembers(project, plateId, objectIds) {
  const roots = new Map();                     // member -> Set(inner id)
  const add = (member, id) => {
    if (!roots.has(member)) roots.set(member, new Set());
    roots.get(member).add(String(id));
  };
  const entries = [...selectionInstances(project, plateId, objectIds)];
  for (const [objectId] of entries) {
    const object = project.objects.get(objectId);
    if (!object) throw new ProjectError(`object ${objectId} is not in this project`);
    let assigned = false;
    for (const component of object.components) {
      if (component.path) {
        add(component.path.replace(/^\//, ""), component.objectid);
      } else {
        add(MODEL_FILE, component.objectid);
      }
      assigned = true;
    }
    if (object.hasMesh) {
      add(MODEL_FILE, object.id);
      assigned = true;
    }
    if (!assigned) {
      throw new ProjectError(`object ${objectId} has no mesh and no parts this tool `
        + "can copy, so it would be exported empty");
    }
  }
  // Follow component references across members until nothing new appears.
  const queue = [...roots.keys()].map((member) => [member, new Set(roots.get(member))]);
  const seen = new Set();
  while (queue.length) {
    const [member, wanted] = queue.shift();
    const key = `${member}|${[...wanted].sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scanned = scanMember(entries0(project), member, wanted);
    for (const entry of scanned.values()) {
      for (const component of entry.components) {
        const target = component.path
          ? component.path.replace(/^\//, "") : member;
        if (target === member && roots.get(member)?.has(String(component.objectid))) {
          continue;
        }
        const before = roots.get(target)?.size || 0;
        add(target, component.objectid);
        if ((roots.get(target)?.size || 0) !== before) {
          queue.push([target, new Set([String(component.objectid)])]);
        }
      }
    }
  }
  return roots;
}

function entries0(project) {
  return project.entries;
}

/** Every reference the export will need must resolve to real, non-empty geometry.
 *
 * `neededMembers` collects references transitively; this walks the same set back
 * and refuses a member or an object id that is not there.  Without it a component
 * pointing at a missing mesh produced a "successful" download with no geometry.
 */
function assertReachable(project, roots) {
  for (const [member, wanted] of roots) {
    const found = scanMember(project.entries, member, wanted);
    for (const id of wanted) {
      const entry = found.get(String(id));
      if (!entry) {
        throw new ProjectError(`${member} is referenced but holds no object ${id}, `
          + "so the export would be missing that mesh");
      }
      if (!entry.components.length && !entry.triangles) {
        throw new ProjectError(`${member} object ${id} has no triangles, so there is `
          + "nothing to export from it");
      }
    }
  }
}

/** An assembly of assemblies is beyond what assess/preview/export resolve.
 *
 * A component may point at a leaf mesh (the normal top-level assembly); a
 * component that points at an object which itself has components is a second
 * level, which the reader would silently ignore, drawing and exporting a
 * different model from the one the file describes.  Refuse it explicitly.
 */
function assertSupportedGraph(project, roots) {
  for (const [member, wanted] of roots) {
    const blob = text(project.entries, member);
    if (blob === null || !blob.includes("<component")) continue;
    const scanned = scanMember(project.entries, member, wanted);
    for (const [id, entry] of scanned) {
      if (entry.components.length) {
        throw new ProjectError(`${member} object ${id} is itself built from `
          + `${entry.components.length} component(s): nested assemblies are not `
          + "supported, so this tool will not open a project it would draw and "
          + "export differently from the file");
      }
    }
  }
}

// ------------------------------------------------------------- assessment ----

/** What one selection really uses: colours, triangle counts, per-object detail. */
export function analyse(project, plateId, objectIds) {
  if (Array.isArray(objectIds) && objectIds.length === 0) {
    throw new ProjectError("nothing is selected, so there is nothing to assess");
  }
  const eligible = eligibleObjects(project, plateId);
  const instances = selectionInstances(project, plateId, objectIds);
  assertSupportedGraph(project, neededMembers(project, plateId, objectIds));
  const chosen = new Set(objectIds && objectIds.length
    ? objectIds.map(String) : eligible);
  const reports = new Map();
  for (const id of eligible) {
    const meta = project.meta.get(id);
    const root = project.objects.get(id);
    const detail = new Map();
    let triangles = 0;
    let unpainted = 0;
    let split = 0;
    let unknown = 0;
    if (root) {
      for (const component of root.components) {
        const part = meta && meta.parts
          ? meta.parts.find((item) => item.id === String(component.objectid))
          : null;
        if (part && isHiddenPart(part.subtype)) {
          // A negative or modifier volume is not printed geometry; it must not
          // add a colour to the assessment.
          continue;
        }
        const member = component.path ? component.path.replace(/^\//, "") : MODEL_FILE;
        const scanned = scanMember(project.entries, member,
                                   new Set([String(component.objectid)]));
        // Whatever this part's facets leave unpainted becomes the part's own
        // filament.  It is only a colour this selection uses if there really is
        // such geometry: a fully painted part does not need its base at all.
        const base = (part && part.extruder) || (meta && meta.extruder) || 1;
        let defaulted = 0;
        for (const entry of scanned.values()) {
          triangles += entry.triangles;
          for (const [state, count] of entry.states) {
            if (state) detail.set(state, (detail.get(state) || 0) + count);
          }
          for (const [state, count] of entry.splitStates) {
            if (state) detail.set(state, (detail.get(state) || 0) + count);
            else defaulted += count;
          }
          defaulted += entry.unpainted + (entry.states.get(0) || 0);
          unpainted += entry.unpainted + (entry.states.get(0) || 0);
          split += entry.split;
          unknown += entry.unknown;
        }
        if (defaulted) detail.set(base, (detail.get(base) || 0) + defaulted);
      }
      if (root.hasMesh) {
        const whole = meta && meta.parts && meta.parts.length === 0 ? null
          : meta;
        if (whole && isHiddenPart(whole.subtype)) {
          // Hidden whole object: nothing visible to assess or preview.
        } else {
        const scanned = scanMember(project.entries, MODEL_FILE, new Set([id]));
        const base = (meta && meta.extruder) || 1;
        let defaulted = 0;
        for (const entry of scanned.values()) {
          triangles += entry.triangles;
          for (const [state, count] of entry.states) {
            if (state) detail.set(state, (detail.get(state) || 0) + count);
          }
          for (const [state, count] of entry.splitStates) {
            if (state) detail.set(state, (detail.get(state) || 0) + count);
            else defaulted += count;
          }
          defaulted += entry.unpainted + (entry.states.get(0) || 0);
          unpainted += entry.unpainted + (entry.states.get(0) || 0);
          split += entry.split;
          unknown += entry.unknown;
        }
        if (defaulted) detail.set(base, (detail.get(base) || 0) + defaulted);
        }
      }
    }
    const used = new Set([...detail.keys()].filter((state) => state));
    reports.set(id, {
      id, name: (meta && meta.name) || `object ${id}`, triangles, split, unknown,
      painted: [...detail.entries()].filter(([state]) => state)
        .reduce((sum, [, count]) => sum + count, 0),
      used: [...used].filter((state) => state >= 1).sort((a, b) => a - b),
      detail,
    });
  }
  const selected = [...reports.values()].filter((report) => chosen.has(report.id));
  if (!selected.length) {
    throw new ProjectError("none of the selected objects can be exported from that "
      + "plate");
  }
  const used = [...new Set(selected.flatMap((report) => report.used))]
    .sort((a, b) => a - b);
  const objects = [...reports.values()].map((report) => {
    const meta = project.meta.get(report.id);
    return {
      id: report.id, name: report.name,
      parts: (meta && meta.parts.length) || (project.objects.get(report.id)
        ? project.objects.get(report.id).components.length : 0),
      triangles: report.triangles,
      painted: report.painted, subdivided: report.split, undecodable: report.unknown,
      instances: instances.filter(([id]) => id === report.id).length,
      selected: chosen.has(report.id),
      colours: report.used.map((extruder) => ({
        extruder, color: colorFor(project, extruder), type: typeFor(project, extruder),
        painted_triangles: report.detail.get(extruder) || 0,
      })),
    };
  });
  const counts = {
    objects: selected.length,
    instances: instances.filter(([id]) => chosen.has(String(id))).length,
    triangles: selected.reduce((sum, report) => sum + report.triangles, 0),
    painted_triangles: selected.reduce((sum, report) => sum + report.painted, 0),
    subdivided_triangles: selected.reduce((sum, report) => sum + report.split, 0),
    undecodable_paint: selected.reduce((sum, report) => sum + report.unknown, 0),
    plate_objects: eligible.length,
  };
  return {
    objects, counts, used,
    sourceColors: Object.fromEntries(used.map((e) => [e, colorFor(project, e)])),
    palette: { count: project.paletteCount, source: project.paletteSource },
  };
}

/** Cheap plate summary for the conversion page: counts, no per-facet decoding.
 *
 * `analyse` decodes every facet's paint to report which colours a selection uses.
 * The converter only needs the shape of the file before it writes it, so this
 * walks the same objects and stops at the triangle count -- a 1.3M-triangle
 * project loads without a whole-file state scan.
 */
export function summary(project, plateId) {
  const ids = eligibleObjects(project, plateId);
  let triangles = 0;
  for (const id of ids) {
    const object = project.objects.get(id);
    if (!object) continue;
    const meta = project.meta.get(id);
    for (const component of object.components) {
      const part = meta && meta.parts
        ? meta.parts.find((item) => item.id === String(component.objectid)) : null;
      if (part && isHiddenPart(part.subtype)) continue;
      const member = component.path ? component.path.replace(/^\//, "") : MODEL_FILE;
      triangles += countMesh(project.entries, member, component.objectid);
    }
    if (object.hasMesh && !(meta && isHiddenPart(meta.subtype))) {
      triangles += countMesh(project.entries, MODEL_FILE, id);
    }
  }
  const chosen = plate(project, plateId);
  // The layout box is measured against the selection's own bounds, so the page can
  // offer real dimensions before anything heavy is prepared.
  let bounds = null;
  try {
    const box = selectionBounds(project, plateId, null);
    if (boxValid(box)) {
      bounds = { min: box.min.slice(), max: box.max.slice(), size: boxSize(box) };
    }
  } catch (error) {
    bounds = null;
  }
  return {
    triangles,
    plate: chosen ? { id: chosen.id, name: chosen.name, objects: ids.length } : null,
    mixtures: project.mixtures ? project.mixtures.sources.slice() : [],
    bounds,
    // The paint travels with the geometry whatever the print settings say, so the
    // page has to know when a "supports off" export would still carry enforcers.
    supportsPainted: supportPaintPresent(project, plateId, null),
    // A source plate size is used only when the file really states one; otherwise
    // the page offers its own editable planning area.
    plateSize: (() => {
      const blob = text(project.entries, SRC_BBL_PROJECT);
      if (!blob) return null;
      try {
        const cfg = JSON.parse(blob);
        const area = cfg.printable_area;
        if (!Array.isArray(area) || !area.length) return null;
        const points = area.map((point) => String(point).split("x").map(Number));
        if (!points.every((pair) => pair.length === 2 && pair.every(Number.isFinite))) {
          return null;
        }
        const xs = points.map((pair) => pair[0]);
        const ys = points.map((pair) => pair[1]);
        return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      } catch (error) {
        return null;
      }
    })(),
  };
}

/** True when the selection's geometry carries painted support enforcers.
 *
 * The paint travels with the geometry whatever the print settings say, so a
 * "supports off" export has to know the model still carries them: Orca refuses to
 * let that contradiction pass ("Support enforcers are used but support is not
 * enabled"), and a page that did not know would promise a file the slicer warns
 * about.  A member whose graph is unsupported is refused later with its own
 * sentence, so a failure to walk it here is not a support claim.
 *
 * The test is per *object*, not per member: one `.model` member can hold several
 * objects, and a plate selects only some of them, so a painted object the export
 * is not copying must not switch supports on for the one that is.  An empty
 * attribute (`custom_supports=""`) is not paint either.
 */
export function supportPaintPresent(project, plateId, objectIds) {
  const painted = /(?:slic3rpe:)?(?:custom_supports|paint_supports)="([^"]*)"/g;
  let needed;
  try {
    needed = neededMembers(project, plateId, objectIds);
  } catch (error) {
    return false;
  }
  for (const [member, wanted] of needed) {
    const blob = text(project.entries, member);
    if (!blob) continue;
    OBJECT_RE.lastIndex = 0;
    let object;
    while ((object = OBJECT_RE.exec(blob)) !== null) {
      const id = attr(object[1], "id");
      if (id === null || !wanted.has(String(id))) continue;
      painted.lastIndex = 0;
      let found;
      while ((found = painted.exec(object[2])) !== null) {
        if (found[1]) return true;            // a value, not an empty attribute
      }
    }
  }
  return false;
}

/** Triangle count of one inner object, without building the mesh. */
function countMesh(entries, member, id) {
  const blob = text(entries, member);
  if (blob === null) return 0;
  OBJECT_RE.lastIndex = 0;
  let match;
  while ((match = OBJECT_RE.exec(blob)) !== null) {
    if (String(attr(match[1], "id")) !== String(id)) continue;
    const found = match[2].match(/<triangle\b/g);
    return found ? found.length : 0;
  }
  return 0;
}

// -------------------------------------------------------------- preview ------

/** Triangle soup in world space, capped, with the plan's colours. */
export function previewSoup(project, plateId, objectIds, colours, mapping,
                            cap = PREVIEW_TRIANGLE_CAP, options = {}) {
  // `full` streams the *whole* selection into typed arrays (no stride), which is
  // what a real simplifier needs as its input.
  const full = options.full === true;
  const capacityGuess = Math.max(64, Math.ceil((options.estimate || 1)));
  let positions = full ? new Float32Array(capacityGuess * 9) : [];
  let states = full ? new Int32Array(capacityGuess) : [];
  let count = 0;
  const grow = () => {
    if (!full) return;
    const next = positions.length * 2;
    const bigger = new Float32Array(next);
    bigger.set(positions);
    positions = bigger;
    const more = new Int32Array(states.length * 2);
    more.set(states);
    states = more;
  };
  const emit = (ids, points, state) => {
    if (full) {
      if (count + 1 > states.length) grow();
      let at = count * 9;
      for (const index of ids) {
        positions[at] = points[index][0];
        positions[at + 1] = points[index][1];
        positions[at + 2] = points[index][2];
        at += 3;
      }
      states[count] = state;
      count += 1;
      return;
    }
    for (const index of ids) {
      positions.push(points[index][0], points[index][1], points[index][2]);
    }
    states.push(state);
  };
  // A preview shows the same copies the export will write: one plan, both paths.
  const instances = layoutInstances(project, plateId, objectIds,
                                    options.layout || null).instances;
  assertSupportedGraph(project, neededMembers(project, plateId, objectIds));
  let subdivided = 0;
  let unknown = 0;
  const allParts = [];
  for (const [objectId, itemTransform] of instances) {
    const meta = project.meta.get(objectId);
    const base = (meta && meta.extruder) || 1;
    const object = project.objects.get(objectId);
    if (!object) continue;
    const metaParts = (meta && meta.parts) || [];
    for (const component of object.components) {
      const part = metaParts.find((item) => item.id === String(component.objectid));
      if (part && isHiddenPart(part.subtype)) continue;
      allParts.push({ member: component.path ? component.path.replace(/^\//, "") : MODEL_FILE,
                      id: String(component.objectid),
                      // The part's own filament is what an unpainted facet of it
                      // prints in; the object's only applies where no part says.
                      base: (part && part.extruder) || base,
                      matrix: transformOf(component.transform, itemTransform) });
    }
    if (object.hasMesh && !(meta && isHiddenPart(meta.subtype))) {
      allParts.push({ member: MODEL_FILE, id: object.id, base,
                      matrix: matrixFromText(itemTransform) });
    }
  }
  // Sample *evenly across the whole selection* rather than keeping the first
  // `cap` triangles: for a big model the first slice is one corner of it, which
  // reads as floating fragments instead of the model's silhouette.  Every part,
  // transform and per-facet colour is preserved -- only the stride changes.
  let total = 0;
  for (const part of allParts) {
    total += countMesh(project.entries, part.member, part.id);
  }
  const stride = full ? 1 : Math.max(1, Math.ceil(total / cap));
  const cursor = { seen: 0 };
  for (const part of allParts) {
    const result = meshSoup(project.entries, part, part.base, stride, cursor,
                            { subdivided, unknown }, emit);
    subdivided = result.subdivided;
    unknown = result.unknown;
    if (!full) {
      // Bounded copies: a spread of a 300k-element array overflows the stack.
      for (let index = 0; index < result.positions.length; index += 1) {
        positions.push(result.positions[index]);
      }
      for (let index = 0; index < result.states.length; index += 1) {
        states.push(result.states[index]);
      }
    }
  }
  if (full) {
    positions = positions.subarray(0, count * 9);
    states = states.subarray(0, count);
  }
  const truncated = stride > 1;
  const colors = full ? new Float32Array(count * 9) : [];
  let colourAt = 0;
  for (const state of states) {
    let channels;
    if (state < 0) {
      channels = [0.69, 0.19, 0.38];
    } else {
      // With no mapping the picture shows the file's own colours: each state is
      // already the source extruder.
      const target = state === 0 ? 1 : (mapping ? (mapping[state] ?? state) : state);
      const hex = colours[target] || "#FFFFFF";
      channels = [parseInt(hex.slice(1, 3), 16) / 255,
                  parseInt(hex.slice(3, 5), 16) / 255,
                  parseInt(hex.slice(5, 7), 16) / 255];
    }
    // One colour per vertex: three corners share the facet's colour.
    for (let corner = 0; corner < 3; corner += 1) {
      if (full) {
        colors[colourAt] = channels[0];
        colors[colourAt + 1] = channels[1];
        colors[colourAt + 2] = channels[2];
        colourAt += 3;
      } else {
        colors.push(...channels);
      }
    }
  }
  return { positions, colors, triangles: full ? count : states.length,
           truncated, subdivided, unknown,
           stride, sampled: truncated, total,
           // The per-facet state list, so a caller can recolour the same geometry
           // for a new palette without re-reading the model.
           states };
}

function transformOf(componentTransform, itemTransform) {
  const item = matrixFromText(itemTransform);
  if (!componentTransform) return item;
  return matmul(matrixFromText(componentTransform), item);
}

function meshSoup(entries, part, base, stride, cursor, stats, emit = null) {
  const blob = text(entries, part.member);
  if (blob === null) throw new ProjectError(`${part.member} is not in the archive`);
  const out = { positions: [], states: [], truncated: false,
                subdivided: stats.subdivided, unknown: stats.unknown };
  OBJECT_RE.lastIndex = 0;
  let match;
  while ((match = OBJECT_RE.exec(blob)) !== null) {
    if (String(attr(match[1], "id")) !== part.id) continue;
    const points = [];
    VERTEX_RE.lastIndex = 0;
    let vertex;
    while ((vertex = VERTEX_RE.exec(match[2])) !== null) {
      points.push(applyMatrix(part.matrix, [Number(vertex[1]), Number(vertex[2]),
                                            Number(vertex[3])]));
    }
    TRIANGLE_RE.lastIndex = 0;
    let triangle;
    while ((triangle = TRIANGLE_RE.exec(match[2])) !== null) {
      // Keep every `stride`-th triangle of the whole selection, so the picture is
      // the model rather than its first corner.
      const keep = cursor.seen % stride === 0;
      cursor.seen += 1;
      if (!keep) continue;
      const ids = [attr(triangle[1], "v1"), attr(triangle[1], "v2"),
                   attr(triangle[1], "v3")].map(Number);
      if (ids.some((index) => !Number.isFinite(index) || index >= points.length)) {
        continue;
      }
      const paintMatch = PAINT_RE.exec(triangle[1]);
      let state = base;
      if (!paintMatch || !paintMatch[1]) {
        // Unpainted geometry prints in the part's own filament, not in state 0.
        state = base;
      } else {
        try {
          const node = paint.decode(paintMatch[1]);
          if (node.kind === "leaf") {
            state = node.state || base;
          } else {
            out.subdivided += 1;
            const leaves = paint.walkStates(node).map((leaf) => leaf || base);
            if (leaves.length) {
              const counts = new Map();
              leaves.forEach((leaf) => counts.set(leaf, (counts.get(leaf) || 0) + 1));
              state = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
            }
          }
        } catch (error) {
          out.unknown += 1;
          state = -1;
        }
      }
      if (emit) {
        emit(ids, points, state);          // streaming into typed arrays
      } else {
        out.states.push(state);
        for (const index of ids) out.positions.push(...points[index]);
      }
    }
    break;
  }
  return out;
}

// --------------------------------------------------------------- export ------

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const PAINT_RE_G = /(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"/g;

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : "00000000-0000-4000-8000-" + String(Math.floor(Math.random() * 1e12)).padStart(12, "0");
}

const positive = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

/** The destination filament a part prints in, or a refusal.
 *
 * The source names one of the file's own filaments. A value the palette does not
 * describe -- or a mapping that sends it outside the written range -- is refused
 * rather than quietly replaced with filament 1, which would repaint the part.
 */
function resolveExtruder(project, mapping, highest, source, where) {
  if (!Number.isInteger(source) || source < 1 || source > project.colors.length) {
    throw new ProjectError(`${where} prints in filament ${source}, and this file's `
      + `palette describes ${project.colors.length} filament(s)`);
  }
  const out = mapping[source] ?? source;
  if (!Number.isInteger(out) || out < 1 || out > highest) {
    throw new ProjectError(`${where} would print in filament ${out}, but this export `
      + `writes filaments 1..${highest}`);
  }
  return out;
}

const VERTEX_RE_G = /<vertex\b([^>]*?)\/>/g;
const TRIANGLE_ATTRS = /<triangle\b([^>]*?)\/>/g;
const SUPPORT_ATTRS = /((?:slic3rpe:)?(?:paint_supports|custom_supports|paint_seam|custom_seam))="([^"]*)"/g;

/**
 * Copy a member's objects as a *standard colour* model: one `pid`/`p1` colour
 * reference per triangle and no paint attribute at all.
 *
 * Where a facet's paint is a single colour the triangle is left exactly as it
 * was.  Where the paint splits the facet, the split leaves are materialised as
 * real triangles with the exact child geometry (`TriangleSelector::perform_split`)
 * and each child carries its own colour -- the printed surface is identical and
 * no leaf is approximated.  A facet whose support or seam paint is *also* split
 * cannot be carried through that refinement, so it is refused with a sentence
 * rather than silently repainted.
 */
function copyMemberObjectsStandard(project, member, keep, mapping, settings, rename) {
  const blob = text(project.entries, member);
  if (blob === null) {
    throw new ProjectError(`${member} is in the object graph but not in the archive`);
  }
  const blocks = new Map();
  // A colour resource must not share an id with any object in the same document:
  // one past the highest object id in *this* member.
  const ids = [...keep].map(Number).filter((value) => Number.isFinite(value));
  const group = (ids.length ? Math.max(...ids) : 0) + 1;
  blocks.group = group;
  OBJECT_RE.lastIndex = 0;
  let match;
  while ((match = OBJECT_RE.exec(blob)) !== null) {
    const id = attr(match[1], "id");
    if (id === null || !keep.has(String(id))) continue;
    let body = match[0];
    if (rename) {
      body = body.replace(COMPONENT_RE, (full, attrsText) => {
        const path = attr(attrsText, "p:path");
        if (!path) return full;
        return full.replace(`p:path="${path}"`, `p:path="${rename(path)}"`);
      });
    }
    const vertices = /<vertices>([\s\S]*?)<\/vertices>/.exec(body);
    const triangles = /<triangles>([\s\S]*?)<\/triangles>/.exec(body);
    if (!vertices || !triangles) {
      blocks.set(String(id), body);
      continue;
    }
    const base = settings.base.get(`${member}|${id}`) || 1;
    const rebuilt = standardMesh(vertices[1], triangles[1], {
      mapping, group, base, paletteSize: settings.paletteSize, sourcePaletteSize: project.colors.length,
      where: `${member} object ${id}`,
    });
    body = body.replace(vertices[0], `<vertices>${rebuilt.vertices}</vertices>`)
      .replace(triangles[0], `<triangles>${rebuilt.triangles}</triangles>`);
    // The object declares the colour of anything it does not reference itself.
    body = body.replace(/^<object\b([^>]*)>/,
      (full, attrs) => `<object${attrs.replace(/\s*(?:m:)?pid="[^"]*"/g, "")
        .replace(/\s*(?:m:)?pindex="[^"]*"/g, "")} pid="${group}" `
        + `pindex="${rebuilt.defaultIndex}">`);
    blocks.set(String(id), body);
  }
  return blocks;
}

/** Rewrite one `<vertices>`/`<triangles>` pair into per-triangle colours. */
function standardMesh(verticesXml, trianglesXml, options) {
  const points = [];
  VERTEX_RE_G.lastIndex = 0;
  let vertex;
  while ((vertex = VERTEX_RE_G.exec(verticesXml)) !== null) {
    points.push([Number(/x="([^"]*)"/.exec(vertex[1])[1]),
                 Number(/y="([^"]*)"/.exec(vertex[1])[1]),
                 Number(/z="([^"]*)"/.exec(vertex[1])[1])]);
  }
  if (!points.length) throw new ProjectError(`${options.where} has no vertices`);
  const vertices = points.map((point) => `\n  <vertex x="${point[0]}" y="${point[1]}" `
    + `z="${point[2]}"/>`);
  const index = new Map(points.map((point, at) => [key(point), at]));
  const addPoint = (point) => {
    const id = key(point);
    if (index.has(id)) return index.get(id);
    index.set(id, points.length);
    vertices.push(`\n  <vertex x="${trim(point[0])}" y="${trim(point[1])}" `
      + `z="${trim(point[2])}"/>`);
    points.push(point);
    return points.length - 1;
  };
  const baseIndex = Math.max(0, (options.mapping[options.base] ?? options.base) - 1);
  const out = [];
  TRIANGLE_ATTRS.lastIndex = 0;
  let triangle;
  while ((triangle = TRIANGLE_ATTRS.exec(trianglesXml)) !== null) {
    const attrs = triangle[1];
    const corners = ["v1", "v2", "v3"].map((name) => {
      const value = new RegExp(`${name}="([^"]*)"`).exec(attrs);
      if (value === null) throw new ProjectError(`${options.where} has a triangle `
        + "without three vertices");
      return Number(value[1]);
    });
    const paintMatch = PAINT_RE.exec(attrs);
    const paintValue = paintMatch ? paintMatch[1] : "";
    const support = supportAttrs(attrs);
    const node = paintValue ? decodePaint(paintValue, options.where) : null;
    const pieces = [];
    if (!node || node.kind === "leaf") {
      pieces.push({ triangle: corners, state: node ? node.state : 0 });
    } else {
      if (supportSplit(attrs)) {
        throw new ProjectError(`${options.where} has a facet whose colour and whose `
          + "support or seam paint are both split; this tool cannot refine the two "
          + "trees together, so it will not export a facet it would repaint");
      }
      for (const leaf of leafTriangles(corners.map((at) => points[at]), node)) {
        pieces.push(leaf);
      }
    }
    for (const piece of pieces) {
      const indices = piece.triangle.map((corner) =>
        (Array.isArray(corner) ? addPoint(corner) : corner));
      const state = piece.state || options.base;
      if (!Number.isInteger(state) || state < 1 || state > options.sourcePaletteSize) {
        throw new ProjectError(`${options.where} prints in filament ${state}, and `
          + `this file's palette describes ${options.sourcePaletteSize} filament(s)`);
      }
      const colour = Math.max(0, (options.mapping[state] ?? state) - 1);
      if (colour >= options.paletteSize) {
        throw new ProjectError(`${options.where} would print colour ${colour + 1}, `
          + "which this export does not declare");
      }
      out.push(`\n  <triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}" `
        + `pid="${options.group}" p1="${colour}"${support}/>`);
    }
  }
  return { vertices: `${vertices.join("")}\n `, triangles: `${out.join("")}\n `,
           defaultIndex: baseIndex };
}

const key = (point) => `${point[0]},${point[1]},${point[2]}`;
const trim = (value) => Number(value.toFixed(6));

function decodePaint(value, where) {
  try {
    return paint.decode(value);
  } catch (error) {
    throw new ProjectError(`${where} carries paint this tool cannot read `
      + `(${error.message}); the export stopped instead of writing a colour that `
      + "would be wrong");
  }
}

/** The support/seam attributes of a triangle, carried onto every child.
 *
 * The names are translated to the Bambu-native spelling: a standard colour model
 * declares no `slic3rpe` namespace, so copying `slic3rpe:custom_supports` verbatim
 * would leave the member unparsable.  Values are preserved exactly, split trees
 * included. */
function supportAttrs(attrs) {
  const found = [];
  SUPPORT_ATTRS.lastIndex = 0;
  let match;
  while ((match = SUPPORT_ATTRS.exec(attrs)) !== null) {
    found.push(` ${nativeAttributeName(match[1])}="${match[2]}"`);
  }
  return found.join("");
}

const NATIVE_NAMES = {
  "slic3rpe:custom_supports": "paint_supports",
  custom_supports: "paint_supports",
  paint_supports: "paint_supports",
  "slic3rpe:custom_seam": "paint_seam",
  custom_seam: "paint_seam",
  paint_seam: "paint_seam",
};

const nativeAttributeName = (name) => NATIVE_NAMES[String(name)] || String(name);

/** True when a support/seam attribute is itself a split tree. */
function supportSplit(attrs) {
  SUPPORT_ATTRS.lastIndex = 0;
  let match;
  while ((match = SUPPORT_ATTRS.exec(attrs)) !== null) {
    if (!match[2]) continue;
    try {
      if (paint.isSplit(match[2])) return true;
    } catch (error) {
      throw new ProjectError(`a support or seam paint value (${match[2]}) could not `
        + `be read (${error.message})`);
    }
  }
  return false;
}

/**
 * The optional preservation of the source's *own* model intent, as object
 * metadata: a layer height and the support intent, and nothing about the printer,
 * the process or the filaments.
 *
 * Bambu's importer reads this block whatever the `Application` says, so it is how
 * a user who asks for it keeps the source's layer height and supports while still
 * choosing their own printer and process.  `tree_organic` is a real native style
 * (PrintConfig.cpp), so an organic source maps to `tree(manual|auto)` plus
 * `support_style=tree_organic` rather than pretending the style was preserved
 * silently.  The destination's first-layer height is left alone: per-object
 * first-layer support is not verified.
 */
function sourceSettingMetadata(project, objectId, target = "bambu", options = {}, painted = false) {
  const source = { ...(project.sourceSettings || {}),
                   ...(project.meta.get(objectId)?.settings || {}) };
  if (target==='snapmaker' && options.layerHeight && options.carrySettings===false) {
    return `<metadata key="layer_height" value="${resolveLayerHeight(source,options.u1Profile.match,options.layerHeight).height}"/>`;
  }
  const report = transferSettings(source, target, { object: true, baseline: options.u1Profile?.cfg });
  if (target === 'snapmaker' && options.u1Profile) constrainLayers(report.values, options.u1Profile.match);
  if (target==='snapmaker' && options.layerHeight) report.values.layer_height=String(resolveLayerHeight(source,options.u1Profile.match,options.layerHeight).height);
  if (target === "snapmaker" && painted && options.supportMode !== "off"
      && report.values.enable_support === "0") report.values.enable_support = "1";
  if (target === "snapmaker" && options.supportMode === "off") report.values.enable_support = "0";
  if (target === "snapmaker" && options.supportMode === "on") {
    report.values.enable_support = "1";
    report.values.support_type = (options.u1Profile?.cfg || BASE_SETTINGS).support_type;
    report.values.support_threshold_angle = (options.u1Profile?.cfg || BASE_SETTINGS).support_threshold_angle;
  }
  return Object.entries(report.values).map(([key, value]) =>
    `<metadata${target === "prusa" ? ' type="object"' : ""} key="${key}" value="${esc(value)}"/>`).join("");
}

/** The object blocks one member keeps, with paint remapped and names renamed. */
function copyMemberObjects(project, member, keep, mapping, target, rename, highest, negativeOnly = new Set()) {
  const blob = text(project.entries, member);
  if (blob === null) throw new ProjectError(`${member} is in the object graph but not `
    + "in the archive");
  const blocks = new Map();
  OBJECT_RE.lastIndex = 0;
  let match;
  while ((match = OBJECT_RE.exec(blob)) !== null) {
    const id = attr(match[1], "id");
    if (id === null || !keep.has(String(id))) continue;
    let body = match[0];
    // Cutters do not consume filament. Their colour annotations must not require
    // an extra physical reel; geometry and the native negative role are retained.
    if (negativeOnly.has(`${member}|${id}`)) body = body.replace(PAINT_RE_G, '');
    body = body.replace(PAINT_RE_G, (full, value) => {
      let out = value;
      if (value) {
        // Every source leaf has to name a colour this file really describes: an
        // unknown id would otherwise be carried through unchanged (or drawn
        // white) and the export would look complete while being wrong.
        let sourceLeaves;
        try {
          sourceLeaves = paint.walkStates(paint.decode(value));
        } catch (error) {
          throw new ProjectError(`a painted triangle in ${member} carries a value this `
            + `tool cannot read (${error.message}); the export stopped instead of `
            + "writing a colour that would be wrong");
        }
        for (const state of sourceLeaves) {
          if (state && !(state <= project.colors.length && project.colors[state - 1])) {
            throw new ProjectError(`a painted triangle in ${member} points at colour `
              + `${state}, which this file's palette does not describe, so no `
              + "trustworthy colour can be written for it");
          }
        }
        try {
          out = paint.remapText(value, mapping);
        } catch (error) {
          throw new ProjectError(`a painted triangle in ${member} carries a value this `
            + `tool cannot rewrite (${error.message}); the export stopped instead of `
            + "writing a colour that would be wrong");
        }
        for (const state of paint.walkStates(paint.decode(out))) {
          if (state > highest) {
            throw new ProjectError(`a painted triangle in ${member} would name `
              + `filament ${state}, but this export writes filaments 1..${highest}`);
          }
        }
      }
      return `${PAINT_ATTR[target]}="${out}"`;
    });
    body = body
      .replace(/(?:slic3rpe:)?custom_supports=/gi, `${SUPPORT_ATTR[target]}=`)
      .replace(/paint_supports=/gi, `${SUPPORT_ATTR[target]}=`)
      .replace(/(?:slic3rpe:)?custom_seam=/gi, `${SEAM_ATTR[target]}=`)
      .replace(/paint_seam=/gi, `${SEAM_ATTR[target]}=`);
    if (rename) {
      body = body.replace(COMPONENT_RE, (full, attrsText) => {
        const path = attr(attrsText, "p:path");
        if (!path) return full;                    // same member: path is implicit
        return full.replace(`p:path="${path}"`, `p:path="${rename(path)}"`);
      });
    }
    blocks.set(String(id), body);
  }
  return blocks;
}

/** Convert a project between dialects, keeping every source filament definition.
 *
 * Identity by default: colour *n* in the source becomes filament *n* in the
 * destination, whatever the count.  `options.mapping` overrides individual
 * source colours for the simple repaint (which is applied in one pass, so a swap
 * of 1 and 3 really swaps them rather than collapsing both onto one).  No
 * mixture is created and no colour is substituted unless the caller asks.
 *
 * `options.assignmentMode` says how that map is meant:
 *
 *   undefined / "repaint"  today's behaviour, unchanged.  The palette is written
 *                          as it was read and each painted facet names the
 *                          destination filament, so the facet is *printed in that
 *                          filament's colour*; several sources may share one and
 *                          their colours merge.
 *   "slots"                "arrange slots": every colour keeps its appearance and
 *                          travels to the filament it was sent to.  The map must
 *                          therefore be a complete bijection over the palette --
 *                          a non-bijective one is refused rather than written --
 *                          and the physical palette and its material types are
 *                          permuted to match, with the paint and the default
 *                          extruders rewritten to the same slots.
 */
const conversionUsageCache = new WeakMap();
/** Conservative whole-project usage: paint, part defaults and process references.
 * Keep numbered process slots (and their prefix) stable because slicer-specific
 * support/infill selectors are not all translated by the settings writer. */
export function conversionUsage(project) {
  if (conversionUsageCache.has(project)) return conversionUsageCache.get(project);
  const count = project.colors.length;
  const used = new Set();
  let reservedThrough = 0, uncertain = false;
  try {
    for (const plate of project.plates) {
      if (!eligibleObjects(project, plate.id).length) continue;
      const report = analyse(project, plate.id, null);
      report.used.forEach(id => used.add(id));
      if (report.counts.undecodable_paint) uncertain = true;
    }
    for (const meta of project.meta.values()) {
      for (const entry of [meta, ...(meta.parts || [])]) {
        if (isHiddenPart(entry.subtype)) uncertain = true;
        if (positive(entry.extruder)) used.add(positive(entry.extruder));
      }
    }
    // Also retain the writer's fallback for unassigned parts.
    used.add(1);
    const selector = /(?:support(?:_material)?(?:_interface)?|wall|sparse_infill|solid_infill|perimeter|infill)_(?:extruder|filament)/;
    for (const [name, bytes] of project.entries) {
      if (!/\.(?:config|xml)$/i.test(name)) continue;
      const blob = new TextDecoder().decode(bytes);
      const refs = [
        ...blob.matchAll(/"([\w]+)"\s*:\s*(?:\[\s*)?"?(\d+)"?/g),
        ...blob.matchAll(/^\s*;?\s*(\w+)\s*=\s*(\d+)\s*$/gm),
        ...blob.matchAll(/key="(\w+)"\s+value="(\d+)"/g),
      ];
      for (const match of refs) if (selector.test(match[1])) reservedThrough = Math.max(reservedThrough, Number(match[2]));
      // Custom tool-change sequences cannot safely be renumbered here.
      if (/custom_gcode_per_print_z/i.test(name) && /<code\b/.test(blob)) uncertain = true;
    }
  } catch (error) { uncertain = true; }
  for (let id = 1; id <= Math.min(count, reservedThrough); id++) used.add(id);
  const kept = Array.from({length:count}, (_,i)=>i+1).filter(id=>uncertain || used.has(id));
  const result = { kept, unused: Array.from({length:count}, (_,i)=>i+1).filter(id=>!kept.includes(id)), uncertain, reservedThrough: Math.min(count,reservedThrough) };
  conversionUsageCache.set(project, result);
  return result;
}

export function convertProject(project, plateId, objectIds, options = {}) {
  // A virtual blend is not one more solid reel: refuse before anything is built.
  refuseMixtures(project, "convert");
  const size = Math.max(project.paletteCount || 0, project.colors.length);
  const palette = [];
  for (let index = 1; index <= size; index += 1) {
    palette.push({ color: project.colors[index - 1] || "#FFFFFF",
                   type: project.types[index - 1] || "PLA", profile:options.filamentProfiles?.[index-1] || null });
  }
  const mapping = {};
  for (let index = 1; index <= size; index += 1) mapping[index] = index;
  for (const [source, id] of Object.entries(options.mapping || {})) {
    mapping[Number(source)] = Number(id);
  }
  // Arranging slots writes the colours in the order they were sent to.  The
  // refusal comes *before* anything is built, so a collision or an out-of-range
  // destination is a sentence rather than a file that has quietly lost a colour.
  const slots = options.assignmentMode === SLOTS;
  let physical = palette;
  if (slots) {
    const rule = completeRule(mapping, size);
    const problem = size ? bijectionProblem(rule, size, options.target === "snapmaker" ? Math.max(4, size) : size) : null;
    if (problem) {
      throw new ProjectError(`this slot arrangement cannot be written: ${problem}`);
    }
    physical = arrange(palette, rule, Math.max(size, ...Object.values(rule)))
      .map(reel => reel || {color: "#FFFFFF", type: "PLA"});
  }
  if (options.removeUnused === true) {
    const usage = conversionUsage(project);
    const kept = [...new Set([...usage.kept, ...(options.includeUnused || []).filter(id=>usage.unused.includes(id))])];
    const destinations = [...new Set([...kept.map(id=>mapping[id]), ...Array.from({length:usage.reservedThrough},(_,i)=>i+1)])].sort((a,b)=>a-b);
    // Physical U1 slot numbers must survive unused-colour cleanup. A neutral
    // unused entry holds any gap; no model region is assigned to that entry.
    if (slots && options.target === "snapmaker") {
      const occupied = new Set(destinations);
      const last = Math.max(...destinations);
      destinations.splice(0, destinations.length, ...Array.from({length:last}, (_,i)=>i+1));
      physical = physical.map((reel,i) => occupied.has(i+1) ? reel : {color:"#FFFFFF",type:"PLA"});
    }
    const compact = new Map(destinations.map((id,index)=>[id,index+1]));
    physical = destinations.map(id=>physical[id-1]);
    for (const source of Object.keys(mapping)) {
      if (kept.includes(Number(source))) mapping[source] = compact.get(mapping[source]);
      else delete mapping[source];
    }
  }
  return exportProject(project, plateId, objectIds, {
    target: options.target,
    physical,
    mapping,
    recipes: [],
    convert: true,
    assignmentMode: slots ? SLOTS : (options.assignmentMode || null),
    title: options.title,
    layout: options.layout || null,
    preserveSourceSettings: options.preserveSourceSettings === true,
    // The U1 target's own controls: whether the source's compatible print settings
    // travel, and which support decision wins.  Both belong to the snapshot the
    // page wrote, so a control change invalidates an export already in flight.
    u1Nozzle: options.u1Nozzle || "auto",
    layerHeight: options.layerHeight || null,
    carrySettings: options.carrySettings !== false,
    supportMode: normaliseSupportMode(options.supportMode),
    thumbnails: options.thumbnails || null,
  });
}

/**
 * Write one plate/selection as a project for the chosen target.
 *
 * Returns `{entries: Map<name, Uint8Array>, problems: string[], target,
 * palette, mapping}`. Everything it cannot do faithfully is a problem string
 * rather than a silently different file.
 */
export function exportProject(project, plateId, objectIds, options) {
  const target = normaliseTarget(options.target);
  // `physical` overrides the four reels for a source-preserving export: the file's
  // own colours become slots 1..4 instead of the loaded ones.
  // A *conversion* keeps every logical filament the source has; the recolour
  // workflow is the one that works in four reels.
  const convert = options.convert === true;
  // The printer-agnostic Bambu export: a standard colour model with no project
  // settings at all, so Bambu keeps the user's own printer/process/filaments and
  // centres the model on their real bed (the non-project import path).
  // Negative volumes need native project metadata, not the colour-model import.
  const negative = hasNegativeVolumes(project, objectIds || eligibleObjects(project, plateId));
  const standard = convert && target === "bambu" && !negative && !(options.physical || []).some(r=>r.profile);
  if (negative && target === 'prusa') throw new ProjectError('This selection contains negative cutout volumes. Prusa multi-volume export is not supported yet; choose Snapmaker Orca, Bambu Studio or OrcaSlicer to preserve them.');
  const reels = options.physical || options.reels || [];
  if (convert) {
    refuseMixtures(project, "convert");
    if (reels.length < 1 || reels.length > MAX_SOURCE_COLOURS) {
      throw new ProjectError(`this conversion writes 1..${MAX_SOURCE_COLOURS} `
        + "logical filaments; this file has " + reels.length);
    }
  } else if (reels.length !== 4) {
    throw new ProjectError("this tool writes four reels: four colours and four "
      + "materials, no more and no fewer");
  }
  const reelColours = reels.map((reel) => norm(reel.color) || "#FFFFFF");
  const reelTypes = reels.map((reel) => reel.type || "PLA");
  const recipes = options.recipes || [];
  if (!convert) {
    try {
      checkRecipes(4, recipes);
      checkTypes(reelTypes, recipes);
    } catch (error) {
      throw new ProjectError(error.message);
    }
  } else if (recipes.length) {
    throw new ProjectError("conversion preserves the source's own filaments; it "
      + "does not create mixtures");
  }
  // Pure conversion to generic OrcaSlicer is fine; *blends* are not, because
  // stock OrcaSlicer support for the Bambu mixed-filament arrays is not
  // established. Adding the conversion target must not advertise that path.
  if (!convert && recipes.length && target === "orca") {
    throw new ProjectError("generic OrcaSlicer support for native mixed filaments "
      + "is not established, so this tool will not write a blend into an OrcaSlicer "
      + "project; export it to Snapmaker Orca or Bambu Studio instead");
  }
  const mapping = {};
  Object.entries(options.mapping || {}).forEach(([source, id]) => {
    mapping[Number(source)] = Number(id);
  });
  const u1Profile = target === 'snapmaker' ? buildU1Profile(project.sourceSettings, reelTypes,
    options.u1Nozzle || 'auto', {blends: recipes.length > 0, carry: options.carrySettings !== false, layerHeight:options.layerHeight}) : null;
  options = {...options, u1Profile};
  const table = palette(reelColours, reelTypes, recipes);
  const colours = { };
  table.physical.forEach((colour, index) => { colours[index + 1] = colour; });
  table.virtual.forEach((item) => { colours[item.id] = item.color; });
  // A destination the export does not write would leave paint pointing at a
  // filament that is not in the file, so it is refused rather than clamped.
  const highest = reels.length + recipes.length;
  for (const [source, id] of Object.entries(mapping)) {
    if (!Number.isInteger(id) || id < 1 || id > highest) {
      throw new ProjectError(`the mapping sends source colour ${source} to filament `
        + `${id}, but this export writes filaments 1..${highest}`);
    }
  }

  const needed = neededMembers(project, plateId, objectIds);
  // One selection, placed by the layout plan: the copies come from this list, so
  // the file, the preview and the thumbnail cannot disagree about them.
  // Where the layout box's origin sits for this target: the printer-independent
  // Bambu model is centred on its own origin (the importer centres it again on the
  // user's bed), while the native project dialects keep the box's real centre.
  const layoutOptions = options.layout
    ? (target === "bambu" && !standard
      ? { ...options.layout, centre: [Number(options.layout.width) / 2,
                                     Number(options.layout.depth) / 2] }
      : targetLayout(target, options.layout))
    : null;
  if (layoutOptions) {
    const sources = (objectIds?.length ? objectIds : eligibleObjects(project, plateId))
      .map(id => ({ ...(project.sourceSettings || {}), ...(project.meta.get(String(id))?.settings || {}) }));
    Object.assign(layoutOptions, planningAllowance(sources, target,
      target === "snapmaker" ? options.carrySettings !== false : options.preserveSourceSettings,
      options.supportMode, target === "snapmaker" && supportPaintPresent(project, plateId, objectIds)));
  }
  const placed = layoutInstances(project, plateId, objectIds, layoutOptions);
  const instances = placed.instances;
  const placement = placed.plan;
  assertReachable(project, needed);
  assertSupportedGraph(project, needed);
  const chosen = new Set((objectIds && objectIds.length ? objectIds : eligibleObjects(
    project, plateId)).map(String));
  const problems = [];

  const resources = [];
  const settings = [];
  const rootIds = [];
  let nextId = 1;
  /* Output names first, so a copied member's own references can be pointed at them
     rather than at the file the user no longer has. */
  const memberNames = new Map();
  for (const [member] of needed) {
    memberNames.set(member, member === MODEL_FILE
      ? `${OBJECTS_DIR}object_inline.model`
      : (member.startsWith(OBJECTS_DIR) ? member
         : `${OBJECTS_DIR}${member.split("/").pop()}`));
  }
  const usedNames = new Set(memberNames.values());
  if (usedNames.size !== memberNames.size) {
    throw new ProjectError("two source members would be written under the same file "
      + "name, so a reference inside one of them would resolve to the wrong mesh");
  }
  const rename = (path) => {
    const source = String(path).replace(/^\//, "");
    const name = memberNames.get(source);
    if (!name) {
      throw new ProjectError(`${source} is referenced by a copied mesh but is not part `
        + "of this export");
    }
    return name;
  };
  const blocksByMember = new Map();
  // The colour an unpainted facet of each copied mesh takes: its own part's
  // default filament, read from the same metadata the paint path uses.  Resolved
  // before the member copy, because a facet with no paint reference needs it then.
  const innerBase = new Map();
  const negativeOnly = new Set(), printableRefs = new Set();
  for (const [objectId] of instances) {
    if (!chosen.has(String(objectId))) continue;
    const object = project.objects.get(String(objectId));
    if (!object) continue;
    const meta = project.meta.get(String(objectId));
    const metaParts = (meta && meta.parts) || [];
    // Keyed by member *and* object: the same object id in two members is two
    // different meshes, and a conflicting base is refused rather than guessed.
    const refs = object.components.map((component) => ({
      member: component.path ? component.path.replace(/^\//, "") : MODEL_FILE,
      id: String(component.objectid),
    }));
    if (object.hasMesh) refs.push({ member: MODEL_FILE, id: String(object.id) });
    for (const ref of refs) {
      const part = metaParts.find((item) => item.id === ref.id);
      const value = positive(part && part.extruder) ?? positive(meta && meta.extruder) ?? 1;
      const key = `${ref.member}|${ref.id}`;
      if (part?.subtype === 'negative_part') negativeOnly.add(key);
      else printableRefs.add(key);
      if (innerBase.has(key) && innerBase.get(key) !== value) {
        throw new ProjectError(`${ref.member} object ${ref.id} is referenced with two `
          + `different base filaments (${innerBase.get(key)} and ${value}), so an `
          + "unpainted facet has no single colour; this tool will not guess");
      }
      innerBase.set(key, value);
    }
  }
  for (const key of printableRefs) negativeOnly.delete(key);
  for (const [member, keep] of needed) {
    blocksByMember.set(member, standard
      ? copyMemberObjectsStandard(project, member, keep, mapping,
                                  { base: innerBase,
                                    paletteSize: table.physical.length }, rename)
      : copyMemberObjects(project, member, keep, mapping, target, rename, highest, convert ? new Set() : negativeOnly));
  }

  if (target === "prusa") {
    // PrusaSlicer describes volumes by triangle range inside the mesh, and this
    // writer only knows that range for a one-volume object. Rather than invent a
    // multi-volume mapping it refuses, and the page can offer another target.
    for (const [objectId] of instances) {
      if (!chosen.has(String(objectId))) continue;
      const object = project.objects.get(String(objectId));
      const meta = project.meta.get(String(objectId));
      const partCount = (object ? object.components.length : 0)
        + (object && object.hasMesh ? 1 : 0);
      if (partCount > 1) {
        throw new ProjectError(
          `${(meta && meta.name) || objectId} is built from ${partCount} volumes, and `
          + "this tool does not yet write PrusaSlicer's per-volume triangle ranges "
          + "faithfully. Export it to Snapmaker Orca or Bambu Studio, or save it from "
          + "your slicer as a single-volume file first");
      }
    }
  }
  const rootObjects = [];
  // Native Orca imports need a configured root per copy. Sharing a root loses
  // inherited base filaments on later copies and confuses tower collision checks.
  // The large mesh members are still shared by all of these small wrappers.
  const separateCopies = target === "snapmaker" || target === "orca"
    || (target === "bambu" && !standard);
  // Standard colour models and Prusa can share roots; native Orca copies need
  // distinct roots. All native roots share the same mesh members.
  const uniqueInstances = [];
  const seenObjects = new Set();
  for (const [objectId, itemTransform] of instances) {
    if (!separateCopies && seenObjects.has(String(objectId))) continue;
    seenObjects.add(String(objectId));
    uniqueInstances.push([objectId, itemTransform]);
  }
  for (const [objectId, itemTransform] of uniqueInstances) {
    if (!chosen.has(String(objectId))) continue;
    const meta = project.meta.get(String(objectId));
    const name = (meta && meta.name) || `object ${objectId}`;
    const components = [];
    const parts = [];
    let localMatrix = null;
    const object = project.objects.get(String(objectId));
    if (!object) continue;
    const metaParts = (meta && meta.parts) || [];
    const wanted = [...object.components];
    if (object.hasMesh) {
      // A whole object that *is* a mesh (the usual single-volume file) has no
      // components of its own, so it has to be added here or the root would be
      // written with an empty <components> block.
      wanted.push({ path: null, objectid: object.id, transform: null, whole: true });
    }
    if (!wanted.length) {
      throw new ProjectError(`object ${objectId} has no mesh and no parts this tool `
        + "can copy, so it would be exported empty");
    }
    for (const component of wanted) {
      const part = metaParts.find((item) => item.id === String(component.objectid));
      if (part && isHiddenPart(part.subtype)) {
        if (target === "prusa") {
          throw new ProjectError(
            `${meta && meta.name ? meta.name : objectId} carries a `
            + `${part.subtype} volume, and this tool cannot yet describe PrusaSlicer `
            + "volume roles faithfully; export it to Snapmaker or Bambu, or remove "
            + "that volume in a slicer");
        }
        // Orca and Bambu keep the role in the part's `subtype`, which is copied
        // below, so a negative or modifier volume stays exactly that.
      }
      const member = component.path ? component.path.replace(/^\//, "") : MODEL_FILE;
      if (!localMatrix) localMatrix = matrixFromText(component.transform);
      const world = matmul(matrixFromText(component.transform), matrixFromText(itemTransform));
      const sourceExtruder = positive(part && part.extruder)
        ?? positive(meta && meta.extruder) ?? 1;
      parts.push({ id: String(component.objectid), name: (part && part.name) || name,
                   extruder: !convert && part?.subtype === 'negative_part' ? 1 : resolveExtruder(project, mapping, highest, sourceExtruder,
                                             `${name} (${member} object `
                                             + `${component.objectid})`),
                   subtype: (part && part.subtype) || "normal_part" });
      if (target === "prusa") {
        // PrusaSlicer wants the mesh in the object, with the volume range in
        // triangle indices. Only one volume per object reaches here.
        const body = (blocksByMember.get(member) || new Map()).get(
          String(component.objectid));
        if (!body) {
          throw new ProjectError(`object ${objectId} uses a part that is not in this `
            + "export");
        }
        const mesh = /<mesh\b[\s\S]*?<\/mesh>/.exec(body);
        if (!mesh) {
          throw new ProjectError(`${member} object ${component.objectid} has no mesh to `
            + "write");
        }
        parts[parts.length - 1].transform = world;
        parts[parts.length - 1].mesh = mesh[0];
        parts[parts.length - 1].triangles = (mesh[0].match(/<triangle\b/g) || []).length;
      } else {
        // The component keeps its own placement; the *instance* placement goes on
        // the build item, so copies of one object share this single mesh member.
        const local = component.transform ? matrixFromText(component.transform)
          : IDENTITY_MATRIX();
        components.push(`    <component p:path="/${esc(memberNames.get(member))}" `
          + `objectid="${esc(component.objectid)}" p:UUID="${uuid()}" `
          + `transform="${transformText(local)}"/>`);
      }
    }
    if (target !== "prusa" && !components.length) {
      throw new ProjectError(`object ${objectId} would be written with no geometry`);
    }
    const rootId = nextId;
    nextId += 1;
    rootIds.push(rootId);
    rootObjects.push({ id: rootId, name, parts,
                       components: components.join("\n"),
                       mesh: parts[0] && parts[0].mesh,
                       triangles: parts[0] ? parts[0].triangles : 0,
                       transform: parts[0] ? parts[0].transform : null,
                       localMatrix: localMatrix || IDENTITY_MATRIX(),
                       objectId: String(objectId), itemTransform });
  }

  if (!rootObjects.length) {
    throw new ProjectError("nothing is selected, so there is nothing to write");
  }

  // The saved thumbnail is the *output* view: the caller renders it from the
  // same geometry and the same palette/mapping as this export (in the worker,
  // without WebGL).  An engine-only call may omit it and get no PNG members.
  const instanceCounts = new Map();
  let plateCopyIndex = 0;
  const plateInstances = instances.filter(([id]) => chosen.has(String(id)))
    .map(([id]) => {
      const root = separateCopies ? rootObjects[plateCopyIndex++]
        : rootObjects.find((entry) => entry.objectId === String(id));
      const instanceId = instanceCounts.get(root.id) || 0;
      instanceCounts.set(root.id, instanceId + 1);
      return { objectId: root.id, instanceId };
    });
  const plan = options.thumbnails
    ? thumbnailPlan({
        target,
        thumbnails: options.thumbnails,
        plateName: options.thumbnails.plateName
          || (plate(project, plateId) || {}).name || "Plate 1",
        instances: plateInstances,
        plateId,
      })
    : null;

  const paintedByObject = new Map();
  for (const root of rootObjects) {
    resources.push(target === "prusa"
      ? `  <object id="${root.id}" type="model">\n${root.mesh}\n  </object>`
      : `  <object id="${root.id}" p:UUID="${uuid()}" type="model">\n`
        + `   <components>\n${root.components}\n   </components>\n  </object>`);
    // A standard colour model has no filaments for an extruder index to mean, so
    // the object and part settings carry names and roles only; the colour comes
    // from the facet's own reference.
    const extruderOf = (value) => (standard ? ""
      : `<metadata key="extruder" value="${value}"/>`);
    const preserve = target === "snapmaker" ? options.carrySettings !== false || Boolean(options.layerHeight)
      : options.preserveSourceSettings;
    const sourceId = String(root.objectId);
    if (preserve && target === "snapmaker" && !paintedByObject.has(sourceId)) {
      paintedByObject.set(sourceId, supportPaintPresent(project, plateId, [sourceId]));
    }
    const preserved = preserve
      ? sourceSettingMetadata(project, sourceId, target, options, paintedByObject.get(sourceId)) : "";
    settings.push(`<object id="${root.id}"><metadata key="name" value="${esc(root.name)}"`
      + `/>${extruderOf(root.parts[0] ? root.parts[0].extruder : 1)}${preserved}`
      + root.parts.map((part) => `<part id="${esc(part.id)}" `
        + `subtype="${esc(part.subtype || "normal_part")}">`
        + `<metadata key="name" value="${esc(part.name)}"/>`
        + `${extruderOf(part.extruder)}</part>`).join("")
      + "</object>");
  }
  if (plan && plan.plate) settings.push(plan.plate);

  // Every copy is its own build item over the same mesh resources.  The instance
  // list already carries the layout-composed placement, so the item writes it as
  // it is -- composing again here would double the offset.
  let copyIndex = 0;
  const itemsXml = instances.map(([objectId, itemTransform]) => {
    if (!chosen.has(String(objectId))) return "";
    const root = separateCopies ? rootObjects[copyIndex++]
      : rootObjects.find((entry) => entry.objectId === String(objectId));
    if (!root) return "";
    return target === "prusa"
      ? `<item objectid="${root.id}" transform="${transformText(matmul(
          root.localMatrix || IDENTITY_MATRIX(), matrixFromText(itemTransform)))}" `
        + 'printable="1"/>'
      : `<item objectid="${root.id}" p:UUID="${uuid()}" transform="${transformText(
          matrixFromText(itemTransform))}" printable="1"/>`;
  }).filter(Boolean).join("\n");
  const application = target === "snapmaker"
    ? (recipes.length ? SNAPMAKER_SPECTRUM_APPLICATION : APPLICATION.snapmaker)
    : (standard ? OWN_APPLICATION : APPLICATION[target]);
  const namespaces = target === "prusa"
    ? 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
      + 'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"'
    : 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
      + 'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
      + 'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" '
      + (standard ? `xmlns:m="${COLOUR_NS}" ` : "")
      + `requiredextensions="${standard ? "p m" : "p"}"`;
  const header = target === "prusa" ? "" : ' <metadata '
    + 'name="BambuStudio:3mfVersion">1</metadata>\n';
  // The standard palette every colour reference in this file resolves against:
  // the source's own list, in order, including any slot no facet uses.
  // The colour resource must not collide with any object id in the same document,
  // so the root model uses one past its last object.
  const rootGroup = nextId;
  const paletteRgba = table.physical
    .map((colour) => `${norm(colour) || "#FFFFFF"}FF`);
  const colourGroup = standard ? colourGroupXml(rootGroup, paletteRgba) : "";
  // A rearranged slot list is not a repaint, and nobody can tell the two apart
  // from the colours alone once the file is on disk: the archive says which one
  // it is.  Repainting and the untouched identity export write no note, so their
  // bytes stay exactly what they were.
  const assignmentNote = options.assignmentMode === SLOTS && !isIdentity(mapping)
    ? "Filament slots rearranged: every colour keeps its own appearance and "
      + "prints from the filament it was moved to."
    : "";
  let model = `${XML_HEADER}<model unit="millimeter" xml:lang="en-US" ${namespaces}>\n`
    + ` <metadata name="Application">${esc(application)}</metadata>\n`
    + ` <metadata name="Title">${esc(options.title || project.title || "U1 project")}`
    + "</metadata>\n"
    + (assignmentNote ? ` <metadata name="Description">${esc(assignmentNote)}`
      + "</metadata>\n" : "")
    + header
    + ` <resources>\n${colourGroup}${resources.join("\n")}\n </resources>\n`
    + ` <build${target === "prusa" ? "" : ` p:UUID="${uuid()}"`}>\n${itemsXml}\n`
    + " </build>\n"
    + "</model>\n";

  let memberBlocks = [];
  if (target !== "prusa") {
    for (const [member, blocks] of blocksByMember) {
      const body = [...blocks.values()].join("\n");
      const memberGroup = standard ? colourGroupXml(blocks.group || rootGroup,
                                                    paletteRgba) : "";
      const memberHeader = `${XML_HEADER}<model unit="millimeter" xml:lang="en-US" `
        + `${namespaces}>\n${header} <resources>\n${memberGroup}${body}\n </resources>\n`
        + " <build/>\n</model>\n";
      memberBlocks.push([memberNames.get(member), encoder.encode(memberHeader)]);
    }
  }

  const members = new Map();
  members.set(MODEL_FILE, encoder.encode(model));
  for (const [name, data] of memberBlocks) members.set(name, data);
  if (target !== "prusa") {
    members.set("Metadata/model_settings.config",
                encoder.encode(`${XML_HEADER}<config>\n${settings.join("\n")}\n`
                               + "</config>\n"));
  }

  let spec;
  // What the U1 export did with the source's print intent, for the page to report
  // honestly (and for the tests to read without unpacking the archive).
  let settingNotes = null;
  if (target === "snapmaker") {
    const cfg = JSON.parse(JSON.stringify(u1Profile.cfg));
    cfg.filament_colour = table.physical.map((colour) => `${colour}FF`);
    cfg.extruder_colour = table.physical.slice();
    snapmakerConfig(cfg, table.physical, reelTypes, recipes);
    // The U1 compatibility the original converter always had: the source's own
    // print intent where this Orca accepts it, and its support decision.  Both are
    // in the session's snapshot, so a control change cannot be overtaken by an
    // export that started before it.
    const carry = options.carrySettings !== false;
    const mode = normaliseSupportMode(options.supportMode);
    const painted = supportPaintPresent(project, plateId, objectIds);
    const support = supportOf(project.sourceSettings);
    const supportNote = applySupport(cfg, support, mode, painted);
    const carried = carryPrintSettings(cfg, project.sourceSettings, carry);
    const speed = carry ? conservativeSpeeds(project.sourceSettings, u1Profile.cfg) : {values:{},notes:[]};
    Object.assign(cfg, speed.values);
    carried.push(...Object.keys(speed.values));
    const layerNotes = constrainLayers(cfg, u1Profile.match);
    if(options.layerHeight) {
      const layer=resolveLayerHeight(project.sourceSettings,u1Profile.match,options.layerHeight);
      cfg.layer_height=String(layer.height); carried.push('layer_height'); layerNotes.push(layer.text);
    }
    const filamentReport=applyFilamentProfiles(cfg,reels,{u1:true});
    u1Profile.filamentKeys.push(...filamentReport.keys);
    const overrides = setProcessOverrides(cfg, carried, recipes.length > 0);
    cfg.different_settings_to_system[0] = [...new Set([...overrides, ...u1Profile.processKeys])].sort().join(';');
    for (let i=0; i<reelTypes.length; i++) cfg.different_settings_to_system[i+1] = u1Profile.filamentKeys.join(';');
    cfg.different_settings_to_system[reelTypes.length+1] = 'nozzle_diameter;min_layer_height;max_layer_height';
    settingNotes = { carry, supportMode: mode, carried, support: supportNote,
                     supportsPainted: painted, overrides: cfg.different_settings_to_system[0].split(";"), profile: u1Profile.match.process.name, nozzle: u1Profile.match.nozzle, materials: cfg.filament_settings_id.slice(), notes: [...u1Profile.match.notes, ...speed.notes, ...layerNotes, ...filamentReport.notes] };
    members.set(SRC_BBL_PROJECT, encoder.encode(JSON.stringify(cfg, null, 4)));
  } else if (target === "bambu" || target === "orca") {
    if (standard) {
      // No project settings at all.  Bambu then reads this as a colour model:
      // the user's own printer, process and filaments are untouched, the model is
      // centred on their bed, and the palette is offered in the native colour
      // dialog.  Writing an anonymous preset bundle instead is what produced the
      // "Customized Preset" warning and the frozen off-bed placement.
      spec = null;
    } else {
      // OrcaSlicer reads Bambu Studio's project schema; only the application name
      // and the label differ.
      const cfg = bambuConfig(table.physical, reelTypes, recipes);
      const filamentReport=applyFilamentProfiles(cfg,reels);
      for(const key of filamentReport.keys) if(recipes.length && cfg[key].length===reels.length)
        cfg[key]=cfg[key].concat(recipes.map(r=>cfg[key][r.a-1]));
      settingNotes={materials:cfg.filament_settings_id.slice(),notes:filamentReport.notes};
      members.set(SRC_BBL_PROJECT, encoder.encode(JSON.stringify(cfg, null, 4)));
      spec = { cfg };
    }
  } else {
    // PrusaSlicer keeps the palette in its own print config, not in a Bambu-shaped
    // JSON, so nothing Bambu's mixture schema describes is written here.
    const cfg = {
      from: "project",
      filament_colour: table.physical.map((colour) => `${colour}FF`)
        .concat(table.virtual.map((item) => `${item.color}FF`)),
      filament_type: reelTypes.concat(table.virtual.map((item) => item.type)),
    };
    // No Slic3r_PE.config: it would override the user's own print preset, and the
    // documented Full Spectrum description below is what carries the palette.
    members.set(PRUSA_SPECTRUM_JSON,
                encoder.encode(prusaSpectrumJson(table.physical, reelTypes, recipes)));
    members.set(PRUSA_MODEL_CONFIG, encoder.encode(prusaModelConfig(rootObjects, project, options)));
    if(reels.some(r=>r.profile)) {
      cfg.filament_settings_id=reels.map(r=>r.profile?.name || `Generic ${r.type || 'PLA'}`);
      const filamentReport=applyFilamentProfiles(cfg,reels);
      if(recipes.length) {
        // Virtual entries inherit their first component's filament properties.
        for(const [key,values] of Object.entries(cfg)) if(Array.isArray(values) && values.length===reels.length)
          cfg[key]=values.concat(recipes.map(r=>values[r.a-1]));
      }
      members.set(SRC_PRUSA_PRINT,encoder.encode(prusaFilamentConfig(cfg)));
      for(const key of filamentReport.keys) if(recipes.length && cfg[key].length===reels.length)
        cfg[key]=cfg[key].concat(recipes.map(r=>cfg[key][r.a-1]));
      settingNotes={materials:cfg.filament_settings_id.slice(),notes:filamentReport.notes};
    }
    spec = { cfg };
  }

  if (target !== "prusa") {
    members.set("Metadata/slice_info.config",
                encoder.encode(`${XML_HEADER}<config>\n <header>\n`
                               + '  <header_item key="X-BBL-Client-Type" value="slicer"/>'
                               + "\n </header>\n</config>\n"));
  }
  members.set("[Content_Types].xml", encoder.encode(
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    + '\n <Default Extension="png" ContentType="image/png"/>'
    + '\n <Default Extension="config" ContentType="application/octet-stream"/>'
    + '\n <Default Extension="json" ContentType="application/json"/>'
    + "\n</Types>\n"));
  // The rendered output thumbnail travels as real PNG members, referenced from
  // the package root the way the 3MF core spec and the .3mf shell handler expect.
  if (plan) {
    for (const [name, bytes] of plan.members) members.set(name, bytes);
  }
  members.set("_rels/.rels", encoder.encode(
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" '
    + 'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    + (plan ? "\n" + relationshipXml(plan.rels).join("\n") : "")
    + "\n</Relationships>\n"));
  const rels = [...members.keys()].filter((name) => name.startsWith(OBJECTS_DIR));
  members.set(MODEL_RELS, encoder.encode(
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map((name, index) => `\n <Relationship Target="/${name}" Id="rel-${index + 2}" `
      + 'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>').join("")
    + "\n</Relationships>\n"));

  const problemsOut = [...problems];
  if (standard) {
    // The agnostic colour model must not smuggle a project in with it.
    if (members.has(SRC_BBL_PROJECT)) {
      problemsOut.push("a printer-agnostic colour model must not carry project "
        + "settings");
    }
    if (!colourGroup) {
      problemsOut.push("the colour group the facets reference is missing");
    }
  }
  if (target !== "snapmaker" && spec) {
    const cfg = spec.cfg;
    MACHINE_KEYS.forEach((key) => {
      if (key in cfg) problemsOut.push(`${key} would leak a U1 setting into a foreign `
        + "project");
    });
    // A logical colour is not a nozzle, and Bambu's own GUI check rejects a
    // project whose nozzle list is longer than one. Never infer hardware here.
    if ("nozzle_diameter" in cfg) {
      problemsOut.push("a portable project must not claim a nozzle per logical "
        + "filament");
    }
    BAMBU_ONLY_KEYS.forEach((key) => {
      if (target === "prusa" && key in cfg) {
        problemsOut.push(`${key} is Bambu's mixture schema, not PrusaSlicer's`);
      }
    });
  }
  return { entries: members, problems: problemsOut, target, colours, mapping,
           recipes, table, settings: settingNotes,
           thumbnails: plan ? { main: plan.main, small: plan.small } : null };
}

function prusaModelConfig(roots, project, options) {
  const lines = [XML_HEADER, "<config>\n"];
  for (const root of roots) {
    lines.push(` <object id="${root.id}">\n`);
    lines.push(`  <metadata type="object" key="name" value="${esc(root.name)}"/>\n`);
    if (options.preserveSourceSettings) lines.push(sourceSettingMetadata(project, root.objectId, "prusa", options));
    root.parts.forEach((part, index) => {
      const triangles = Number(root.triangles || 0);
      const last = Math.max(0, triangles - 1);
      const first = index === 0 ? 0 : last + 1;
      lines.push(`  <volume firstid="${first}" lastid="${last}">\n`);
      lines.push(`   <metadata type="volume" key="name" value="${esc(part.name)}"/>\n`);
      lines.push('   <metadata type="volume" key="volume_type" value="ModelPart"/>\n');
      lines.push(`   <metadata type="volume" key="extruder" value="${part.extruder}"/>\n`);
      lines.push("  </volume>\n");
    });
    lines.push(" </object>\n");
  }
  lines.push("</config>\n");
  return lines.join("");
}
