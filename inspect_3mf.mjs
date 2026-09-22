import { readFileSync, writeFileSync } from "node:fs";
import { readZip, writeZip } from "./web/zip.js";
import { readSource, describe, convert, plateCapacity } from "./web/converter.js";

const SRC = process.argv[2];
const TMP = process.env.TEMP;

const t0 = Date.now();
const entries = await readZip(new Uint8Array(readFileSync(SRC)));
console.log(`read ${entries.size} members in ${Date.now() - t0} ms`);

const t1 = Date.now();
const src = readSource(entries);
console.log(`parsed in ${Date.now() - t1} ms`);
console.log("  kind          :", src.kind);
console.log("  object        :", src.objectName);
console.log("  paletteSource :", src.paletteSource, "->", src.colors.join(" "));
console.log("  types         :", src.types.join(" "));
console.log("  baseExtruder  :", src.baseExtruder);
console.log("  paintStates   :", [...src.paintStates].sort((a, b) => a[0] - b[0]));
console.log("  painted       :", src.painted, "subdivided", src.subdivided);
console.log("  hasSupports   :", src.hasSupports);
console.log("  support       :", JSON.stringify(src.support));
console.log("  meshBounds    :", JSON.stringify(src.meshBounds));
console.log("  placement     :", JSON.stringify(src.placement[3]));

const info = describe(src);
console.log("  describe      :", JSON.stringify({
  footprint: info.footprint, capacity: info.capacity, bed: info.bed,
}));
console.log("  slots         :", JSON.stringify(info.slots));

for (const gap of [5, 10, 20, 7777]) {
  console.log(`  capacity @${gap}:`, plateCapacity(src, gap));
}

for (const [tag, copies] of [["one", 1], ["fill", 1e6]]) {
  const t = Date.now();
  const res = await convert(entries, { copies, gap: 5, supports: "auto" });
  const out = await writeZip(res.items);
  writeFileSync(`${TMP}/js_${tag}.3mf`, out);
  console.log(`\n[${tag}] converted in ${Date.now() - t} ms -> ${out.length.toLocaleString()} bytes`);
  console.log(res.log.join("\n"));
}
