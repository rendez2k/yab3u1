// The browser-side reader and writer, checked on the synthetic projects the
// Python fixtures build.  Run from the project root:
//
//   python tests/export_js_fixtures.py && node web/tests/project.test.mjs
//
// It also writes the exported projects into web/tests/out-*.3mf so the Python
// side can read them back (test_js_exports.py).

import { readFileSync, writeFileSync } from "node:fs";

import { readZip, writeZip } from "../zip.js";
import * as project from "../shared/project.js";
import * as targets from "../shared/targets.js";

const REELS = [
  { color: "#FFFFFF", type: "PLA" }, { color: "#000000", type: "PLA" },
  { color: "#FF9500", type: "PLA" }, { color: "#FF0080", type: "PLA" },
];

let checks = 0;
const failures = [];

function ok(label, condition, detail = "") {
  checks += 1;
  if (!condition) failures.push(`${label}${detail ? `\n  ${detail}` : ""}`);
}

async function load(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const entries = await readZip(bytes);
  return { entries, project: project.readProject(entries) };
}

async function save(path, entries) {
  const bytes = await writeZip([...entries].map(([name, data]) => ({ name, data })));
  writeFileSync(path, bytes);
  return bytes.length;
}

async function main() {
  const { entries, project: five } = await load("web/tests/five-colours.3mf");
  ok("the five-colour project reads", five.plates.length === 2, `${five.plates.length} plates`);
  ok("its palette is read", five.colors.length === 6, `${five.colors.length} slots`);
  const plate = five.plates[0];
  const eligible = project.eligibleObjects(five, plate.id);
  ok("plate 1 lists its objects", eligible.length === 2, eligible.join(","));

  const assessed = project.analyse(five, plate.id, null);
  ok("the assessment finds five colours", assessed.used.length === 5,
     assessed.used.join(","));
  ok("no undecodable paint", assessed.counts.undecodable_paint === 0,
     String(assessed.counts.undecodable_paint));
  ok("triangle counts are reported", assessed.counts.triangles > 0,
     String(assessed.counts.triangles));

  const plan = (await import("../shared/mix.js")).planMixtures(assessed.sourceColors,
                                                               REELS);
  ok("a mixture is offered for this palette", plan.recipes.length > 0,
     JSON.stringify(plan.advice));
  const mapping = (await import("../shared/mix.js")).mappingFromPlan(plan);

  const soup = project.previewSoup(five, plate.id, null, Object.fromEntries(
    plan.recipes.map((recipe) => {
      const table = targets.palette(REELS.map((r) => r.color),
                                    REELS.map((r) => r.type), [recipe]);
      return [recipe.id, table.virtual[0].color];
    }).concat(REELS.map((reel, index) => [index + 1, reel.color]))),
  mapping);
  ok("the preview builds a soup", soup.triangles > 0, String(soup.triangles));
  ok("with one colour per vertex corner", soup.colors.length === soup.positions.length,
     `${soup.colors.length} vs ${soup.positions.length}`);

  // The placement matrix, not just a translation: rotated.3mf turns its mesh a
  // quarter turn about Z *and* moves it, which is the only shape that tells
  // `x' = m00*x + m10*y + ...` apart from its transpose.  The four world-space
  // corners below come from that matrix by hand (tests/test_u1preview.py asserts
  // the same numbers on the Python side).
  const { project: turned } = await load("web/tests/rotated.3mf");
  const turnedSoup = project.previewSoup(turned, 1, null,
                                         { 1: "#FFFFFF", 2: "#000000" }, { 1: 1, 2: 2 });
  const firstFacet = [...turnedSoup.positions.slice(0, 9)].map((v) => Math.round(v));
  ok("the preview applies rotation and translation, not the transpose",
     JSON.stringify(firstFacet) === JSON.stringify([100, 100, 30, 100, 110, 30,
                                                    90, 110, 30]),
     JSON.stringify(firstFacet));

  // A PrusaSlicer object whose volumes are triangle ranges: a negative volume
  // subtracts material, so reading the object as one mesh would fill the hole in.
  let volumeError = null;
  try {
    await load("web/tests/prusa-negative.3mf");
  } catch (error) {
    volumeError = error.message;
  }
  ok("a Prusa multi-volume object is refused, not flattened",
     Boolean(volumeError && volumeError.includes("volumes")), String(volumeError));

  // A nested assembly (a component that is itself built from components) is more
  // than assess/preview/export resolve, so it is refused rather than drawn wrong.
  let nestedError = null;
  try {
    const { project: nested } = await load("web/tests/nested.3mf");
    project.analyse(nested, 1, null);
  } catch (error) {
    nestedError = error.message;
  }
  ok("a nested component graph is refused", Boolean(nestedError
     && nestedError.includes("nested assemblies")), String(nestedError));

  // Paint that names a colour the palette never describes must stop the export
  // rather than being carried through unchanged.
  let paletteError = null;
  try {
    const { project: odd } = await load("web/tests/paint-beyond-palette.3mf");
    project.exportProject(odd, 1, null, { target: "snapmaker", reels: REELS,
                                          mapping: { 9: 1 } });
  } catch (error) {
    paletteError = error.message;
  }
  ok("paint naming a colour outside the palette is refused", Boolean(paletteError
     && paletteError.includes("palette does not describe")), String(paletteError));

  // A tiny cap must sample across the whole model, not keep its first triangles.
  const { project: wide } = await load("web/tests/wide-quad.3mf");
  const sampled = project.previewSoup(wide, 1, null,
                                      { 1: "#FFFFFF", 2: "#000000" }, null, 2);
  let widest = -Infinity;
  for (let i = 0; i < sampled.positions.length; i += 3) {
    widest = Math.max(widest, sampled.positions[i]);
  }
  ok("a capped preview is sampled across the model, not truncated",
     sampled.triangles > 0 && widest > 40,
     `triangles ${sampled.triangles}, stride ${sampled.stride}, widest ${widest}`);

  // ZIP integrity: a duplicate name, a damaged member and an oversized one must
  // be refused before anything is parsed out of them.
  const dup = await writeZip([{ name: "a.txt", data: new TextEncoder().encode("one") },
                              { name: "a.txt", data: new TextEncoder().encode("two") }]);
  let dupError = null;
  try { await readZip(dup); } catch (error) { dupError = error.message; }
  ok("a duplicated member name is refused",
     Boolean(dupError && dupError.includes("more than once")), String(dupError));

  const good = await writeZip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
  const damaged = good.slice();
  // Flip a byte of the stored data, leaving the header's checksum alone.
  damaged[damaged.length - 30] = damaged[damaged.length - 30] ^ 0xff;
  let crcError = null;
  try { await readZip(damaged); } catch (error) { crcError = error.message; }
  ok("a member whose checksum does not match is refused", Boolean(crcError),
     String(crcError));

  const huge = await writeZip([{ name: "big.bin", data: new Uint8Array(1) }]);
  const view = new DataView(huge.buffer, huge.byteOffset, huge.length);
  // Claim a 400 MB member in the central directory: the claim alone is enough to
  // refuse it, before anything is inflated.
  const centralAt = huge.length - 22 - 46 - "big.bin".length;
  view.setUint32(centralAt + 24, 400 * 1024 * 1024, true);
  let sizeError = null;
  try { await readZip(huge); } catch (error) { sizeError = error.message; }
  ok("a member that claims to expand past the limit is refused", Boolean(sizeError),
     String(sizeError));

  const recipes = plan.recipes.map((recipe) => ({ a: recipe.a, b: recipe.b,
                                                  percent: recipe.percent }));
  // The five-colour fixture has a three-volume object, which the PrusaSlicer
  // writer refuses by design (it cannot describe per-volume triangle ranges
  // faithfully), so the target loop covers the two it can write and the refusal
  // is checked separately below.
  for (const target of ["snapmaker", "bambu", "prusa"]) {
    if (target === "prusa") {
      let refused = null;
      try {
        project.exportProject(five, plate.id, null,
                              { target, reels: REELS, mapping, recipes });
      } catch (error) {
        refused = error.message;
      }
      ok("the prusa export refuses a multi-volume object", Boolean(refused
        && refused.includes("triangle ranges")), String(refused));
      continue;
    }
    const built = project.exportProject(five, plate.id, null,
                                        { target, reels: REELS, mapping, recipes,
                                          title: "five" });
    ok(`${target} export reports no problems`, built.problems.length === 0,
       built.problems.join("; "));
    ok(`${target} export has a model`, built.entries.has(project.MODEL_FILE));
    ok(`${target} export writes member files`,
       [...built.entries.keys()].some((name) => name.startsWith(project.OBJECTS_DIR)));
    const size = await save(`web/tests/out-${target}.3mf`, built.entries);
    ok(`${target} export writes an archive`, size > 1000, `${size} bytes`);
  }

  // The Snapmaker export must keep the U1 profile the appliance expects.
  const snapmaker = project.exportProject(five, plate.id, null,
                                          { target: "snapmaker", reels: REELS,
                                            mapping, recipes });
  const cfg = JSON.parse(new TextDecoder().decode(
    snapmaker.entries.get(project.SRC_BBL_PROJECT)));
  ok("the snapmaker export carries the U1 printer id", Boolean(cfg.printer_settings_id));
  ok("the snapmaker export keeps four physical filaments",
     cfg.filament_colour.length === 4, String(cfg.filament_colour.length));
  ok("the snapmaker export writes the recipe rows",
     String(cfg.mixed_filament_definitions || "").split(";").length === recipes.length + 6,
     String(cfg.mixed_filament_definitions || "").slice(0, 80));

  // With no recipes written, the mapping has to name the four reels only: the
  // export refuses a destination it does not write, which is the point of the
  // check below as well.
  const nearest = Object.fromEntries(
    Object.keys(mapping).map((source) => [source, Math.min(4, mapping[source])]));
  const bad = project.exportProject(five, plate.id, null,
                                    { target: "bambu", reels: REELS,
                                      mapping: nearest, recipes: [] });
  const badCfg = JSON.parse(new TextDecoder().decode(bad.entries.get(project.SRC_BBL_PROJECT)));
  ok("a foreign export with no recipes writes no mixture fields",
     !("filament_is_mixed" in badCfg));
  ok("a foreign export never carries U1 machine settings",
    !targets.MACHINE_KEYS.some((key) => key in badCfg));
  let outOfRange = null;
  try {
    project.exportProject(five, plate.id, null,
                          { target: "bambu", reels: REELS, mapping, recipes: [] });
  } catch (error) {
    outOfRange = error.message;
  }
  ok("a mapping onto a recipe that is not written is refused",
     Boolean(outOfRange && outOfRange.includes("filaments 1..")), String(outOfRange));

  // A one-volume object is what the PrusaSlicer writer supports: the mesh goes
  // into the object and the volume range is in triangle indices.  The single-object
  // fixture is exactly that shape (the five-colour one is three volumes, and the
  // refusal for it is checked above).
  {
    const { project: solo } = await load("web/tests/single-object.3mf");
    const one = project.analyse(solo, 1, null);
    const onePlan = (await import("../shared/mix.js")).planMixtures(one.sourceColors,
                                                                   REELS);
    const prusa = project.exportProject(solo, 1, null, {
      target: "prusa", reels: REELS,
      mapping: (await import("../shared/mix.js")).mappingFromPlan(onePlan),
      recipes: onePlan.recipes.map((r) => ({ a: r.a, b: r.b, percent: r.percent })),
    });
    const model = new TextDecoder().decode(prusa.entries.get(project.MODEL_FILE));
    const struct = new TextDecoder().decode(
      prusa.entries.get(targets.PRUSA_MODEL_CONFIG));
    ok("the prusa export keeps the mesh in the object", model.includes("<mesh>"));
    ok("the prusa export writes no external members",
       ![...prusa.entries.keys()].some((name) => name.startsWith(project.OBJECTS_DIR)));
    ok("the prusa export describes a triangle range",
       /<volume firstid="0" lastid="\d+">/.test(struct), struct.slice(0, 120));
    ok("the prusa export carries its Full Spectrum description",
       prusa.entries.has(targets.PRUSA_SPECTRUM_JSON));
    ok("the prusa export carries no Bambu metadata",
       !prusa.entries.has("Metadata/model_settings.config")
       && !prusa.entries.has("Metadata/slice_info.config")
       && !prusa.entries.has("Metadata/project_settings.config"));
    const bytes = await save("web/tests/out-prusa.3mf", prusa.entries);
    ok("the prusa export writes an archive", bytes > 1000, `${bytes} bytes`);

    // A portable Prusa project has no Slic3r_PE.config on purpose, so its palette
    // has to come from the Full Spectrum description.  Reading it back as white
    // defaults is the failure this checks for.
    const back = await load("web/tests/out-prusa.3mf");
    ok("the prusa export reopens as a Prusa project", back.project.kind === "prusa",
       back.project.kind);
    ok("its palette comes from the Full Spectrum description",
       back.project.paletteSource === "Prusa_Slicer_full_spectrum.json",
       back.project.paletteSource);
    ok("its palette is four reels plus the recipes",
       back.project.colors.length === 4 + onePlan.recipes.length,
       `${back.project.colors.length} slots`);
    const reassessed = project.analyse(back.project, 1, null);
    ok("the reopened project paints states its palette describes",
       reassessed.used.every((id) => back.project.colors[id - 1]),
       reassessed.used.join(","));
  }

  if (failures.length) {
    console.error(`${failures.length} of ${checks} browser project checks failed:\n`);
    failures.forEach((line) => console.error(line + "\n"));
    process.exit(1);
  }
  console.log(`browser project ok: ${checks} checks`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
