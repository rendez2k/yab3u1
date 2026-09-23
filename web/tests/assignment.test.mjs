// The filament assignment model: arranging slots (keep every colour) versus
// repainting (change colours), plus the offline colour names the page shows.
//
// Run from the project root:  node web/tests/assignment.test.mjs

import assert from "node:assert/strict";

import {
  REPAINT, SLOTS, arrange, assignmentPlan, bijectionProblem, colourLabel,
  colourName, completeRule, identityRule, isIdentity, normaliseMode, slotSources,
} from "../shared/assignment.js";

let checks = 0;
const failures = [];

async function ok(name, fn) {
  try {
    await fn();
    checks += 1;
    console.log("PASS", name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log("FAIL", name, error.message);
  }
}

// The four colours the user reported, in the order their file lists them.
const USER = ["#3F8E43", "#000000", "#FFFFFF", "#8E9089"];

/* ---------- colour names ---------- */

await ok("the four reported colours have plain names beside their hex", () => {
  assert.equal(colourName("#3F8E43"), "Green");
  assert.equal(colourName("#000000"), "Black");
  assert.equal(colourName("#FFFFFF"), "White");
  assert.equal(colourName("#8E9089"), "Grey");
  assert.equal(colourLabel("#3F8E43"), "Green #3F8E43");
});

await ok("basic shades and lightness are named from the hex alone", () => {
  assert.equal(colourName("#FF0000"), "Red");
  assert.equal(colourName("#FF8000"), "Orange");
  assert.equal(colourName("#FFFF00"), "Yellow");
  assert.equal(colourName("#00FF00"), "Green");
  assert.equal(colourName("#00FFFF"), "Cyan");
  assert.equal(colourName("#0000FF"), "Blue");
  assert.equal(colourName("#000040"), "Dark Blue");
  assert.equal(colourName("#FFD0D0"), "Light Red");
  assert.equal(colourName("#8000FF"), "Purple");
  assert.equal(colourName("#FF00FF"), "Magenta");
  assert.equal(colourName("#018001"), "Green");
  // The 8-digit spelling the writer also reads, and what it does with anything
  // else -- the three-digit shorthand is not a colour this tool reads anywhere,
  // so it is named, not guessed at.
  assert.equal(colourName("#FFFFFFFF"), "White");
  assert.equal(colourName("#fff"), "Colour");
  assert.equal(colourName("not a colour"), "Colour");
  assert.equal(colourName(null), "Colour");
});

await ok("names are stable across calls, so a label never flickers", () => {
  const first = USER.map(colourName);
  for (let round = 0; round < 3; round += 1) {
    assert.deepEqual(USER.map(colourName), first);
  }
});

/* ---------- the arrangement itself ---------- */

await ok("moving the green to filament 3 puts white in 1 and keeps black in 2", () => {
  const rule = { 1: 3, 2: 2, 3: 1, 4: 4 };
  assert.deepEqual(slotSources(4, rule), [3, 2, 1, 4]);
  assert.deepEqual(arrange(USER, rule), ["#FFFFFF", "#000000", "#3F8E43", "#8E9089"]);
  // The appearance is the source's: every facet still names the filament that
  // carries the colour it was painted with.
  assert.equal(arrange(USER, rule)[rule[1] - 1], USER[0], "green prints from 3");
  assert.equal(arrange(USER, rule)[rule[3] - 1], USER[2], "white prints from 1");
  assert.equal(arrange(USER, rule)[rule[2] - 1], USER[1], "black prints from 2");
});

await ok("a material travels with its colour, never behind it", () => {
  const reels = [{ color: "#3F8E43", type: "PLA" }, { color: "#000000", type: "PETG" },
                 { color: "#FFFFFF", type: "ABS" }, { color: "#8E9089", type: "TPU" }];
  const moved = arrange(reels, { 1: 3, 3: 1 });
  assert.deepEqual(moved.map((reel) => reel.color),
                   ["#FFFFFF", "#000000", "#3F8E43", "#8E9089"]);
  assert.deepEqual(moved.map((reel) => reel.type),
                   ["ABS", "PETG", "PLA", "TPU"], "the type follows its colour");
});

await ok("a chained move is one permutation, not a cascade", () => {
  const rule = { 1: 2, 2: 3, 3: 1, 4: 4 };
  assert.deepEqual(slotSources(4, rule), [3, 1, 2, 4]);
  assert.deepEqual(arrange(USER, rule),
                   ["#FFFFFF", "#3F8E43", "#000000", "#8E9089"]);
  for (let source = 1; source <= 4; source += 1) {
    assert.equal(arrange(USER, rule)[rule[source] - 1], USER[source - 1],
                 `colour ${source} still prints its own colour`);
  }
});

await ok("duplicate hexes stay separate slots through a move", () => {
  const twin = ["#3F8E43", "#3F8E43", "#FFFFFF", "#000000"];
  const rule = { 1: 2, 2: 1, 3: 3, 4: 4 };
  assert.equal(arrange(twin, rule).length, 4, "two identical colours stay two slots");
  assert.deepEqual(slotSources(4, rule), [2, 1, 3, 4]);
});

await ok("a palette larger than four arranges like any other", () => {
  const six = ["#0080C0", "#FF0000", "#FFFFFF", "#000000", "#C5C263", "#8E9089"];
  const rule = { 1: 4, 2: 1, 3: 6, 4: 2, 5: 5, 6: 3 };
  assert.equal(bijectionProblem(rule, 6), null);
  const arranged = arrange(six, rule);
  assert.equal(arranged.length, 6);
  for (let source = 1; source <= 6; source += 1) {
    assert.equal(arranged[rule[source] - 1], six[source - 1]);
  }
});

/* ---------- refusals ---------- */

await ok("a collision is refused, naming both colours", () => {
  const problem = bijectionProblem(completeRule({ 1: 2 }, 4), 4);
  assert.match(problem, /colours 1 and 2 both ask for filament 2/);
});

await ok("a destination outside the palette is refused", () => {
  assert.match(bijectionProblem(completeRule({ 1: 5 }, 4), 4), /outside the 4/);
  assert.match(bijectionProblem(completeRule({ 1: 0 }, 4), 4), /outside the 4/);
  assert.match(bijectionProblem(completeRule({ 1: "two" }, 4), 4), /outside the 4/);
});

await ok("a complete permutation is accepted", () => {
  assert.equal(bijectionProblem(identityRule(16), 16), null);
  assert.equal(bijectionProblem({ 1: 3, 2: 2, 3: 1, 4: 4 }, 4), null);
  assert.equal(bijectionProblem(completeRule({}, 5), 5), null);
});

/* ---------- what one export writes ---------- */

await ok("slot mode writes the rearranged palette with the same map", () => {
  const plan = assignmentPlan(SLOTS, USER, { 1: 3, 3: 1 });
  assert.equal(plan.mode, SLOTS);
  assert.deepEqual(plan.palette, ["#FFFFFF", "#000000", "#3F8E43", "#8E9089"]);
  assert.deepEqual(plan.mapping, { 1: 3, 2: 2, 3: 1, 4: 4 },
                   "the paint names the slot each colour moved to");
  // Which is the whole point: reading the palette through the map gives the
  // source colour back, facet for facet.
  for (let source = 1; source <= 4; source += 1) {
    assert.equal(plan.palette[plan.mapping[source] - 1], USER[source - 1]);
  }
});

await ok("repaint and undefined modes keep the source palette", () => {
  for (const mode of [REPAINT, undefined, null, "anything else"]) {
    const plan = assignmentPlan(mode, USER, { 1: 3, 3: 1 });
    assert.deepEqual(plan.palette, USER, String(mode));
    assert.deepEqual(plan.mapping, { 1: 3, 2: 2, 3: 1, 4: 4 }, String(mode));
  }
  assert.equal(normaliseMode(undefined), SLOTS, "the page's default is slots");
  assert.equal(assignmentPlan(SLOTS, USER, {}).mode, SLOTS);
});

await ok("a rule that is silent about a colour keeps that colour where it is", () => {
  assert.deepEqual(completeRule({ 1: 3 }, 4), { 1: 3, 2: 2, 3: 3, 4: 4 });
  assert.equal(isIdentity(identityRule(4)), true);
  assert.equal(isIdentity({ 1: 1, 2: 2, 3: 3, 4: 4 }), true);
  assert.equal(isIdentity({ 1: 2, 2: 1, 3: 3, 4: 4 }), false);
});

if (failures.length) {
  console.error(`\n${failures.length} assignment check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`assignment ok: ${checks} checks`);
}
