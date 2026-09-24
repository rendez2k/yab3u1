// Filament assignment: "arrange slots" (keep every colour) and "repaint"
// (change colours), shared by the homepage page, the worker and the writer.
//
// One source-to-destination map drives both modes.  The difference is what the
// export writes for the *slots themselves*:
//
//   repaint  the palette is written exactly as it was read, and each painted
//            facet names the destination filament, so the facet is printed in
//            that filament's colour.  Two sources may share one filament and
//            their colours merge; this is what "reassign filaments" always did.
//   slots    the palette is written rearranged: every colour travels to the slot
//            it was sent to and the paint names that slot, so the model keeps
//            exactly the appearance it had.  Each source has a distinct destination
//            (spare physical slots may remain empty), and a destination that is already taken
//            displaces the colour sitting there back to the vacated slot.
//
// Everything here is offline and deterministic: no names are looked up over the
// network and nothing is guessed about a filament brand.

import { norm } from "./colour.js";

export const SLOTS = "slots";
export const REPAINT = "repaint";
export const MODES = [SLOTS, REPAINT];

/**
 * The mode the *page* starts from and falls back to.
 *
 * The homepage defaults to arranging slots, so an unset or unknown value here
 * means "keep every colour".  The writer is the other way round on purpose: an
 * unset `assignmentMode` there is the repaint it has always done.  Use this only
 * for the UI's own default, never to decide what an export writes.
 */
export function normaliseMode(mode) {
  return mode === REPAINT ? REPAINT : SLOTS;
}

/** Identity: source colour *n* becomes destination filament *n*. */
export function identityRule(count) {
  const rule = {};
  for (let index = 1; index <= count; index += 1) rule[index] = index;
  return rule;
}

/** A copy of `rule` completed to `count` entries, `n -> n` where it says nothing.
 *  A value that is not a number is kept as it is, so a caller's mistake is
 *  refused later rather than quietly read as "this colour stays where it is". */
export function completeRule(rule, count) {
  const out = {};
  for (let index = 1; index <= count; index += 1) {
    const at = (rule || {})[index];
    out[index] = at === undefined ? index : Number(at);
  }
  return out;
}

export function isIdentity(rule) {
  return Object.keys(rule || {}).every((key) => Number(rule[key]) === Number(key));
}

/**
 * Why `rule` cannot be a slot arrangement over `count` filaments, or null.
 *
 * Arranging slots keeps every colour, so the map must be one-to-one:
 * every source names a destination, and no two sources name the same one.
 */
export function bijectionProblem(rule, count, capacity = count) {
  const seen = new Map();
  for (let source = 1; source <= count; source += 1) {
    const at = Number((rule || {})[source]);
    if (!Number.isInteger(at) || at < 1 || at > capacity) {
      return `colour ${source} is sent to filament ${at}, which is outside the `
        + `${capacity} available filament slot(s)`;
    }
    if (seen.has(at)) {
      return `colours ${seen.get(at)} and ${source} both ask for filament ${at}, and `
        + "arranging slots keeps every colour, so no two may share one";
    }
    seen.set(at, source);
  }
  return null;
}

/**
 * The source index that sits in each destination slot, in slot order.
 *
 * `slotSources(4, {1:3, 3:1})` gives `[3, 2, 1, 4]`: slot 1 holds source 3, slot
 * 2 keeps source 2, slot 3 holds source 1, slot 4 keeps source 4.
 */
export function slotSources(count, rule, capacity = count) {
  const order = new Array(capacity).fill(null);
  const completed = completeRule(rule, count);
  for (let source = 1; source <= count; source += 1) {
    const at = Number(completed[source]);
    if (Number.isInteger(at) && at >= 1 && at <= capacity) order[at - 1] = source;
  }
  return order;
}

/** The palette in slot order after an arrangement: colours and types travel
 *  together, so a material never stays behind with the colour it belonged to. */
export function arrange(list, rule, capacity = list.length) {
  return slotSources(list.length, rule, capacity).map((source) => source === null ? null : list[source - 1]);
}

/**
 * What one export really writes, for every mode.
 *
 * Returns the palette in slot order and the paint map source -> filament, which
 * the writer, the preview and the saved thumbnail all share.  In `repaint` the
 * palette is the source's own, so the result is what the tool always did.
 */
export function assignmentPlan(mode, colours, rule) {
  const list = (colours || []).slice();
  const mapping = completeRule(rule, list.length);
  // Only an explicit `slots` rearranges.  Anything else -- including an unset
  // mode -- is the repaint the writer always did, so a caller that forgets the
  // mode cannot accidentally move someone's colours.
  if (mode === SLOTS) {
    return { mode: SLOTS, palette: arrange(list, mapping, Math.max(list.length, ...Object.values(mapping))), mapping };
  }
  return { mode: REPAINT, palette: list, mapping };
}

/* ------------------------------------------------------------ colour names --
 *
 * A short, plain-language name for a swatch, derived from the hex alone.  It is
 * an approximation and says so on the page: it exists so a row reads as words
 * ("Green 1 -> 3") instead of five hex digits, never as a brand claim.  The hex
 * stays on screen because two shades of green share the name.
 */

// Hue bucket ceilings, in degrees, clockwise from red.
const HUE_NAMES = [
  [15, "Red"], [40, "Orange"], [65, "Yellow"], [95, "Lime"], [150, "Green"],
  [175, "Teal"], [200, "Cyan"], [250, "Blue"], [290, "Purple"], [330, "Magenta"],
  [345, "Pink"],
];

/** Dark or light enough that the plain hue name would mislead. */
const DARK_BELOW = 0.18;
const LIGHT_ABOVE = 0.85;
/** Below this the channels carry no hue worth naming. */
const CHROMA_FLOOR = 0.06;

/**
 * A plain name for a colour: "Green", "Black", "Light Blue", "Grey".
 *
 * Anything this file cannot read as a hex triple is named "Colour" rather than
 * guessed at.
 */
export function colourName(value) {
  const text = norm(value);
  if (!text) return "Colour";
  const channels = [1, 3, 5].map((at) => parseInt(text.slice(at, at + 2), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const lightness = (max + min) / 2;
  if (max - min < CHROMA_FLOOR) {
    if (lightness <= DARK_BELOW) return "Black";
    if (lightness >= LIGHT_ABOVE) return "White";
    return "Grey";
  }
  let hue;
  if (max === channels[0]) {
    hue = 60 * (((channels[1] - channels[2]) / (max - min) + 6) % 6);
  } else if (max === channels[1]) {
    hue = 60 * ((channels[2] - channels[0]) / (max - min) + 2);
  } else {
    hue = 60 * ((channels[0] - channels[1]) / (max - min) + 4);
  }
  const saturation=(max-min)/(1-Math.abs(2*lightness-1));
  if(hue>=55 && hue<=90 && saturation<=.6 && lightness>.3 && lightness<.75) return "Muted yellow-green";
  if(hue>=20 && hue<55 && saturation<.4 && lightness>.55 && lightness<.85) return "Beige";
  const bucket = HUE_NAMES.find(([ceiling]) => hue < ceiling);
  const name = bucket ? bucket[1] : "Red";
  if (lightness <= DARK_BELOW) return `Dark ${name}`;
  if (lightness >= LIGHT_ABOVE) return `Light ${name}`;
  return name;
}

/** "Green #3F8E43", the label one row or option shows. */
export function colourLabel(value) {
  const text = norm(value);
  if (!text) return "Colour";
  return `${colourName(text)} ${text}`;
}
