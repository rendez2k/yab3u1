// Main-thread wrapper around recolour-worker.js.
//
// Every request is a promise keyed by an id, and every reply carries the id back,
// so a slow answer to an old file or selection can be recognised and dropped
// rather than painted over the new state.  `progress` messages go to the caller's
// callback so the page can show what is happening instead of freezing silently.

export class RecolourWorker {
  constructor(url = new URL("./recolour-worker.js", import.meta.url)) {
    this.worker = new Worker(url, { type: "module" });
    this.nextId = 1;
    this.pending = new Map();
    this.failure = null;
    this.worker.onmessage = (event) => this.receive(event.data || {});
    this.worker.onerror = (event) => {
      const message = (event && event.message) || "the background worker stopped";
      this.failure = Object.assign(new Error(message), {code: 'WORKER_STOPPED'});
      this.worker.terminate();
      this.rejectAll(this.failure);
    };
  }

  /** Reject every pending request: a replaced worker never answers them. */
  rejectAll(message) {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.reject(message instanceof Error ? message : new Error(message));
  }

  receive(message) {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    if (message.type === "progress") {
      if (entry.onProgress) entry.onProgress(message);
      return;
    }
    this.pending.delete(message.id);
    if (message.type === "error") entry.reject(new Error(message.message));
    else entry.resolve(message);
  }

  request(type, payload = {}, { transfer = [], onProgress = null } = {}) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      try { this.worker.postMessage({ type, id, ...payload }, transfer); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  /** Parse an archive.  `bytes` is transferred: the page no longer holds it.
   *
   * `options.light` asks for metadata and a counting summary only: the converter
   * page never draws the model, so it must not pay for the recolour preview's
   * whole-mesh preparation.  The old `load(bytes, onProgress)` call still works.
   */
  load(bytes, options = {}, onProgress = null) {
    if (typeof options === "function") return this.load(bytes, {}, options);
    return this.request("load", { bytes, light: options.light === true },
                        { transfer: [bytes], onProgress });
  }

  /** The selection's own bounds (for the layout box), plus whether that selection
   *  carries painted support enforcers: both belong to the plate the user picked. */
  bounds(plateId, objects) {
    return this.request("bounds", { plateId, objects })
      .then((reply) => ({ bounds: reply.bounds || null,
                          supportsPainted: reply.supportsPainted === true }));
  }

  assess(plateId, objects) {
    return this.request("assess", { plateId, objects }).then((reply) => reply.assessed);
  }

  preview(plateId, objects, mode, colors, mapping, haveGeometry = null,
          estimate = 0, layout = null) {
    return this.request("preview", { plateId, objects, mode, colors, mapping,
                                     haveGeometry, estimate, layout })
      .then((reply) => reply.preview);
  }

  /** Render the saved thumbnail (output colours) without any canvas or WebGL. */
  thumbnail(plateId, objects, colors, mapping, { size = 512, small = null,
                                                 estimate = 0,
                                                 layout = null } = {}) {
    return this.request("thumbnail", { plateId, objects, colors, mapping, size,
                                       small, estimate, layout })
      .then((reply) => ({ main: reply.main, small: reply.small, ms: reply.ms,
                          width: reply.width, triangles: reply.triangles }));
  }

  export(plateId, objects, options) {
    return this.request("export", { plateId, objects, options })
      .then((reply) => ({ bytes: reply.bytes, ms: reply.ms,
                          thumbnails: reply.thumbnails || null }));
  }

  convert(plateId, objects, target, mapping, title, options = {}) {
    return this.request("convert", { plateId, objects, target, mapping, title,
                                     layout: options.layout || null,
                                     preserveSourceSettings:
                                       options.preserveSourceSettings === true,
                                     carrySettings: options.carrySettings !== false,
                                     supportMode: options.supportMode || "auto",
                                     u1Nozzle: options.u1Nozzle || "auto",
                                     layerHeight: options.layerHeight || null,
                                     filamentProfiles: options.filamentProfiles || [],
                                     assignmentMode: options.assignmentMode || null,
                                     removeUnused: options.removeUnused === true,
                                     includeUnused: options.includeUnused || [],
                                     thumbnails: options.thumbnails || null })
      .then((reply) => ({ bytes: reply.bytes, ms: reply.ms,
                          thumbnails: reply.thumbnails || null,
                          settings: reply.settings || null,
                          colours: reply.colours || null }));
  }

  dispose(reason = "a new file was chosen, so the old worker was stopped") {
    this.failure = new Error(reason);
    this.worker.terminate();
    this.rejectAll(this.failure);
  }
}

/** One recovery for worker startup/runtime failure; never retry a rejected model.
 * Re-read the File because the first ArrayBuffer was transferred and detached.
 * Epoch checks prevent recovery from replacing a newer model's worker. */
export async function loadModelWithRecovery({file, restart, isCurrent, onProgress, onRetry}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bytes = await file.arrayBuffer();
    if (!isCurrent()) return null;
    try {
      return await restart(attempt > 0).load(bytes, {}, onProgress);
    } catch (error) {
      if (!isCurrent()) return null;
      if (attempt || error.code !== 'WORKER_STOPPED') throw error;
      onRetry?.();
    }
  }
}
