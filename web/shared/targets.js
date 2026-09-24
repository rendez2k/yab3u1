// The three project targets, in the browser.
//
// Same contract as u1targets.py / u1spectrum.py, checked against them by
// web/tests/parity.test.mjs for the parts both implement (normalisation, recipe
// rows, virtual ids, palette prediction and validation).
//
// Snapmaker Orca: `mixed_filament_definitions`, physical arrays left at four --
// the length of filament_colour is how the slicer works out the id base.
// Bambu Studio: the palette grows, with Bambu's own mixed-filament arrays.
// PrusaSlicer: `Metadata/Prusa_Slicer_full_spectrum.json`, paint in
// `slic3rpe:mmu_segmentation`.
//
// A foreign target is a *portable colour project*: no U1 printer, process, start
// or end G-code goes into it.

import { norm } from "./colour.js";
import { mixHex } from "./mix.js";
import { mixFdmHex, FDM_MODEL } from './fdmMix.js';

export const TARGETS = ["snapmaker", "bambu", "orca", "prusa"];
// The recolour page's blends are only written to the dialects whose native
// mixture schema this tool has actually verified.  Generic OrcaSlicer is a
// *conversion* target (Bambu-family paint, no invented blend path), so it is
// deliberately absent here -- keep the two lists apart.
export const RECOLOUR_TARGETS = ["snapmaker", "bambu", "prusa"];
export const MAX_VISIBLE = 16;
export const MAX_RECIPES = MAX_VISIBLE - 4;

export const LABELS = {
  snapmaker: "Snapmaker Orca (U1 · native Full Spectrum)",
  bambu: "Bambu Studio (colour + native mixed filaments)",
  orca: "OrcaSlicer (portable colour project)",
  prusa: "PrusaSlicer (colour + native Full Spectrum)",
};

export const APPLICATION = {
  snapmaker: "Snapmaker Orca",
  // The version the documented mixed-filament schema ships in; do not bump it to
  // a newer build than the format notes describe.
  bambu: "BambuStudio-02.07.01.62",
  // OrcaSlicer shares Bambu Studio's project schema but has its own identity; the
  // app name is written without inventing a build number.
  orca: "OrcaSlicer",
  prusa: "PrusaSlicer-2.9.6",
};

export const PAINT_ATTR = {
  snapmaker: "paint_color",
  bambu: "paint_color",
  orca: "paint_color",
  prusa: "slic3rpe:mmu_segmentation",
};

export const SUPPORT_ATTR = {
  snapmaker: "paint_supports",
  bambu: "paint_supports",
  orca: "paint_supports",
  prusa: "slic3rpe:custom_supports",
};

export const SEAM_ATTR = {
  snapmaker: "paint_seam",
  bambu: "paint_seam",
  orca: "paint_seam",
  prusa: "slic3rpe:custom_seam",
};

export const PRUSA_MODEL_CONFIG = "Metadata/Slic3r_PE_model.config";
export const PRUSA_SPECTRUM_JSON = "Metadata/Prusa_Slicer_full_spectrum.json";
export const PRUSA_PRINT_CONFIG = "Metadata/Slic3r_PE.config";

export class TargetError extends Error {}

export function normalise(target) {
  const name = String(target || "snapmaker").trim().toLowerCase();
  const aliases = {
    // "Snapmaker Orca" is the U1's own build; plain "OrcaSlicer" is its own
    // target, so the two must not be aliased together.
    "snapmaker orca": "snapmaker", u1: "snapmaker",
    orcaslicer: "orca", "orca slicer": "orca",
    "bambu studio": "bambu", "bambu studio 2.7": "bambu",
    prusaslicer: "prusa", "prusa slicer": "prusa",
  };
  const resolved = aliases[name] || name;
  if (!TARGETS.includes(resolved)) {
    throw new TargetError(`unknown target ${target}; choose one of `
      + TARGETS.join(", "));
  }
  return resolved;
}

export function virtualId(physical, index) {
  return physical + index + 1;
}

export function check(physical, recipes) {
  if (physical < 1) {
    throw new TargetError("a Full Spectrum project needs at least one physical reel");
  }
  if (recipes.length > MAX_RECIPES) {
    throw new TargetError(`${recipes.length} recipes would need `
      + `${physical + recipes.length} filament ids and this writer stops at `
      + `${MAX_VISIBLE}; keep at most ${MAX_RECIPES}`);
  }
  if (physical + recipes.length > MAX_VISIBLE) {
    throw new TargetError(`${physical} reels plus ${recipes.length} recipes exceed `
      + `the ${MAX_VISIBLE} ids this writer can serialise without ambiguity`);
  }
  recipes.forEach((recipe, index) => {
    const { a, b, percent } = recipe;
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new TargetError(`recipe ${index + 1} needs integer reels`);
    }
    if (a === b || a < 1 || a > physical || b < 1 || b > physical) {
      throw new TargetError(`recipe ${index + 1} must name two different reels out `
        + `of 1-${physical}`);
    }
    if (!Number.isInteger(percent) || percent <= 0 || percent >= 100) {
      throw new TargetError(`recipe ${index + 1} needs a share between 1 and 99 `
        + "per cent");
    }
  });
}

export function checkTypes(physicalTypes, recipes) {
  recipes.forEach((recipe, index) => {
    const first = String(physicalTypes[recipe.a - 1] ?? "").trim().toUpperCase();
    const second = String(physicalTypes[recipe.b - 1] ?? "").trim().toUpperCase();
    if (first !== second) {
      throw new TargetError(`recipe ${index + 1} would blend reel ${recipe.a} `
        + `(${first || "?"}) with reel ${recipe.b} (${second || "?"}); only two reels `
        + "of the same material can be mixed");
    }
  });
}

export function row(a, b, { enabled, custom, percent, deleted, stableId }) {
  return `${a},${b},${enabled ? 1 : 0},${custom ? 1 : 0},${percent},0,g,w,m2,z0,`
    + `xa0,xb0,d${deleted ? 1 : 0},o${custom ? 0 : 1},u${stableId}`;
}

export function definitions(physical, recipes) {
  check(physical, recipes);
  const rows = [];
  let stable = 1;
  for (const recipe of recipes) {
    rows.push(row(recipe.a, recipe.b, { enabled: true, custom: true,
                                        percent: recipe.percent, deleted: false,
                                        stableId: stable }));
    stable += 1;
  }
  for (let a = 1; a <= physical; a += 1) {
    for (let b = a + 1; b <= physical; b += 1) {
      rows.push(row(a, b, { enabled: false, custom: false, percent: 50,
                            deleted: true, stableId: stable }));
      stable += 1;
    }
  }
  return rows;
}

export function palette(physicalColors, physicalTypes, recipes) {
  const physical = physicalColors.map((c) => norm(c) || "#FFFFFF");
  const virtual = recipes.map((recipe, index) => ({
    id: virtualId(physical.length, index),
    color: (recipe.model===FDM_MODEL ? mixFdmHex : mixHex)(physical[recipe.a - 1], physical[recipe.b - 1], recipe.percent),
    a: recipe.a, b: recipe.b, percent: recipe.percent,
    type: physicalTypes[recipe.a - 1] || "PLA",
  }));
  return { physical, virtual };
}

export function snapmakerConfig(cfg, physicalColors, physicalTypes, recipes) {
  check(physicalColors.length, recipes);
  checkTypes(physicalTypes, recipes);
  const colours = physicalColors.map((c) => norm(c) || "#FFFFFF");
  const total = colours.length;
  cfg.filament_colour = colours.map((c) => c + "FF");
  cfg.extruder_colour = colours.slice();
  cfg.filament_type = physicalTypes.map((t) => t || "PLA");
  cfg.nozzle_diameter = new Array(total).fill(cfg.nozzle_diameter?.[0] || "0.4");
  // Orca uses diameter count to validate filament presets. A leftover fourth
  // diameter in a three-colour project creates a phantom, unnamed preset.
  cfg.filament_diameter = new Array(total).fill("1.75");
  for (const key of BAMBU_ONLY_KEYS) delete cfg[key];
  if (!recipes.length) return cfg;
  Object.assign(cfg, {
    mixed_filament_definitions: definitions(colours.length, recipes).join(";"),
    mixed_color_layer_height_a: "0",
    mixed_color_layer_height_b: "0",
    mixed_filament_gradient_mode: "0",
    mixed_filament_advanced_dithering: "0",
    mixed_filament_height_lower_bound: "0.04",
    mixed_filament_height_upper_bound: "0.16",
    dithering_z_step_size: "0",
    dithering_local_z_mode: "0",
    dithering_step_painted_zones_only: "1",
    adaptive_layer_height: "0",
  });
  return cfg;
}

export const BAMBU_ONLY_KEYS = [
  "filament_is_mixed", "filament_mixed_components", "filament_mixed_sublayer_ratios",
  "filament_multi_colour", "filament_mixed_gradient",
  "filament_mixed_gradient_per_part", "filament_mixed_gradient_range",
  "filament_mixed_gradient_curve", "enable_mixed_color_sublayer",
];

/**
 * A portable Bambu-family colour project: the palette and (optionally) the
 * mixture definitions, and nothing about the printer.
 *
 * A logical colour is not a nozzle, and Bambu Studio's own GUI check
 * (`Plater::check_project_config`) rejects a project whose `nozzle_diameter` has
 * more than one entry while no `extruder_type` is given.  So no
 * `nozzle_diameter` is written at all: the user's printer and nozzle come from
 * their own profile in the destination slicer.
 */
export function bambuConfig(physicalColors, physicalTypes, recipes) {
  check(physicalColors.length, recipes);
  checkTypes(physicalTypes, recipes);
  const table = palette(physicalColors, physicalTypes, recipes);
  const colours = table.physical.concat(table.virtual.map((v) => v.color));
  const types = physicalTypes.map((t) => t || "PLA")
    .concat(table.virtual.map((v) => v.type));
  const cfg = {
    from: "project",
    version: "2.7.0.62",
    filament_colour: colours.map((c) => c + "FF"),
    extruder_colour: colours.slice(),
    default_filament_colour: colours.slice(),
    filament_type: types,
    // The profile name follows the material; a PETG or ABS project must not be
    // relabelled as PLA.
    filament_settings_id: types.map((type) => `Generic ${type}`),
    filament_ids: new Array(colours.length).fill(""),
  };
  if (recipes.length) {
    Object.assign(cfg, {
      filament_is_mixed: [...new Array(table.physical.length).fill("0"),
                          ...new Array(recipes.length).fill("1")],
      filament_mixed_components: [...new Array(table.physical.length).fill(""),
                                  ...recipes.map((r) => `${r.a},${r.b}`)],
      filament_mixed_sublayer_ratios: [...new Array(table.physical.length).fill(""),
        ...recipes.map((r) => `${(Math.round((1 - r.percent / 100) * 1000) / 1000)}`
          + `,${Math.round((r.percent / 100) * 1000) / 1000}`)],
      filament_multi_colour: colours.slice(),
      filament_mixed_gradient: new Array(colours.length).fill("0"),
      filament_mixed_gradient_per_part: new Array(colours.length).fill("0"),
      filament_mixed_gradient_range: new Array(colours.length).fill(""),
      filament_mixed_gradient_curve: new Array(colours.length).fill(""),
    });
  }
  return cfg;
}

export function prusaSpectrumJson(physicalColors, physicalTypes, recipes) {
  const table = palette(physicalColors, physicalTypes, recipes);
  return JSON.stringify({
    version: 1,
    physical_extruders: table.physical.map((colour, index) => ({
      id: index + 1, color: colour, kind: "physical",
      type: physicalTypes[index] || "PLA",
    })),
    virtual_extruders: table.virtual.map((v) => ({
      id: v.id, color: v.color, kind: "fullspectrum",
      components: [
        { extruder: v.a, ratio: Math.round((1 - v.percent / 100) * 1000) / 1000 },
        { extruder: v.b, ratio: Math.round((v.percent / 100) * 1000) / 1000 },
      ],
    })),
  }, null, 2);
}

export function attrsFor(target) {
  const name = normalise(target);
  return {
    paint: PAINT_ATTR[name],
    support: SUPPORT_ATTR[name],
    seam: SEAM_ATTR[name],
  };
}

export function modelNamespaces(target) {
  const base = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
    + 'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
    + 'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ';
  return normalise(target) === "prusa"
    ? base + 'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" ' : base;
}

export function validate(target, cfg, physical, recipes, members = {}) {
  const problems = [];
  const name = normalise(target);
  const total = physical + recipes.length;
  check(physical, recipes);
  if (name !== "prusa" && !(members instanceof Object)) problems.push("bad members");
  const leaked = MACHINE_KEYS.filter((key) => key in cfg);
  if (leaked.length) {
    problems.push(`machine settings leaked into a portable project: `
      + leaked.slice(0, 4).join(", "));
  }
  if (name === "snapmaker") {
    for (const key of ["filament_colour", "filament_type", "nozzle_diameter"]) {
      if (!Array.isArray(cfg[key]) || cfg[key].length !== physical) {
        problems.push(`${key} must stay at ${physical} entries`);
      }
    }
    if (recipes.length) {
      const rows = String(cfg.mixed_filament_definitions || "").split(";");
      const visible = rows.filter((line) => {
        const tokens = line.split(",");
        return tokens.length >= 4 && tokens[2] === "1" && !tokens.includes("d1");
      });
      recipes.forEach((recipe, index) => {
        const tokens = (visible[index] || "").split(",");
        if (tokens[0] !== String(recipe.a) || tokens[1] !== String(recipe.b)
            || tokens[4] !== String(recipe.percent)) {
          problems.push(`filament id ${physical + 1 + index} does not resolve to `
            + `recipe ${index + 1}`);
        }
      });
    }
    return problems;
  }
  for (const key of ["filament_colour", "filament_type"]) {
    if (!Array.isArray(cfg[key]) || cfg[key].length !== total) {
      problems.push(`${key} has ${(cfg[key] || []).length} entries, expected ${total}`);
    }
  }
  // A portable colour project names colours, not hardware: one nozzle per
  // logical filament is what Bambu Studio's own GUI check rejects.
  if ("nozzle_diameter" in cfg) {
    problems.push("nozzle_diameter is a printer setting and must not be inferred "
      + "from the colour palette");
  }
  if (recipes.length) {
    const mixed = cfg.filament_is_mixed || [];
    if (mixed.length !== total) problems.push("filament_is_mixed does not cover the palette");
    else if (mixed.slice(0, physical).some((v) => v !== "0")
             || mixed.slice(physical).some((v) => v !== "1")) {
      problems.push("the reels and the recipes are not marked consistently");
    }
    if (!cfg.filament_multi_colour) problems.push("filament_multi_colour is missing");
  } else {
    for (const key of ["filament_is_mixed", "filament_multi_colour"]) {
      if (key in cfg) problems.push(`${key} was written with no recipes`);
    }
  }
  if (name === "prusa") {
    if (!members[PRUSA_SPECTRUM_JSON]) {
      problems.push("the Prusa Full Spectrum description is missing");
    } else {
      const data = JSON.parse(members[PRUSA_SPECTRUM_JSON]);
      if ((data.physical_extruders || []).length !== physical) {
        problems.push("physical_extruders does not list every reel");
      }
      const ids = (data.virtual_extruders || []).map((v) => v.id);
      const expect = recipes.map((_, index) => virtualId(physical, index));
      if (JSON.stringify(ids) !== JSON.stringify(expect)) {
        problems.push(`virtual_extruders ids are ${ids}, expected ${expect}`);
      }
    }
    if (!members[PRUSA_MODEL_CONFIG]) {
      problems.push("the Prusa model structure is missing");
    }
  }
  return problems;
}

export const MACHINE_KEYS = [
  "printer_settings_id", "printer_model", "printer_variant", "print_settings_id",
  "print_compatible_printers", "printer_structure", "printer_technology",
  "printable_area", "printable_height", "nozzle_type", "nozzle_volume",
  "machine_start_gcode", "machine_end_gcode", "layer_change_gcode",
  "time_lapse_gcode", "pause_gcode", "change_filament_gcode",
  "before_layer_change_gcode", "printing_by_object_gcode",
  "filament_start_gcode", "filament_end_gcode",
];
