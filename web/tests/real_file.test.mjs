// The browser pipeline against a real project, without a browser.
//
//   node web/tests/real_file.test.mjs "C:\path\to\model.3mf" [cap]
//
// This is the same code the online page runs — readZip, readProject, analyse,
// previewSoup, exportProject — so it catches the failures that only appear on real
// files (huge arrays, inline meshes, missing transforms) quickly. It writes the
// Snapmaker export next to the source as <name>.browser-check.3mf so the Python
// side can read the same file back.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readZip, writeZip } from "../zip.js";
import { mappingFromPlan, planMixtures } from "../shared/mix.js";
import * as project from "../shared/project.js";

const REELS = [
  { color: "#FFFFFF", type: "PLA" }, { color: "#000000", type: "PLA" },
  { color: "#FF9500", type: "PLA" }, { color: "#FF0080", type: "PLA" },
];

const source = process.argv[2];
const cap = Number(process.argv[3] || 200000);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "analysis-previews", "preview-targets-swaps");
if (!source) {
  console.error("usage: node web/tests/real_file.test.mjs <model.3mf> [cap]");
  process.exit(2);
}

function mark(label, started) {
  console.log(`  ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main() {
  const failures = [];
  let started = Date.now();
  const bytes = new Uint8Array(readFileSync(source));
  const entries = await readZip(bytes);
  mark(`read ${(bytes.length / 1048576).toFixed(1)} MB, ${entries.size} members`, started);

  started = Date.now();
  const parsed = project.readProject(entries);
  mark(`project: ${parsed.plates.length} plate(s), ${parsed.objects.size} objects`, started);

  const plate = parsed.plates[0];
  const eligible = project.eligibleObjects(parsed, plate.id);
  started = Date.now();
  const assessed = project.analyse(parsed, plate.id, null);
  mark(`assessment: ${assessed.used.length} colours, `
    + `${assessed.counts.triangles.toLocaleString()} triangles`, started);
  if (!assessed.used.length) failures.push("the assessment found no colours");

  const plan = planMixtures(assessed.sourceColors, REELS);
  const mapping = mappingFromPlan(plan);
  const recipes = plan.recipes.map((r) => ({ a: r.a, b: r.b, percent: r.percent }));

  started = Date.now();
  const soup = project.previewSoup(parsed, plate.id, null, {}, mapping, cap);
  mark(`preview soup: ${soup.triangles.toLocaleString()} triangles, `
    + `${soup.positions.length.toLocaleString()} floats`, started);
  if (!soup.triangles) failures.push("the preview soup is empty");
  if (soup.colors.length !== soup.positions.length) {
    failures.push(`colour buffer ${soup.colors.length} != position buffer `
      + `${soup.positions.length}`);
  }

  for (const target of ["snapmaker", "bambu", "prusa"]) {
    started = Date.now();
    let built;
    try {
      built = project.exportProject(parsed, plate.id, null,
                                    { target, reels: REELS, mapping, recipes });
    } catch (error) {
      if (target === "prusa") {
        console.log(`  prusa: refused — ${error.message.slice(0, 90)}`);
        continue;
      }
      failures.push(`${target}: ${error.message}`);
      continue;
    }
    const model = new TextDecoder().decode(built.entries.get(project.MODEL_FILE));
    // Reachable geometry: the root objects' own meshes plus every member they
    // reference, which is how an inline or a part-based project is written.
    const referenced = new Set([...(model.matchAll(/p:path="([^"]+)"/g))]
      .map((match) => match[1].replace(/^\//, "")));
    referenced.add(project.MODEL_FILE);
    let triangles = 0;
    for (const name of referenced) {
      const data = built.entries.get(name);
      if (!data) {
        failures.push(`${target}: the model references ${name}, which is missing`);
        continue;
      }
      triangles += (new TextDecoder().decode(data).match(/<triangle\b/g) || []).length;
    }
    const items = (model.match(/<item\b/g) || []).length;
    const emptyComponents = (model.match(/<components>\s*<\/components>/g) || []).length;
    mark(`${target}: ${built.entries.size} members, ${triangles.toLocaleString()} `
      + `inline triangles, ${items} items`, started);
    if (built.problems.length) failures.push(`${target}: ${built.problems[0]}`);
    if (emptyComponents) failures.push(`${target}: ${emptyComponents} empty component `
      + "block(s)");
    if (!triangles) failures.push(`${target}: no reachable geometry in the model`);
    if (target === "snapmaker") {
      mkdirSync(OUT_DIR, { recursive: true });
      const out = join(OUT_DIR, basename(source).replace(/\.3mf$/i, "")
        + ".browser-check.3mf");
      const written = await writeZip([...built.entries].map(([name, data]) =>
        ({ name, data })));
      writeFileSync(out, written);
      console.log(`  wrote ${basename(out)} (${(written.length / 1048576).toFixed(1)} MB)`);
    }
  }

  if (failures.length) {
    console.error(`real-file check FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`real-file check OK (${eligible.length} eligible object(s) on plate 1)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
