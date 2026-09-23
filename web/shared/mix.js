// Predicted shades for mixtures of the loaded reels, and the recipes behind them.
//
// The Python copy is u1mix.py; both use the same MIT FilamentMixer polynomial
// (web/shared/mix_model.js, generated from u1mix_model.py). A swatch prediction is
// not a calibration: what it is good for is *ranking* -- saying that a blend comes
// closer than either reel, or that it does not.

import { distance, nearest, norm } from "./colour.js";
import { MIX_COEFFICIENTS, MIX_INTERCEPT, MIX_POWERS } from "./mix_model.js";

export const RATIOS = [25, 50, 75];
export const MIN_IMPROVEMENT = 2.0;
export const POOR_COVERAGE = 12.0;
export const MAX_RECIPES = 12;

// Truncation, not rounding: the Python oracle is the reference and the two must
// predict the identical hex or the parity check is meaningless.
const clamp = (value) => Math.max(0, Math.min(255, Math.trunc(value)));

export function mixRgb(first, second, ratio) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  if (!a || !b) return null;
  const x = [a[0], a[1], a[2], b[0], b[1], b[2], ratio];
  const out = MIX_INTERCEPT.slice();
  for (let row = 0; row < MIX_POWERS.length; row += 1) {
    const powers = MIX_POWERS[row];
    const coefficients = MIX_COEFFICIENTS[row];
    let feature = 1;
    for (let i = 0; i < powers.length; i += 1) {
      if (powers[i]) feature *= x[i] ** powers[i];
    }
    out[0] += feature * coefficients[0];
    out[1] += feature * coefficients[1];
    out[2] += feature * coefficients[2];
  }
  return out.map(clamp);
}

function hexToRgb(value) {
  const text = norm(value);
  if (!text) return null;
  return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16),
          parseInt(text.slice(5, 7), 16)];
}

const hex = (rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0"))
  .join("").toUpperCase();

export function mixHex(first, second, percent) {
  const rgb = mixRgb(first, second, percent / 100);
  return rgb ? hex(rgb) : "";
}

const material = (reel) => String((reel || {}).type || "PLA").trim().toUpperCase();

export function candidateRecipes(reels, ratios = RATIOS) {
  const out = [];
  const colors = reels.map((r) => norm((r || {}).color));
  for (let a = 0; a < colors.length; a += 1) {
    for (let b = a + 1; b < colors.length; b += 1) {
      if (!colors[a] || !colors[b]) continue;
      if (material(reels[a]) !== material(reels[b])) continue;
      for (const percent of ratios) {
        out.push({ a: a + 1, b: b + 1, percent,
                   color: mixHex(colors[a], colors[b], percent),
                   materials: material(reels[a]) });
      }
    }
  }
  return out;
}

/** Compare every source colour with a single reel and with the best mixture. */
export function planMixtures(sourceColors, reels, ratios = RATIOS,
                             maxRecipes = 6) {
  const slotColors = reels.map((r) => norm((r || {}).color));
  const candidates = candidateRecipes(reels, ratios);
  const rows = [];
  const used = new Map();
  Object.keys(sourceColors).map(Number).sort((a, b) => a - b).forEach((source) => {
    const original = norm(sourceColors[source]);
    const [solidSlot, solidError] = nearest(original, slotColors);
    let best = null;
    for (const recipe of candidates) {
      const error = distance(original, recipe.color);
      if (!best || error < best.error) best = { recipe, error };
    }
    const solid = {
      slot: solidSlot == null ? null : solidSlot + 1,
      color: solidSlot == null ? "" : slotColors[solidSlot],
      error: Number.isFinite(solidError) ? Math.round(solidError * 10) / 10 : null,
    };
    let mixture = null;
    if (best) {
      mixture = { a: best.recipe.a, b: best.recipe.b, percent: best.recipe.percent,
                  color: best.recipe.color, error: Math.round(best.error * 10) / 10 };
    }
    const improvement = (mixture && solid.error !== null)
      ? Math.round((solid.error - mixture.error) * 10) / 10 : null;
    const closer = !!(mixture && improvement !== null && improvement > 0);
    const exact = !!solid.color && distance(original, solid.color) <= 0.5;
    let choice;
    let reason;
    if (exact) {
      choice = "solid";
      reason = "this colour is already one of the loaded reels";
    } else if (mixture && improvement !== null && improvement >= MIN_IMPROVEMENT
               && mixture.error <= POOR_COVERAGE) {
      choice = "mixture";
      reason = `a ${mixture.a}/${mixture.b} mix at ${mixture.percent}% is `
        + `${improvement} closer than the nearest reel`;
    } else if (mixture && improvement !== null && improvement >= MIN_IMPROVEMENT) {
      choice = "solid";
      reason = "the best mixture is still a poor match; load a closer filament "
        + "rather than mix";
    } else {
      choice = "solid";
      reason = "no mixture is meaningfully closer than one reel";
    }
    if (choice === "mixture") {
      used.set(`${mixture.a},${mixture.b},${mixture.percent}`, {
        a: mixture.a, b: mixture.b, percent: mixture.percent, color: mixture.color,
        materials: material(reels[mixture.a - 1]),
      });
    }
    rows.push({ source, original, solid, mixture, improvement, closer, exact,
                choice, reason, predicted: choice === "mixture" });
  });

  const ranked = [...used.values()].map((recipe) => {
    const count = rows.filter((row) => row.choice === "mixture" && row.mixture
      && row.mixture.a === recipe.a && row.mixture.b === recipe.b
      && row.mixture.percent === recipe.percent).length;
    return { ...recipe, count };
  }).sort((x, y) => (y.count - x.count) || (x.a - y.a) || (x.b - y.b)
            || (x.percent - y.percent));

  const recipes = ranked.slice(0, maxRecipes).map((recipe, index) => ({
    id: slotColors.length + index + 1,
    a: recipe.a, b: recipe.b, percent: recipe.percent, color: recipe.color,
    materials: recipe.materials,
  }));
  const byKey = new Map(recipes.map((r) => [`${r.a},${r.b},${r.percent}`, r]));
  const kept = [];
  for (const row of rows) {
    if (row.choice !== "mixture") continue;
    const recipe = byKey.get(`${row.mixture.a},${row.mixture.b},${row.mixture.percent}`);
    if (!recipe) {
      row.choice = "solid";
      row.predicted = false;
      row.reason = "too many mixtures would be needed; load a closer filament "
        + "instead of mixing";
      continue;
    }
    row.recipe_id = recipe.id;
    kept.push(row);
  }

  const errors = rows.map((row) => row.solid.error).filter((e) => e !== null);
  const worst = errors.length ? Math.max(...errors) : 0;
  const changes = kept.length;
  const closerOnly = rows.filter((row) => row.closer && row.choice !== "mixture");
  let advice;
  if (!rows.length) {
    advice = "no source colours to compare";
  } else if (changes) {
    advice = `${changes} of ${rows.length} colours would be closer as a predicted `
      + "mixture; the rest stay on the reel they already match";
    if (worst > POOR_COVERAGE) {
      advice += `. The palette itself is a long way from these reels (worst match `
        + `${Math.round(worst * 10) / 10}), so loading closer filament is worth `
        + "doing where you can";
    }
  } else if (closerOnly.length) {
    advice = `a blend would come closer for ${closerOnly.length} of ${rows.length} `
      + "colours, but not by enough to be worth the extra uncertainty; the nearest "
      + "reels are the better answer";
    if (worst > POOR_COVERAGE) {
      advice += `. The palette is a long way from these reels (worst match `
        + `${Math.round(worst * 10) / 10}), so load closer filament`;
    }
  } else if (worst > POOR_COVERAGE) {
    advice = "no blend comes closer than the nearest reel, and the reels do not "
      + "cover these colours; load closer filament rather than mixing";
  } else {
    advice = "the loaded reels already cover these colours as well as mixing would";
  }
  return {
    reels: slotColors.map((color, index) => ({ slot: index + 1, color,
                                               type: material(reels[index]) })),
    rows, recipes, advice, uncalibrated: true,
    coverage: worst > POOR_COVERAGE ? "poor" : "good",
    worst_solid_error: errors.length ? Math.round(worst * 10) / 10 : null,
  };
}

/** {source extruder: filament id} for an export, using the plan's own ids. */
export function mappingFromPlan(plan, useMixtures = true) {
  const mapping = {};
  for (const row of plan.rows || []) {
    if (useMixtures && row.choice === "mixture" && row.recipe_id) {
      mapping[row.source] = row.recipe_id;
    } else if (row.solid && row.solid.slot) {
      mapping[row.source] = row.solid.slot;
    }
  }
  return mapping;
}
