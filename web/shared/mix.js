// Predicted shades for mixtures of the loaded reels, and the recipes behind them.
//
// The Python copy is u1mix.py; both use the same MIT FilamentMixer polynomial
// (web/shared/mix_model.js, generated from u1mix_model.py). A swatch prediction is
// not a calibration: what it is good for is *ranking* -- saying that a blend comes
// closer than either reel, or that it does not.

import { distance, nearest, norm, toLab } from "./colour.js";
import { MIX_COEFFICIENTS, MIX_INTERCEPT, MIX_POWERS } from "./mix_model.js";
import { mixFdmHex, FDM_MODEL, approximateDistance } from './fdmMix.js';
import { calibratedPredictor } from './blendCalibration.js';
import { mixFilaments } from './vendor/prusa-fdm/prusa-fdm-mixer.js';

export const RATIOS = [25, 50, 75];
export const MIN_IMPROVEMENT = 2.0;
export const POOR_COVERAGE = 12.0;
export const MAX_RECIPES = 12;

// How finely Full Spectrum may dither when a model has more colours than reels.
// More ratios and more recipes reach more of the model's shades; long ratios
// repeat over more layers, so they band more visibly without thin layers.
// RATIOS above stays the reference set shared with the Python oracle.
export const BLEND_STRENGTHS = {
  standard: { ratios: RATIOS, recipes: 6, period: 4, layers: 3 },
  strong: { ratios: [17, 25, 33, 40, 50, 60, 67, 75, 83], recipes: 10, period: 6, layers: 4 },
  finest: { ratios: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90], recipes: 12, period: 20, layers: 4 },
};
let strength = 'standard';
export function setBlendStrength(name) {
  if (!Object.hasOwn(BLEND_STRENGTHS, name)) throw new Error('Choose Standard, Strong or Finest blend detail.');
  strength = name;
}
export const blendStrength = () => ({ name: strength, ...BLEND_STRENGTHS[strength] });

// Keeping hues. Plain colour distance can rate a pale yellow as closer to a
// light green than a vivid green is, because lightness and saturation outweigh
// the hue. On a figure the hue is what reads as "the right colour", so a blend
// that drifts to a neighbouring hue is marked down when this is on.
let keepHue = false;
export function setHueFidelity(on) { keepHue = Boolean(on); }
export const hueFidelity = () => keepHue;
const labOf = (value) => (Array.isArray(value) ? value : toLab(value));
export function huePenalty(target, candidate) {
  if (!keepHue) return 0;
  const a = labOf(target), b = labOf(candidate);
  if (!a || !b) return 0;
  const ca = Math.hypot(a[1], a[2]), cb = Math.hypot(b[1], b[2]);
  // A colour with a clear hue must not be traded for a grey: a grey has no hue at
  // all, so it is marked down by how much of the colour's saturation it gives up.
  const washed = Math.max(0, 0.6 * ca - cb) * Math.max(0, Math.min(1, (ca - 14) / 20));
  // A near-neutral colour has no hue to keep.
  if (ca < 8 || cb < 8) return washed;
  let degrees = Math.abs(Math.atan2(a[2], a[1]) - Math.atan2(b[2], b[1])) * 180 / Math.PI;
  if (degrees > 180) degrees = 360 - degrees;
  // Hue only counts once a colour is clearly saturated: pastels and skin tones
  // sit close to neutral, where a small drift changes the angle a lot.
  return washed + 0.5 * degrees * Math.max(0, Math.min(1, (Math.min(ca, cb) - 14) / 20));
}

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

// Baked colours. A blend of three reels is written as an explicit run of
// layers (for example reel 1, 2, 1, 3), so its shares are whole layers out of a
// short repeat. Off by default: the reference planner mixes pairs only. The repeat is
// kept to four layers at most: a first print at six 0.16 mm layers came out as plain stripes.
let baked = false;
export function setBakedColours(on) { baked = Boolean(on); }
export const bakedColours = () => baked;
/** One blend's identity: its reels and shares. */
export const recipeKey = (r) => `${r.a},${r.b},${r.percent}` + (r.c ? `,${r.c},${r.percentC}` : '');
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** Whole-layer shares of three reels over repeats of up to `layers` layers. */
export function layerShares(layers) {
  const out = new Map();
  for (let n = 3; n <= layers; n += 1) {
    for (let i = 1; i <= n - 2; i += 1) {
      for (let j = 1; j <= n - i - 1; j += 1) {
        const k = n - i - j;
        if (gcd(gcd(i, j), k) !== 1) continue;
        const percent = Math.round(100 * j / n), percentC = Math.round(100 * k / n);
        const key = `${percent},${percentC}`;
        if (!out.has(key)) out.set(key, { percent, percentC, counts: [i, j, k] });
      }
    }
  }
  return [...out.values()];
}
const tripleCache = new Map();
function mixThree(colours, counts) {
  const key = colours.join() + counts.join();
  if (!tripleCache.has(key)) {
    if (tripleCache.size > 20000) tripleCache.clear();
    const total = counts[0] + counts[1] + counts[2];
    tripleCache.set(key, mixFilaments(colours.map((hex, i) => ({ hex, ratio: counts[i] / total }))).hex.toUpperCase());
  }
  return tripleCache.get(key);
}

const material = (reel) => String((reel || {}).type || "PLA").trim().toUpperCase();

export function candidateRecipes(reels, ratios = RATIOS, predictor = mixHex) {
  const out = [];
  const colors = reels.map((r) => norm((r || {}).color));
  for (let a = 0; a < colors.length; a += 1) {
    for (let b = a + 1; b < colors.length; b += 1) {
      if (reels[a]?.role==='support-interface' || reels[b]?.role==='support-interface') continue;
      if (!colors[a] || !colors[b]) continue;
      if (material(reels[a]) !== material(reels[b])) continue;
      for (const percent of ratios) {
        out.push({ a: a + 1, b: b + 1, percent,
                   color: predictor(colors[a], colors[b], percent, a+1, b+1),
                   materials: material(reels[a]) });
      }
    }
  }
  if (!baked) return out;
  const usable = colors.map((c, i) => i).filter(i => colors[i] && reels[i]?.role !== 'support-interface');
  const shares = layerShares(blendStrength().layers);
  for (let x = 0; x < usable.length; x += 1) for (let y = x + 1; y < usable.length; y += 1) for (let z = y + 1; z < usable.length; z += 1) {
    const [a, b, c] = [usable[x], usable[y], usable[z]];
    if (material(reels[a]) !== material(reels[b]) || material(reels[a]) !== material(reels[c])) continue;
    if (new Set([colors[a], colors[b], colors[c]]).size < 3) continue;
    for (const share of shares) {
      out.push({ a: a + 1, b: b + 1, percent: share.percent, c: c + 1, percentC: share.percentC,
                 color: mixThree([colors[a], colors[b], colors[c]], share.counts), materials: material(reels[a]) });
    }
  }
  return out;
}

/** Compare every source colour with a single reel and with the best mixture. */
export function planMixtures(sourceColors, reels, ratios = RATIOS,
                             maxRecipes = 6, credibleOnly = false, predictor = mixHex, allowApproximate = false) {
  const slotColors = reels.map((r) => norm((r || {}).color));
  const candidates = candidateRecipes(reels, ratios, predictor).filter(recipe=>(!allowApproximate || slotColors[recipe.a-1]!==slotColors[recipe.b-1]) && (!credibleOnly ||
    plausibleBlend(slotColors[recipe.a-1],slotColors[recipe.b-1],recipe.color,recipe.c ? slotColors[recipe.c-1] : null)));
  const rows = [];
  const used = new Map();
  const approximateColours = new Map(slotColors.filter((_,i)=>reels[i].role!=='support-interface').map(color=>[color,color]));
  Object.keys(sourceColors).map(Number).sort((a, b) => a - b).forEach((source) => {
    const original = norm(sourceColors[source]);
    const modelSlots = reels.map((r,i)=>r.role==='support-interface' ? -1 : i).filter(i=>i>=0);
    if (!modelSlots.length) throw Error('At least one model filament is required.');
    const [nearestSlot, solidError] = nearest(original, modelSlots.map(i=>slotColors[i]));
    const solidSlot = nearestSlot==null ? null : modelSlots[nearestSlot];
    let best = null;
    for (const recipe of candidates) {
      // Explicit approximations retain distinct source shades instead of merging
      // two source colours onto one virtual recipe or an existing physical shade.
      if(allowApproximate && approximateColours.has(recipe.color) && approximateColours.get(recipe.color)!==original) continue;
      const error = (allowApproximate ? approximateDistance : distance)(original, recipe.color);
      // Ranked with the hue penalty; the reported error stays the plain distance.
      // A third reel has to earn its place over a simpler pair.
      const score = error + huePenalty(original, recipe.color) + (recipe.c ? 0.75 : 0);
      if (!best || score < best.score) best = { recipe, error, score };
    }
    const solid = {
      slot: solidSlot == null ? null : solidSlot + 1,
      color: solidSlot == null ? "" : slotColors[solidSlot],
      error: Number.isFinite(solidError) ? Math.round(solidError * 10) / 10 : null,
    };
    let mixture = null;
    if (best) {
      mixture = { a: best.recipe.a, b: best.recipe.b, percent: best.recipe.percent,
                  ...(best.recipe.c ? { c: best.recipe.c, percentC: best.recipe.percentC } : {}),
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
    } else if (allowApproximate && mixture) {
      choice = "mixture";
      reason = "closest available blend; review the changed colour before accepting";
    } else if (mixture && improvement !== null && improvement >= MIN_IMPROVEMENT
               && mixture.error <= POOR_COVERAGE) {
      choice = "mixture";
      reason = mixture.c ? `a ${mixture.a}/${mixture.b}/${mixture.c} mix is ${improvement} closer than the nearest reel`
        : `a ${mixture.a}/${mixture.b} mix at ${mixture.percent}% is `
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
      if(allowApproximate) approximateColours.set(mixture.color,original);
      used.set(recipeKey(mixture), {
        a: mixture.a, b: mixture.b, percent: mixture.percent, color: mixture.color,
        ...(mixture.c ? { c: mixture.c, percentC: mixture.percentC } : {}),
        materials: material(reels[mixture.a - 1]),
      });
    }
    rows.push({ source, original, solid, mixture, improvement, closer, exact,
                choice, reason, predicted: choice === "mixture" });
  });

  const ranked = [...used.values()].map((recipe) => {
    const count = rows.filter((row) => row.choice === "mixture" && row.mixture
      && recipeKey(row.mixture) === recipeKey(recipe)).length;
    return { ...recipe, count };
  }).sort((x, y) => (y.count - x.count) || (x.a - y.a) || (x.b - y.b)
            || (x.percent - y.percent));

  const recipes = ranked.slice(0, maxRecipes).map((recipe, index) => ({
    id: slotColors.length + index + 1,
    a: recipe.a, b: recipe.b, percent: recipe.percent, color: recipe.color,
    ...(recipe.c ? { c: recipe.c, percentC: recipe.percentC } : {}),
    materials: recipe.materials,
  }));
  const byKey = new Map(recipes.map((r) => [recipeKey(r), r]));
  const kept = [];
  for (const row of rows) {
    if (row.choice !== "mixture") continue;
    const recipe = byKey.get(recipeKey(row.mixture));
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

// A basic physical sanity check, not a substitute for filament calibration.
// Two neutral reels cannot yield a strongly chromatic shade. The uncalibrated
// polynomial occasionally predicts one; never present that as printable coverage.
export function plausibleBlend(first, second, predicted, third = null) {
  const spread=value=>{
    const rgb=hexToRgb(value);
    return rgb ? Math.max(...rgb)-Math.min(...rgb) : Infinity;
  };
  return !(spread(first)<=8 && spread(second)<=8 && (!third || spread(third)<=8) && spread(predicted)>16);
}

/** Interactive Full Spectrum planning rejects implausible predictions before
 * choosing a recipe, so a rejected nearest prediction cannot hide a valid one. */
export function planBlends(sourceColors,reels,approximate=false,slotOrder=null,calibration=null,maxRecipes=blendStrength().recipes) {
  // Keep the original search order when arranging a chosen palette. Re-running
  // tied candidates in physical-slot order can otherwise change its shades.
  if(slotOrder) {
    validateSlotOrder(slotOrder,reels.length);
    const original=slotOrder.map((_,old)=>reels[slotOrder.indexOf(old)]);
    const plan=planBlends(sourceColors,original,approximate,null,calibration,maxRecipes);
    const slot=id=>id==null ? id : slotOrder.indexOf(id-1)+1;
    const recipe=r=>r ? {...r,a:slot(r.a),b:slot(r.b),...(r.c?{c:slot(r.c)}:{})} : r;
    return {...plan,reels:reels.map((r,i)=>({slot:i+1,color:norm(r.color),type:material(r)})),
      recipes:plan.recipes.map(recipe),rows:plan.rows.map(row=>({...row,
        solid:{...row.solid,slot:slot(row.solid.slot)},mixture:recipe(row.mixture)}))};
  }
  const predictor=calibratedPredictor(reels,calibration);
  const plan=planMixtures(sourceColors,reels,blendStrength().ratios,maxRecipes,true,predictor.predict,approximate);
  plan.recipes.forEach(recipe=>{
    recipe.model=FDM_MODEL;
    const measured=recipe.c ? null : predictor.measured(recipe.a,recipe.b,recipe.percent);
    if(measured) recipe.measuredColor=measured;
    if(approximate) recipe.approximate=true;
  });
  return plan;
}

function validateSlotOrder(order,length) {
  if(order.length!==length || new Set(order).size!==length || order.some(i=>!Number.isInteger(i) || i<0 || i>=length))
    throw new Error('Slot order must contain each physical slot exactly once.');
}

/** Swap physical reels without changing virtual colours or their ingredients. */
export function swapPaletteSlots(palette,from,to) {
  const length=palette.reels.length;
  if(![from,to].every(i=>Number.isInteger(i) && i>=0 && i<length)) throw new Error('Invalid physical slot.');
  const reels=palette.reels.slice(), slotOrder=(palette.slotOrder || reels.map((_,i)=>i)).slice();
  validateSlotOrder(slotOrder,length);
  [reels[from],reels[to]]=[reels[to],reels[from]];
  [slotOrder[from],slotOrder[to]]=[slotOrder[to],slotOrder[from]];
  const slot=id=>id===from+1 ? to+1 : id===to+1 ? from+1 : id;
  return {...palette,reels,slotOrder,outcome:{...palette.outcome,
    rows:palette.outcome.rows.map(row=>({...row,slot:slot(row.slot),
      recipe:row.recipe ? {...row.recipe,a:slot(row.recipe.a),b:slot(row.recipe.b),...(row.recipe.c?{c:slot(row.recipe.c)}:{})} : row.recipe}))}};
}

/** Describe the effective export mapping, including overrides and unticked recipes.
 * In blend mode a non-matching single reel is unresolved, never a silent fallback.
 */
export function describeColourMapping(sourceColors, payload, strictBlends = false) {
  const rows = Object.entries(sourceColors || {}).map(([source, value]) => {
    const original=norm(value), slot=Number(payload.mapping[source]);
    const physicalCount=payload.physical?.length || 4;
    const recipe=slot>physicalCount ? payload.kept?.[slot-physicalCount-1] : null;
    const result=payload.source ? original : norm(recipe?.color || payload.physical?.[slot-1]?.color);
    const implausible=recipe && !recipe.c && !recipe.gradient && !plausibleBlend(payload.physical?.[recipe.a-1]?.color,
      payload.physical?.[recipe.b-1]?.color,result);
    const kind=payload.source ? 'preserved' : recipe ? (strictBlends && implausible ? 'unresolved' : 'blended')
      : result && distance(original,result)<=.5 ? 'preserved'
      : strictBlends || !result ? 'unresolved' : 'substituted';
    return {source:Number(source),original,result,slot,recipe,kind};
  });
  const counts={preserved:0,blended:0,substituted:0,unresolved:0};
  rows.forEach(row=>counts[row.kind]++);
  return {rows,counts,sourceCount:new Set(rows.map(r=>r.original)).size,
    outputCount:new Set(rows.filter(r=>r.kind!=='unresolved').map(r=>r.result)).size,
    blendCount:new Set(rows.filter(r=>r.kind==='blended').map(r=>r.slot)).size};
}
