import { MAX_ARCHIVE_BYTES } from "../zip.js";
import { TARGETS } from "./targets.js";
import { targetLayout, planLayout } from "./layout.js";
import { planningAllowance, transferSettings } from "./printSettings.js";
import { thumbnailSizes } from "./thumbnail.js";
import {buildU1Profile, constrainLayers, resolveLayerHeight} from './u1Profiles.js';

export const MAX_BATCH_FILES = 50;
export const MAX_BATCH_OUTPUT = 256 * 1024 * 1024;

const stem = name => String(name).replace(/\.3mf$/i, "").replace(/[^\w.-]+/g, "-")
  .replace(/^[.-]+|[.-]+$/g, "").slice(0, 80) || "model";
const messageOf = error => error?.message || String(error);

/** Sequential conversion using the same worker, settings and thumbnail path as
 * single-file conversion. A fresh worker per source releases its parsed meshes.
 * The archive worker owns only compressed outputs, bounded by MAX_BATCH_OUTPUT. */
export class BatchSession {
  constructor(makeWorker, makeArchive, hooks = {}) {
    this.makeWorker = makeWorker;
    this.makeArchive = makeArchive;
    this.hooks = hooks;
    this.busy = false;
    this.packing = false;
    this.cancelled = false;
    this.closed = false;
  }

  cancel() {
    if (!this.busy || this.packing) return;
    this.cancelled = true;
    this.worker?.dispose("Batch stopped; completed outputs will be kept.");
  }

  close() {
    this.closed = true;
    this.cancelled = true;
    this.worker?.dispose("Page closed");
    this.archive?.dispose("Page closed");
  }

  status(text) { if (!this.closed) this.hooks.status?.(text); }
  row(index, status, detail) { if (!this.closed) this.hooks.row?.(index, { status, detail }); }

  async run(input, { target = "snapmaker", keepSettings = true, u1Nozzle = "auto", layerHeight = null } = {}) {
    if (this.busy || this.closed) return null;
    const files = Array.from(input);
    if (!files.length || files.length > MAX_BATCH_FILES) throw new Error("Choose 1–50 files per batch.");
    if (!TARGETS.includes(target)) throw new Error("Choose a supported destination format.");
    layerHeight=target==='snapmaker' ? {...(layerHeight || {mode:'preserve'})} : null;
    this.busy = true;
    this.cancelled = false;
    const report = { tool: "YAB3D", target, keepSettings, layerHeight, started: new Date().toISOString(),
      notes: ["Each source plate is exported separately; its objects and existing copies are kept and centred as a group.",
        "Colours and filament order are preserved. No resizing, extra clones or palette reduction.",
        "Compatible global and object settings are transferred; part/modifier overrides and some slicer-specific settings are not supported.",
        "Open and slice outputs in the destination slicer. Automatic supports, brims, rafts and tower size need checking.",
        target === "snapmaker" ? "U1 outputs use the bundled machine profile and check the 270 × 270 mm planning area."
          : "Portable outputs keep your destination printer profile. Bed fit cannot be verified without choosing that printer."],
      entries: [] };
    let outputBytes = 0, outputCount = 0;
    try {
      this.archive = this.makeArchive();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (this.cancelled) {
          report.entries.push({ source: file.name, status: "cancelled", message: "Not started" });
          this.row(index, "cancelled", "Not started");
          this.hooks.progress?.(index + 1, files.length);
          continue;
        }
        const results = [];
        try {
          if (!/\.3mf$/i.test(file.name)) throw new Error("Not a .3mf file");
          if (file.size > MAX_ARCHIVE_BYTES) throw new Error("File exceeds the 96 MB input limit; convert a smaller project.");
          this.status(`File ${index + 1} of ${files.length}: reading ${file.name}`);
          this.row(index, "working", "Reading model…");
          const bytes = await file.arrayBuffer();
          if (this.cancelled) throw new Error("Stopped before reading");
          this.worker = this.makeWorker();
          const loaded = await this.worker.load(bytes, { light: true });
          if (this.cancelled) throw new Error("Stopped while reading");
          if (loaded.summary?.mixtures?.length) throw new Error("Native filament blends need individual review in Full Spectrum; this batch keeps solid filaments only.");
          const { meta } = loaded;
          if (!meta.plates?.length) throw new Error("No printable plates found");
          for (let p = 0; p < meta.plates.length; p += 1) {
            const plate = meta.plates[p];
            const entry = { source: file.name, plate: plate.name || `Plate ${p + 1}`, plateId: plate.id };
            results.push(entry);
            report.entries.push(entry);
            if (this.cancelled) { Object.assign(entry, { status: "cancelled", message: "Not converted" }); continue; }
            try {
              this.row(index, "working", `Plate ${p + 1} of ${meta.plates.length}: converting…`);
              if (Array.isArray(plate.objectIds) && !plate.objectIds.length) {
                Object.assign(entry, { status: "skipped", message: "Empty plate" });
                continue;
              }
              const measured = await this.worker.bounds(plate.id, null);
              if (this.cancelled) throw new Error("Stopped");
              if (!measured.bounds) throw new Error("No printable geometry on this plate");
              const ids = new Set((plate.objectIds || []).map(String));
              const objects = (meta.objectSettings || []).filter(o => !ids.size || ids.has(String(o.id)));
              const sources = (objects.length ? objects : [{}]).map(o =>
                ({ ...(meta.sourceSettings || {}), ...(o.settings || {}) }));
              const allowance = planningAllowance(sources, target, keepSettings, "auto", measured.supportsPainted);
              const size = measured.bounds.max.map((v, i) => v - measured.bounds.min[i]);
              const layout = { ...targetLayout(target, { copies: 1, spacing: 5, tower: target === "snapmaker",
                width: Math.max(270, size[0] + allowance.padding * 2 + 10),
                depth: Math.max(270, size[1] + allowance.padding * 2 + 10) }), ...allowance };
              if (planLayout(measured.bounds, layout).blocked) throw new Error("This plate's group does not fit the U1 with print/tower clearance. Arrange it in Single file or the slicer.");
              const profile=target==='snapmaker' ? buildU1Profile(meta.sourceSettings,meta.types,u1Nozzle,{carry:keepSettings,layerHeight}) : null;
              entry.layerHeights=profile ? sources.map((source,n)=>({object:objects[n]?.name || objects[n]?.id || 'Global',...resolveLayerHeight(source,profile.match,layerHeight)})) : [];
              entry.settings = keepSettings ? sources.map((source, n) => {
                const transfer=transferSettings(source,target,{object:target!=='snapmaker',baseline:profile?.cfg});
                if(profile)transfer.skipped.push(...constrainLayers(transfer.values,profile.match));
                if(profile)transfer.values.layer_height=String(resolveLayerHeight(source,profile.match,layerHeight).height);
                return {object:objects[n]?.name || objects[n]?.id || 'Global',...transfer};
              }) : [];
              entry.notes = [...(meta.warnings || []), ...allowance.footprintNotes];
              const colors = Object.fromEntries(meta.colors.map((color, i) => [i + 1, color]));
              const mapping = Object.fromEntries(meta.colors.map((_, i) => [i + 1, i + 1]));
              const sizes = thumbnailSizes(target);
              const thumbnails = await this.worker.thumbnail(plate.id, null, colors, mapping,
                { size: sizes.main, small: sizes.small, layout });
              if (this.cancelled) throw new Error("Stopped");
              const output = await this.worker.convert(plate.id, null, target, mapping, stem(file.name),
                { layout, thumbnails, u1Nozzle, layerHeight, preserveSourceSettings: keepSettings, carrySettings: keepSettings,
                  supportMode: "auto", assignmentMode: "slots" });
              if (this.cancelled) throw new Error("Stopped");
              const data = output.bytes instanceof Uint8Array ? output.bytes : new Uint8Array(output.bytes);
              if (data.byteLength + outputBytes > MAX_BATCH_OUTPUT) throw new Error("Batch output limit (256 MB) reached. Run the remaining files in a smaller batch.");
              const name = `${String(index + 1).padStart(3, "0")}-${stem(file.name)}${meta.plates.length > 1 ? `-plate-${p + 1}` : ""}-${target}.3mf`;
              const length = data.byteLength;
              await this.archive.request("add", { name, bytes: data }, { transfer: [data.buffer] });
              outputBytes += length;
              outputCount += 1;
              Object.assign(entry, { status: "converted", output: name, bytes: length,
                ...(output.settings ? { supportDecision: output.settings.support, profile:output.settings.profile, nozzle:output.settings.nozzle, materials:output.settings.materials, profileNotes:output.settings.notes } : {}) });
            } catch (error) {
              Object.assign(entry, { status: this.cancelled ? "cancelled" : "failed", message: messageOf(error) });
            }
          }
          const done = results.filter(e => e.status === "converted").length;
          const failed = results.filter(e => e.status === "failed").length;
          this.row(index, done ? (failed || this.cancelled ? "partial" : "converted")
            : this.cancelled ? "cancelled" : failed ? "failed" : "skipped",
          `${done} output${done === 1 ? "" : "s"}${failed ? ` · ${failed} failed: ${results.find(e => e.status === "failed").message}` : ""}`);
        } catch (error) {
          const status = this.cancelled ? "cancelled" : "failed";
          report.entries.push({ source: file.name, status, message: messageOf(error) });
          this.row(index, status, messageOf(error));
        } finally {
          this.worker?.dispose("File complete");
          this.worker = null;
        }
        this.hooks.progress?.(index + 1, files.length);
      }
      if (this.closed) return null;
      this.packing = true;
      this.hooks.packing?.();
      this.status(`Preparing ZIP with ${outputCount} converted file${outputCount === 1 ? "" : "s"} and a report…`);
      report.cancelled = this.cancelled;
      report.outputs = outputCount;
      report.finished = new Date().toISOString();
      const packed = await this.archive.request("finish", { report });
      if (this.closed) return null;
      return { bytes: packed.bytes, report, name: `yab3d-${target}-batch.zip` };
    } finally {
      this.worker?.dispose("Batch finished");
      this.archive?.dispose("Batch finished");
      this.worker = this.archive = null;
      this.busy = this.packing = false;
    }
  }
}
