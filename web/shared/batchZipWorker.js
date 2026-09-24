// Completed 3MFs are already compressed: store them without recompressing.
// ZIP assembly and checksums stay off the main thread.
import { writeZip } from "../zip.js";
const items = [];
let total = 0;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === "add") {
      const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes);
      if (total + bytes.byteLength > 256 * 1024 * 1024) throw new Error("Batch exceeds 256 MB");
      if (!/^[\w.-]+\.3mf$/.test(data.name) || items.some(i => i.name === data.name)) throw new Error("Invalid or duplicate output filename");
      total += bytes.byteLength;
      items.push({ name: data.name, data: bytes });
      self.postMessage({ id, type: "added" });
    } else if (type === "finish") {
      const report = data.report;
      const text = ["YAB3D bulk conversion", `Destination: ${report.target}`, `Converted outputs: ${report.outputs}`,
        `Stopped early: ${report.cancelled ? "yes" : "no"}`, "", ...report.notes, "", ...report.entries.flatMap(e => [
          `${e.status.toUpperCase()}: ${e.source}${e.plate ? ` / ${e.plate}` : ""}`,
          e.output ? `  Output: ${e.output}` : `  ${e.message || ""}`,
          ...(e.profile ? [`  Profile: ${e.profile}`, `  Nozzle: ${e.nozzle} mm`, `  Materials: ${(e.materials || []).join(', ')}`] : []),
          ...(e.profileNotes || []).map(n => `  Profile note: ${n}`),
          ...(e.notes || []).map(n => `  Note: ${n}`),
          ...(e.settings || []).filter(s => s.skipped.length).map(s => `  Not transferred (${s.object}): ${s.skipped.join(", ")}`),
        ]), "", "Full transferred values are listed in conversion-report.json."].join("\n");
      const encode = value => new TextEncoder().encode(value);
      const bytes = await writeZip([...items,
        { name: "conversion-report.txt", data: encode(text) },
        { name: "conversion-report.json", data: encode(JSON.stringify(report, null, 2)) }], { compress: false });
      items.length = 0;
      self.postMessage({ id, type: "packed", bytes }, [bytes.buffer]);
    } else throw new Error("Unknown archive operation");
  } catch (error) { self.postMessage({ id, type: "error", message: error.message }); }
};
