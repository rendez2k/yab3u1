// The reviewed print-intent transfer for a Snapmaker U1 project.
//
// These are the helpers the original page converter (`web/converter.js`) and the
// desktop tool (`u1convert.py`) already applied, moved into the shared modules so
// the homepage converter carries exactly the same things they did.  Nothing here
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
  // reviewed enums, whose spellings are stable across versions
  "sparse_infill_pattern", "top_surface_pattern", "bottom_surface_pattern",
  "ironing_type", "ironing_pattern", "brim_type",
];

/* PrusaSlicer names for several of the same settings.  Without these a Prusa
   project carries far less than a Bambu one, because the names do not match. */
export const PRUSA_ALIASES = {
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
  return acceptable(key, value) ? value : undefined;
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
