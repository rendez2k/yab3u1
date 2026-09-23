// Cross-language parity: the browser modules must answer exactly what the Python
// oracle answered for the same inputs.
//
//   python tests/export_js_fixtures.py && node web/tests/parity.test.mjs
//
// Run from the project root.  No framework: a small assert, and a non-zero exit
// code when anything disagrees.

import { readFileSync } from "node:fs";

import * as colour from "../shared/colour.js";
import * as mix from "../shared/mix.js";
import * as paint from "../shared/paint.js";
import * as planner from "../shared/planner.js";
import * as targets from "../shared/targets.js";

const fixtures = JSON.parse(readFileSync("web/tests/fixtures.json", "utf8"));

let checks = 0;
const failures = [];

function same(label, actual, expected) {
  checks += 1;
  const a = canon(actual);
  const b = canon(expected);
  if (a !== b) failures.push(`${label}\n  browser: ${a}\n  python : ${b}`);
}

/** JSON with object keys sorted, so two languages' key order cannot matter. */
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function close(label, actual, expected, tolerance = 1e-6) {
  checks += 1;
  if (!(Math.abs(actual - expected) <= tolerance)) {
    failures.push(`${label}\n  browser: ${actual}\n  python : ${expected}`);
  }
}

// ---- colour -----------------------------------------------------------------
for (const pair of fixtures.colour.pairs) {
  close(`distance ${pair.a} ${pair.b}`, colour.distance(pair.a, pair.b),
        pair.distance, 1e-6);
}
for (const item of fixtures.colour.nearest) {
  same(`nearest ${item.target}`, colour.nearest(item.target, item.palette)[0],
       item.index);
}

// ---- mixtures ---------------------------------------------------------------
for (const hexCase of fixtures.mix.hexes) {
  same(`mixHex ${hexCase.a} ${hexCase.b} ${hexCase.percent}`,
       mix.mixHex(hexCase.a, hexCase.b, hexCase.percent), hexCase.color);
}
for (const item of fixtures.mix.cases) {
  const sources = {};
  Object.entries(item.sources).forEach(([key, value]) => { sources[Number(key)] = value; });
  const plan = mix.planMixtures(sources, fixtures.mix.reels);
  same(`advice for ${JSON.stringify(item.sources)}`, plan.advice,
       item.expected.advice);
  same(`recipes for ${JSON.stringify(item.sources)}`,
       plan.recipes.map((r) => ({ id: r.id, a: r.a, b: r.b, percent: r.percent,
                                  color: r.color })),
       item.expected.recipes);
  same(`rows for ${JSON.stringify(item.sources)}`,
       plan.rows.map((row) => ({ source: row.source, choice: row.choice,
                                 recipe_id: row.recipe_id ?? null,
                                 solid_slot: row.solid.slot,
                                 solid_error: row.solid.error })),
       item.expected.rows);
}

// ---- paint codec ------------------------------------------------------------
same("SUPPORTED_STATE_MAX", paint.SUPPORTED_STATE_MAX, fixtures.paint.supported_max);
for (const item of fixtures.paint.excessive) {
  same(`excessiveStates ${item.value}`, paint.excessiveStates(item.value),
       item.states);
}
for (const item of fixtures.paint.decoded) {
  let tree;
  try {
    tree = item.value ? paint.decode(item.value) : null;
  } catch (error) {
    tree = "error";
  }
  same(`decode ${item.value || "(empty)"}`, tree, item.tree);
}
for (const item of fixtures.paint.remapped) {
  let result;
  try {
    result = item.value ? paint.remapText(item.value, item.mapping) : item.value;
  } catch (error) {
    result = "error";
  }
  same(`remapText ${item.value || "(empty)"}`, result, item.result);
}

// ---- spectrum ids ----------------------------------------------------------
same("MAX_VISIBLE", targets.MAX_VISIBLE, fixtures.spectrum.max_visible);
same("MAX_RECIPES", targets.MAX_RECIPES, fixtures.spectrum.max_recipes);
for (const item of fixtures.spectrum.virtual_id) {
  same(`virtualId ${item.physical}/${item.index}`,
       targets.virtualId(item.physical, item.index), item.id);
}

// ---- g-code planner --------------------------------------------------------
for (const item of fixtures.planner) {
  let result;
  try {
    result = planner.analyse(item.gcode, { physical: item.physical });
  } catch (error) {
    result = { error: error.message };
  }
  if (item.expected.error) {
    same(`planner ${item.name} refuses`, result.error, item.expected.error);
    continue;
  }
  for (const key of Object.keys(item.expected)) {
    same(`planner ${item.name}.${key}`, result[key], item.expected[key]);
  }
}

if (failures.length) {
  console.error(`${failures.length} of ${checks} parity checks failed:\n`);
  failures.slice(0, 20).forEach((line) => console.error(line + "\n"));
  process.exit(1);
}
console.log(`parity ok: ${checks} checks`);
