/**
 * Parity check: run one fixture through both converters and compare the decisions
 * they make.
 *
 * There are two implementations of the same converter -- web/converter.js for the
 * page, u1convert.py for the desktop tool -- and fixes have twice been applied to
 * one and not the other. This exists so that drift shows up as a failing line
 * instead of a wrong claim to the user.
 *
 * The two legitimately disagree on *values*: the page can only diff against its
 * bundled base settings, while the desktop tool overlays your installed Orca
 * profiles. So this compares the decisions that must agree regardless of that --
 * what was carried over, and what the support decision was -- not every key.
 *
 *   cd <repo root>
 *   node parity_check.mjs [fixture.3mf] [auto|on|off] [copies]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const FIXTURE = process.argv[2] ||
  path.join(ROOT, "Flippin Pumpkin painted (original PrusaSlicer XL 5T).3mf");
const MODE = process.argv[3] || "auto";
const COPIES = String(process.argv[4] || 1);

// The page's modules are ESM with no package.json of their own, so copy them
// somewhere Node will treat them as modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
for (const f of fs.readdirSync(path.join(ROOT, "web"))) {
  if (f.endsWith(".js")) fs.copyFileSync(path.join(ROOT, "web", f), path.join(tmp, f));
}
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');

const web = await import(pathToFileURL(path.join(tmp, "converter.js")).href);
const zip = await import(pathToFileURL(path.join(tmp, "zip.js")).href);
const decoder = new TextDecoder();

const entries = await zip.readZip(new Uint8Array(fs.readFileSync(FIXTURE)));
const webOut = await web.convert(entries, { supports: MODE, copies: Number(COPIES) });
const webCfg = JSON.parse(decoder.decode(
  webOut.items.find((i) => i.name === "Metadata/project_settings.config").data));

const desktopFile = path.join(tmp, "desktop-U1.3mf");
execFileSync("python", [path.join(ROOT, "u1convert.py"), FIXTURE, "-o", desktopFile,
  "--supports", MODE, "--copies", COPIES], { cwd: ROOT, stdio: "pipe" });
const desktopCfg = JSON.parse(decoder.decode(
  (await zip.readZip(new Uint8Array(fs.readFileSync(desktopFile))))
    .get("Metadata/project_settings.config")));

const DECISIONS = [
  "enable_support", "support_type", "support_threshold_angle",
  "layer_height", "initial_layer_print_height", "wall_loops",
  "top_shell_layers", "top_shell_thickness", "bottom_shell_layers",
  "sparse_infill_density", "sparse_infill_pattern", "brim_width",
];

console.log(`fixture : ${path.basename(FIXTURE)}`);
console.log(`options : supports=${MODE} copies=${COPIES}\n`);

let differ = 0;
for (const key of DECISIONS) {
  const a = JSON.stringify(webCfg[key] ?? null);
  const b = JSON.stringify(desktopCfg[key] ?? null);
  const same = a === b;
  if (!same) differ++;
  console.log(`  ${same ? "ok  " : "DIFF"}  ${key.padEnd(28)} web ${a}` +
              (same ? "" : `   desktop ${b}`));
}

const webOverrides = (webCfg.different_settings_to_system || [""])[0].split(";").filter(Boolean);
const desktopOverrides = (desktopCfg.different_settings_to_system || [""])[0].split(";").filter(Boolean);
console.log(`\n  overrides: web ${webOverrides.length}, desktop ${desktopOverrides.length}` +
  "  (expected to differ -- bundled baseline vs installed profiles)");
console.log(`  both list enable_support: ` +
  `${webOverrides.includes("enable_support") === desktopOverrides.includes("enable_support")}`);

console.log(`\n${differ ? "FAIL" : "PASS"} - ${DECISIONS.length - differ}/${DECISIONS.length} ` +
  "decisions agree");
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(differ ? 1 : 0);
