import { BASE_SETTINGS } from "../base_settings.js";

// The reviewed print-intent transfer for supported slicer projects.
//
// Based on the original converter's allowlist, expanded with explicit destination
// mappings for designer settings across the browser's supported slicers. Nothing here
// describes a *printer* or a *filament*: bed and filament temperatures, speeds,
// accelerations, retraction, purge and prime-tower numbers, toolchange and machine
// g-code and the bed geometry all belong to the machine that wrote the file, and
// copying them onto a U1 prints worse than the U1 profile does.

/* Settings that describe the print the user asked for, rather than the printer or
   the filament that produced the file. */
export const CARRY_KEYS = [
  // geometry and shells -- numbers only. Enum spellings change between Orca
  // versions (a Bambu file says ensure_vertical_shell_thickness = "enabled",
  // this Orca only knows "ensure_all"), and carrying one makes Orca pop up a
  // "some values have been replaced" warning on load. The U1 profile's own value
  // is right for a U1, so those keys are left alone.
  "layer_height", "initial_layer_print_height",
  "wall_loops", "top_shell_layers", "top_shell_thickness",
  "bottom_shell_layers", "bottom_shell_thickness",
  // infill
  "sparse_infill_density",
  "infill_anchor", "infill_anchor_max",
  // surface finish
  "ironing_spacing", "ironing_speed", "ironing_inset", "ironing_angle",
  "fuzzy_skin_thickness", "fuzzy_skin_point_distance",
  // first layer and adhesion
  "brim_width", "brim_object_gap",
  "elefant_foot_compensation", "elefant_foot_compensation_layers",
  // resolution and the painted-region knobs
  "resolution",
  "mmu_segmented_region_max_width", "mmu_segmented_region_interlocking_depth",
  // support geometry -- the on/off decision is handled by applySupport
  "support_threshold_overlap",
  "support_on_build_plate_only", "support_critical_regions_only",
  "support_remove_small_overhang",
  "seam_position", "wall_generator", "detect_thin_wall", "infill_direction",
  "infill_wall_overlap", "internal_solid_infill_pattern",
  "support_top_z_distance", "support_bottom_z_distance", "support_object_xy_distance",
  "support_base_pattern_spacing", "support_interface_spacing",
  "support_bottom_interface_spacing", "support_interface_top_layers",
  "support_interface_bottom_layers", "support_expansion", "support_style",
  "tree_support_branch_angle", "tree_support_branch_diameter",
  "tree_support_branch_distance", "tree_support_tip_diameter", "tree_support_brim_width",
  "raft_layers", "raft_expansion", "raft_first_layer_expansion", "raft_contact_distance",
  "skirt_loops", "skirt_distance", "skirt_height",
  // reviewed enums, whose spellings are stable across versions
  "sparse_infill_pattern", "top_surface_pattern", "bottom_surface_pattern",
  "ironing_type", "ironing_pattern", "brim_type",
];

/** Orca loads a matching preset using this list of explicit process overrides.
 * Writing values into project_settings.config alone is not sufficient. Mark
 * reviewed, deliberately applied values even when they equal our bundled
 * baseline: the user's installed preset may have different defaults.
 * Order is process, one entry per configured filament, then printer.
 * Never reuse the source's list: it can contain foreign machine settings.
 */
export function setProcessOverrides(cfg, carried, blends = false) {
  const keys = new Set([
    ...carried.filter((key) => CARRY_KEYS.includes(key)),
    "enable_support", "support_type", "support_threshold_angle",
  ]);
  if (blends) {
    for (const key of ["mixed_filament_definitions", "mixed_color_layer_height_a",
      "mixed_color_layer_height_b", "mixed_filament_gradient_mode",
      "mixed_filament_advanced_dithering", "mixed_filament_height_lower_bound",
      "mixed_filament_height_upper_bound", "dithering_z_step_size",
      "dithering_local_z_mode", "dithering_step_painted_zones_only",
      "adaptive_layer_height"]) keys.add(key);
  }
  const process = [...keys].filter((key) => cfg[key] !== undefined).sort();
  cfg.different_settings_to_system = [process.join(";"),
    ...Array(cfg.filament_colour.length + 1).fill("")];
  return process;
}

/* PrusaSlicer names for several of the same settings.  Without these a Prusa
   project carries far less than a Bambu one, because the names do not match. */
export const PRUSA_ALIASES = {
  support_style: ["support_material_style"],
  brim_object_gap: ["brim_separation"],
  infill_anchor: ["sparse_infill_anchor"],
  infill_anchor_max: ["sparse_infill_anchor_max"],
  detect_thin_wall: ["thin_walls"],
  infill_direction: ["fill_angle"],
  infill_wall_overlap: ["infill_overlap"],
  wall_generator: ["perimeter_generator"],
  support_top_z_distance: ["support_material_contact_distance"],
  support_bottom_z_distance: ["support_material_bottom_contact_distance"],
  support_object_xy_distance: ["support_material_xy_spacing"],
  support_base_pattern_spacing: ["support_material_spacing"],
  support_interface_spacing: ["support_material_interface_spacing"],
  support_interface_top_layers: ["support_material_interface_layers"],
  support_interface_bottom_layers: ["support_material_bottom_interface_layers"],
  skirt_loops: ["skirts"],
  support_on_build_plate_only: ["support_material_buildplate_only"],
  initial_layer_print_height: ["first_layer_height"],
  wall_loops: ["perimeters"],
  top_shell_layers: ["top_solid_layers"],
  bottom_shell_layers: ["bottom_solid_layers"],
  top_shell_thickness: ["top_solid_min_thickness"],
  bottom_shell_thickness: ["bottom_solid_min_thickness"],
  sparse_infill_density: ["fill_density"],
  sparse_infill_pattern: ["fill_pattern"],
  internal_solid_infill_pattern: ["solid_infill_pattern"],
  top_surface_pattern: ["top_fill_pattern"],
  bottom_surface_pattern: ["bottom_fill_pattern"],
};

/* Values this Orca will accept.  There is no schema to check against, so these are
   the spellings known to work; anything else keeps the U1 profile's value.  A newer
   Orca writes values this one does not know -- "enabled" for an enum, -1 for
   raft_first_layer_expansion meaning "auto" -- and Orca either warns about them or
   refuses to open the file, so carrying them unchecked is worse than not carrying. */
export const ENUM_VALUES = {
  seam_position: ["aligned", "nearest", "random", "back"],
  wall_generator: ["classic", "arachne"],
  internal_solid_infill_pattern: ["rectilinear", "monotonic", "monotonicline", "concentric"],
  support_style: ["default", "grid", "snug", "tree_slim", "tree_strong", "tree_hybrid", "tree_organic"],
  sparse_infill_pattern: [
    "grid", "line", "concentric", "honeycomb", "3dhoneycomb", "gyroid",
    "crosshatch", "cubic", "triangles", "tri-hexagon", "star", "supportcubic",
    "lightning", "zig-zag", "cross-zag", "rectilinear", "monotonic",
    "monotonicline", "alignedrectilinear"],
  top_surface_pattern: [
    "monotonic", "monotonicline", "rectilinear", "concentric", "zig-zag",
    "cross-zag", "alignedrectilinear"],
  bottom_surface_pattern: [
    "monotonic", "monotonicline", "rectilinear", "concentric", "zig-zag",
    "cross-zag", "alignedrectilinear"],
  ironing_type: ["no ironing", "top", "topmost", "solid"],
  ironing_pattern: ["rectilinear", "concentric", "zig-zag"],
  brim_type: ["auto_brim", "outer_only", "inner_only", "no_brim",
              "outer_and_inner", "brim_ears"],
};

/* How a source states its support decision.  PrusaSlicer uses support_material*
   and Orca/Bambu use enable_support -- the same two vocabularies the legacy
   converter read. */
export const SUPPORT_KEYS = [
  "enable_support", "support_type", "support_style", "support_threshold_angle",
  "support_material", "support_material_auto", "support_material_style",
  "support_material_threshold",
];

/* Every key the source reader has to keep for this module to work: the allowlist,
   the PrusaSlicer spellings and the support vocabulary. */
export const SOURCE_KEYS = [...new Set([
  ...CARRY_KEYS,
  ...Object.values(PRUSA_ALIASES).flat(),
  ...SUPPORT_KEYS,
])];

export const SUPPORT_MODES = ["auto", "on", "off"];

/** One of the three support modes; anything else is the source's own decision. */
export function normaliseSupportMode(mode) {
  const value = String(mode === undefined || mode === null ? "" : mode).toLowerCase();
  return SUPPORT_MODES.includes(value) ? value : "auto";
}

/** Would this Orca accept the value as it stands? */
export function acceptable(key, value) {
  if (["support_on_build_plate_only", "support_critical_regions_only",
       "support_remove_small_overhang", "detect_thin_wall"].includes(key)) return ["0", "1"].includes(value);
  if (ENUM_VALUES[key]) return ENUM_VALUES[key].includes(value);
  // Orca writes percentages as "400%", so the suffix is part of the value
  const n = Number(String(value).replace(/%$/, ""));
  return Number.isFinite(n) && n >= 0;
}

/** The value this key would carry, looking through the PrusaSlicer spellings.
 *
 * Returns `undefined` when the source states nothing usable for the key.  Kept
 * separate from the write so the page can show the same list the export applies.
 */
function carriedValue(sourceSettings, key) {
  if (!sourceSettings) return undefined;
  let name = key;
  if (!(name in sourceSettings)) {
    name = (PRUSA_ALIASES[key] || []).find((alias) => alias in sourceSettings);
    if (!name) return undefined;
  }
  let value = sourceSettings[name];
  if (Array.isArray(value)) value = value.length ? value[0] : null;
  if (value === null || value === undefined || value === "") return undefined;
  value = String(value);
  if (key === "seam_position" && value === "rear") value = "back";
  if (key === "support_style" && value === "organic") value = "tree_organic";
  return acceptable(key, value) ? value : undefined;
}

// Only explicitly mapped Prusa keys are written. Unknown destination features
// stay out rather than becoming unrecognised object options.
const PRUSA_NAMES = {
  layer_height: "layer_height", initial_layer_print_height: "first_layer_height",
  wall_loops: "perimeters", top_shell_layers: "top_solid_layers",
  bottom_shell_layers: "bottom_solid_layers", top_shell_thickness: "top_solid_min_thickness",
  bottom_shell_thickness: "bottom_solid_min_thickness", sparse_infill_density: "fill_density",
  sparse_infill_pattern: "fill_pattern", internal_solid_infill_pattern: "solid_infill_pattern",
  top_surface_pattern: "top_fill_pattern", bottom_surface_pattern: "bottom_fill_pattern",
  seam_position: "seam_position", infill_anchor: "infill_anchor", infill_anchor_max: "infill_anchor_max",
  infill_direction: "fill_angle", infill_wall_overlap: "infill_overlap",
  wall_generator: "perimeter_generator", detect_thin_wall: "thin_walls",
  brim_width: "brim_width", brim_object_gap: "brim_separation",
  raft_layers: "raft_layers", raft_expansion: "raft_expansion",
  skirt_loops: "skirts", skirt_distance: "skirt_distance", skirt_height: "skirt_height",
  support_on_build_plate_only: "support_material_buildplate_only",
  support_top_z_distance: "support_material_contact_distance",
  support_bottom_z_distance: "support_material_bottom_contact_distance",
  support_object_xy_distance: "support_material_xy_spacing",
  support_base_pattern_spacing: "support_material_spacing",
  support_interface_spacing: "support_material_interface_spacing",
  support_interface_top_layers: "support_material_interface_layers",
  support_interface_bottom_layers: "support_material_bottom_interface_layers",
  resolution: "resolution", elefant_foot_compensation: "elefant_foot_compensation",
  ironing_spacing: "ironing_spacing", ironing_speed: "ironing_speed",
};

/** Compatible object-level print settings and explicit omissions, by target. */
export function transferSettings(source, target, { object = false } = {}) {
  const values = {}, skipped = [];
  for (const key of CARRY_KEYS) {
    const present = source && [key, ...(PRUSA_ALIASES[key] || [])].some((k) => k in source);
    if (!present) continue;
    let value = carriedValue(source, key);
    let name = target === "prusa" ? PRUSA_NAMES[key] : key;
    if (target === "bambu" && key.startsWith("infill_anchor")) name = key.replace("infill_", "sparse_infill_");
    if (object && key === "initial_layer_print_height") name = null;
    if (target === "prusa" && key === "seam_position" && value === "back") value = "rear";
    if (target === "prusa" && key.endsWith("pattern") && value === "monotonicline") value = "monotonic";
    if (target === "prusa" && key === "sparse_infill_pattern"
        && !["rectilinear", "alignedrectilinear", "grid", "triangles", "stars", "cubic", "line",
             "concentric", "honeycomb", "3dhoneycomb", "gyroid", "supportcubic", "lightning"].includes(value)) name = null;
    if (value === undefined || !name) { skipped.push(key); continue; }
    values[name] = value;
  }
  const support = supportOf(source);
  if (support) {
    if (target === "prusa") {
      values.support_material = support.enabled ? "1" : "0";
      if (support.type) {
        values.support_material_auto = support.type.includes("manual") ? "0" : "1";
        values.support_material_style = support.type.startsWith("tree") ? "organic"
          : ["snug", "grid"].includes(source.support_style || source.support_material_style)
            ? (source.support_style || source.support_material_style) : "grid";
      }
      if (support.angle) values.support_material_threshold = String(support.angle);
    } else {
      values.enable_support = support.enabled ? "1" : "0";
      if (support.type) values.support_type = support.type;
      if (support.angle) values.support_threshold_angle = String(support.angle);
      if (source?.support_material_style === "organic") values.support_style = "tree_organic";
    }
  }
  return { values, skipped };
}

/** Printable additions around a model. Automatic brim/support contours only
 * exist after slicing; report them rather than claiming an exact footprint. */
export function planningAllowance(sources, target, enabled, mode = "auto", painted = false) {
  let padding = 0, extraHeight = 0;
  const notes = new Set();
  for (const source of sources.length ? sources : [{}]) {
    const cfg = target === "snapmaker" ? { ...BASE_SETTINGS } : {};
    if (enabled) Object.assign(cfg, transferSettings(source, "snapmaker").values);
    if (target === "snapmaker") applySupport(cfg, supportOf(source), mode, painted);
    const n = (key) => Math.max(0, Number(cfg[key]) || 0);
    let reach = 0;
    if (cfg.enable_support === "1") {
      if (String(cfg.support_type).includes("auto")) {
        reach = Math.max(3, n("support_object_xy_distance") + n("tree_support_branch_diameter") / 2);
        notes.add("automatic supports: estimated 3 mm minimum allowance; verify generated branches after slicing");
      } else {
        reach = Math.max(3, n("support_object_xy_distance"));
        notes.add("painted supports: estimated 3 mm minimum allowance; check generated support reach after slicing");
      }
    }
    const brim = cfg.brim_type || (enabled && source.brim_width !== undefined ? "outer_only" : null);
    if (["outer_only", "outer_and_inner"].includes(brim)) {
      reach += n("brim_width") + n("brim_object_gap");
    } else if (["auto_brim", "brim_ears"].includes(brim)) {
      notes.add("automatic brims/ears are decided by the slicer and need a final clearance check");
    }
    if (n("raft_layers") > 0) {
      reach = Math.max(reach, n("raft_expansion") + n("raft_first_layer_expansion"));
      extraHeight = Math.max(extraHeight, n("raft_layers") * (n("layer_height") || 0.2));
      if (Number(cfg.raft_first_layer_expansion) < 0
          || (enabled && Number(source.raft_first_layer_expansion) < 0)) {
        notes.add("automatic raft expansion needs a slicer check");
      }
    }
    if (n("skirt_loops") > 0) {
      reach = Math.max(reach, n("skirt_distance") + n("skirt_loops") * 0.5);
      notes.add("skirt clearance includes an estimated 0.5 mm per loop");
    }
    padding = Math.max(padding, reach);
  }
  return { padding, extraHeight, footprintNotes: [...notes] };
}

/** The allowlisted keys and values this source would really contribute, in order.
 *
 * The page shows this list instead of a claim about "your settings survive", so a
 * value Orca would not accept is never promised.
 */
export function appliedSettings(sourceSettings, enabled = true) {
  if (!sourceSettings || !enabled) return [];
  const out = [];
  for (const key of CARRY_KEYS) {
    const value = carriedValue(sourceSettings, key);
    if (value !== undefined) out.push({ key, value });
  }
  return out;
}

/** Overlay the source's print-intent settings onto the U1 config; returns the keys carried. */
export function carryPrintSettings(cfg, sourceSettings, enabled = true) {
  if (!sourceSettings || !enabled) return [];
  const carried = [];
  for (const key of CARRY_KEYS) {
    const value = carriedValue(sourceSettings, key);
    if (value === undefined) continue;
    cfg[key] = Array.isArray(cfg[key])
      ? new Array(cfg[key].length || 1).fill(value)
      : value;
    carried.push(key);
  }
  return carried;
}

const asFloat = (value) => {
  const n = Number(String(value === undefined || value === null ? "" : value).trim());
  return Number.isFinite(n) ? n : null;
};

const isFlag = (value) => ["0", "1", "true", "false"]
  .includes(String(value === undefined ? "" : value).trim().toLowerCase());

/** A PrusaSlicer project's support decision, or null when it states none. */
export function prusaSupport(cfg) {
  const raw = String((cfg && cfg.support_material) || "").trim().toLowerCase();
  if (!isFlag(raw)) return null;
  const style = String((cfg && cfg.support_material_style) || "").trim().toLowerCase();
  const auto = !["0", "false"].includes(
    String(cfg && cfg.support_material_auto === undefined ? "1" : cfg.support_material_auto)
      .trim().toLowerCase());
  const angle = asFloat(cfg && cfg.support_material_threshold);
  return {
    enabled: raw === "1" || raw === "true",
    type: `${["organic", "tree"].includes(style) ? "tree" : "normal"}` +
          `(${auto ? "auto" : "manual"})`,
    angle: angle && angle > 0 ? angle : null,
  };
}

/** An Orca/Bambu project's support decision, or null when it states none.
 *
 * The type is the source's own native spelling and is carried as it stands: this
 * tool does not invent a support style the file did not name.
 */
export function bambuSupport(cfg) {
  const raw = cfg ? cfg.enable_support : undefined;
  if (raw === undefined || raw === null || raw === "") return null;
  const type = cfg.support_type;
  const angle = asFloat(cfg.support_threshold_angle);
  return {
    enabled: ["1", "true"].includes(String(raw).trim().toLowerCase()),
    type: type ? String(type) : null,
    angle: angle && angle > 0 ? angle : null,
  };
}

/** The support decision behind a file, whichever slicer wrote it. */
export function supportOf(sourceSettings) {
  if (!sourceSettings) return null;
  return prusaSupport(sourceSettings) || bambuSupport(sourceSettings);
}

/** Write the support decision into a project config; returns the sentence to show.
 *
 * `mode` is "auto" (follow the source), "on" (enable with the profile's own type
 * and threshold) or "off".  `painted` says whether the model carries painted
 * support enforcers: leaving those with support switched off is a contradiction
 * Orca refuses to let pass, so it is never done quietly here.
 */
export function applySupport(cfg, support, mode = "auto", painted = false) {
  const chosen = normaliseSupportMode(mode);
  if (chosen === "off") {
    cfg.enable_support = "0";
    return painted
      ? "supports off (asked for it) -- NOTE the model has painted support enforcers, "
        + "which do nothing with support off; Orca will warn about them"
      : "supports off (asked for it)";
  }
  if (chosen === "on") {
    cfg.enable_support = "1";
    return `supports on, profile defaults: ${cfg.support_type} at `
      + `${cfg.support_threshold_angle} degrees`;
  }
  if (support === null) {
    return "source had no support setting, left at the profile default "
      + `(enable_support=${cfg.enable_support})`;
  }
  if (!support.enabled) {
    if (painted) {
      cfg.enable_support = "1";
      return "supports enabled: the source has them off but carries painted support "
        + "enforcers, which are meaningless without support";
    }
    cfg.enable_support = "0";
    return "supports off (the source had them off)";
  }
  cfg.enable_support = "1";
  if (support.type) cfg.support_type = support.type;
  if (support.angle) cfg.support_threshold_angle = String(Math.round(support.angle));
  return `supports carried over: ${cfg.support_type} at `
    + `${cfg.support_threshold_angle} degrees`;
}
