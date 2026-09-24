// Race-safe orchestration for the homepage converter.
//
// The page holds no conversion state of its own: it renders what this session
// reports, and asks the session to change the assignment or export.  The session
// owns the worker, an *epoch* that invalidates every reply belonging to a file
// the user has replaced, the source→destination assignment and the one download
// it is willing to hand over.
//
// The assignment has two modes, each with its own map so that switching back and
// forth never loses the other one:
//
//   slots    "arrange slots": the map is a bijection, a destination that is
//            already taken displaces its colour back to the vacated slot, and
//            the export rearranges the palette so the model keeps its look.
//   repaint  "repaint colours": the map may send several sources to one
//            filament and the printed colours change.
//
// The worker factory and the object-URL helpers are injected so a test can drive
// the races with a deliberately slow fake worker, without a browser.

import { planLayout, targetLayout } from "./layout.js";
import { REPAINT, SLOTS, identityRule, normaliseMode } from "./assignment.js";
import { planningAllowance } from "./printSettings.js";
export const TYPED_3MF = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";

export { identityRule };

export function safeName(title) {
  return String(title || "model").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "")
    || "model";
}

export class ConvertSession {
  /**
   * @param {() => {load: Function, convert: Function, dispose: Function}} makeWorker
   * @param {{status?: Function, loaded?: Function, rule?: Function,
   *          output?: Function, error?: Function, busy?: Function,
   *          cleared?: Function, progress?: Function, settled?: Function}} hooks
   * @param {{create?: Function, revoke?: Function}} urls
   */
  constructor(makeWorker, hooks = {}, urls = {}) {
    this.makeWorker = makeWorker;
    this.hooks = hooks;
    this.urls = {
      create: urls.create || ((blob) => URL.createObjectURL(blob)),
      revoke: urls.revoke || ((url) => URL.revokeObjectURL(url)),
    };
    this.worker = null;
    this.epoch = 0;
    this.revision = 0;
    this.target = "snapmaker";
    this.state = null;      // {title, colours, types, plates, plateId, summary}
    // One map per mode, so switching modes keeps both.  The page reads the
    // active one through the `rule` getter.
    // Each map is source index (1-based) -> destination filament.
    this.rules = { [SLOTS]: {}, [REPAINT]: {} };
    this.assignmentMode = SLOTS;
    // U1 projects use the destination bed. Other targets retain an editable
    // planning area, initially measured from the source file.
    this.layout = targetLayout(this.target,
      { copies: 1, spacing: 5, width: 270, depth: 270, tower: true });
    this.genericArea = { width: 270, depth: 270 };
    this.layoutEdited = false;
    // Carry compatible designer settings by default; destination hardware and
    // machine profiles remain independent of the source.
    this.preserveSourceSettings = true;
    // The U1 target's own controls.  Unlike the Bambu colour model above, a U1
    // project *is* a printer project, so the compatible source settings travel by
    // default -- that is the behaviour the original converter had -- and the
    // support decision follows the source until the user overrides it.
    this.carrySettings = true;
    this.supportMode = "auto";
    this.u1Nozzle = "auto";
    this.filamentProfiles = [];
    this.output = null;     // {url, name, target, bytes, mapping}
    this.busy = false;
    this.renderThumbnail = null;   // set by the page: never save without one
    this.convertSeq = 0;    // so an obsolete export cannot clear a newer one's lock
    this.closed = false;
  }

  /** The source→destination map of the mode that is in force now. */
  get rule() {
    return this.rules[this.assignmentMode] || {};
  }

  activeColourIds() {
    if (!this.state) return [];
    const usage = this.state.filamentUsage;
    return this.state.colours.map((_,i)=>i+1).filter(id=>!usage || usage.kept.includes(id) || this.state.includeUnused.includes(id));
  }

  physicalSlots() { return this.target === "snapmaker" && this.assignmentMode === SLOTS; }

  destinationIds() {
    return this.physicalSlots()
      ? Array.from({length: Math.max(4, this.state?.colours.length || 0)}, (_,i)=>i+1)
      : this.activeColourIds();
  }

  setUnused(source, include) {
    if (!this.state?.filamentUsage?.unused.includes(source)) return false;
    const selected = new Set(this.state.includeUnused);
    if (include) selected.add(source); else selected.delete(source);
    this.state.includeUnused = [...selected];
    // A changed palette starts fresh so a now-excluded slot cannot remain a
    // destination of an earlier arrangement or repaint.
    const count = this.state.colours.length;
    this.rules = { [SLOTS]: identityRule(count), [REPAINT]: identityRule(count) };
    this.invalidate();
    if (this.hooks.loaded) this.hooks.loaded(this.state);
    return true;
  }

  planningLayout() {
    const ids = this.state?.plates.find(p => String(p.id) === String(this.state.plateId))?.objectIds;
    const objects = (this.state?.objectSettings || []).filter(o => !ids || ids.map(String).includes(String(o.id)));
    const sources = (objects.length ? objects : [{}]).map(o =>
      ({ ...(this.state?.sourceSettings || {}), ...(o.settings || {}) }));
    return { ...targetLayout(this.target, this.layout), ...planningAllowance(sources,
      this.target, this.target === "snapmaker" ? this.carrySettings : this.preserveSourceSettings,
      this.supportMode, Boolean(this.state?.supportsPainted)) };
  }

  /**
   * Choose how the assignment is read: `slots` keeps every colour and moves it to
   * another filament, `repaint` prints a colour in another filament's colour.
   *
   * The two keep their own maps, so a user can look at the other mode and come
   * back.  The open download belongs to the old mode, so it is dropped with the
   * revision bump -- an export still writing is discarded when it answers.
   */
  setAssignmentMode(mode) {
    const next = normaliseMode(mode);
    if (next === this.assignmentMode) return false;
    this.assignmentMode = next;
    this.invalidate();
    if (this.hooks.mode) this.hooks.mode(this.assignmentMode);
    if (this.hooks.rule) this.hooks.rule(this.rule);
    return true;
  }

  setStatus(text) {
    if (this.hooks.status) this.hooks.status(text || "");
  }

  /**
   * The page's thumbnail renderer: `(snapshot) => Promise<{main, small}|null>`.
   *
   * It is asked for a *fresh* output thumbnail on every save — not the picture
   * the preview happens to be showing — and its reply is only used while the
   * file, the assignment and the target are all still the snapshot's.
   */
  setThumbnailer(render) {
    this.renderThumbnail = render;
  }

  disposeWorker(reason) {
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    // Terminate *and* reject: a reply already queued on the main thread must not
    // resolve into a page that has moved on.
    if (worker.dispose) worker.dispose(reason);
    else if (worker.terminate) worker.terminate();
  }

  /** Forget the current download: its bytes belong to a state that has changed. */
  dropOutput() {
    if (!this.output) return;
    const { url } = this.output;
    this.output = null;
    try {
      this.urls.revoke(url);
    } catch (error) {
      // A revoked or never-created URL is not worth failing an edit over.
    }
    if (this.hooks.output) this.hooks.output(null);
  }

  invalidate() {
    this.revision += 1;
    this.dropOutput();
  }

  setTarget(target) {
    if (this.target === target) return false;
    if (!["snapmaker", "bambu", "orca", "prusa"].includes(target)) return false;
    if (this.target !== "snapmaker") {
      this.genericArea = { width: this.layout.width, depth: this.layout.depth };
    }
    this.target = target;
    if (target !== "snapmaker" && this.state && Object.values(this.rules[SLOTS]).some(id => !this.activeColourIds().includes(id))) {
      this.rules[SLOTS] = identityRule(this.state.colours.length);
    }
    this.layout = targetLayout(target, { ...this.layout, ...this.genericArea });
    if (target === "snapmaker" && /^(width|depth) /.test(this.layoutProblem || "")) {
      this.layoutProblem = "";
    }
    this.invalidate();
    if (this.hooks.layout) this.hooks.layout(this.layout);
    if (this.hooks.rule) this.hooks.rule(this.rule);
    return true;
  }

  /** Change one layout setting.  Any change invalidates the previous download.
   *
   * An invalid value is *recorded*, not silently ignored: the page shows the
   * reason and the export stays blocked, so a stale good value can never be
   * exported while the box on screen is wrong. */
  setLayout(patch = {}) {
    const hadProblem = Boolean(this.layoutProblem);
    const next = { ...this.layout };
    if (patch.copies !== undefined) {
      const copies = Number(patch.copies);
      if (!Number.isInteger(copies) || copies < 1) {
        this.layoutProblem = "copies must be a whole number of one or more";
        this.invalidate();
        if (this.hooks.layout) this.hooks.layout(this.layout);
        return false;
      }
      if (copies > 4096) {
        this.layoutProblem = "that is more copies than this tool will write";
        this.invalidate();
        if (this.hooks.layout) this.hooks.layout(this.layout);
        return false;
      }
      next.copies = copies;
    }
    if (patch.spacing !== undefined) {
      const spacing = Number(patch.spacing);
      if (!Number.isFinite(spacing) || spacing < 0) {
        this.layoutProblem = "spacing must be zero or more millimetres";
        this.invalidate();
        if (this.hooks.layout) this.hooks.layout(this.layout);
        return false;
      }
      next.spacing = spacing;
    }
    for (const key of ["width", "depth"]) {
      if (this.target === "snapmaker") continue;
      if (patch[key] === undefined) continue;
      const value = Number(patch[key]);
      if (!Number.isFinite(value) || value <= 0 || value > 10000) {
        this.layoutProblem = `${key} must be a positive size in millimetres`;
        this.invalidate();
        if (this.hooks.layout) this.hooks.layout(this.layout);
        return false;
      }
      next[key] = value;
    }
    if (patch.tower !== undefined) next.tower = Boolean(patch.tower);
    this.layoutProblem = "";
    const changed = JSON.stringify(next) !== JSON.stringify(this.layout);
    this.layout = targetLayout(this.target, next);
    // The user has opinions now: a later file must not overwrite the box size.
    if (this.target !== "snapmaker" && changed
        && ["width", "depth"].some((key) => patch[key] !== undefined)) {
      this.layoutEdited = true;
      this.genericArea = { width: this.layout.width, depth: this.layout.depth };
    }
    if (!changed) {
      // Restoring the value that is already in force is a recovery: clear the
      // problem and let the page recompute eligibility.
      if (hadProblem) {
        this.layoutProblem = "";
        if (this.hooks.layout) this.hooks.layout(this.layout);
        return true;
      }
      return false;
    }
    this.layoutProblem = "";
    this.invalidate();
    if (this.hooks.layout) this.hooks.layout(this.layout);
    return true;
  }

  /** Refresh the selection's bounds after a plate change. */
  async refreshBounds() {
    if (!this.state || !this.worker || !this.worker.bounds) return null;
    const seq = (this.boundsSeq = (this.boundsSeq || 0) + 1);
    const token = this.epoch;
    const plate = this.state.plateId;
    this.boundsPending = true;
    if (this.hooks.bounds) this.hooks.bounds(true);
    try {
      const reply = await this.worker.bounds(plate, null);
      const bounds = reply && reply.bounds !== undefined ? reply.bounds : reply;
      const painted = reply && reply.supportsPainted !== undefined
        ? Boolean(reply.supportsPainted) : null;
      // Only the newest request for this file and this plate may install bounds.
      if (token !== this.epoch || seq !== this.boundsSeq
          || plate !== this.state.plateId) return null;
      this.state.bounds = bounds || null;
      // Supports follow the selection, so the plate that is in force now decides
      // what the support control says; a stale flag would describe the old plate.
      if (painted !== null) this.state.supportsPainted = painted;
      if (bounds && !bounds.size) bounds.size = bounds.max.map((n, i) => n - bounds.min[i]);
      this.boundsPending = false;
      if (this.hooks.bounds) this.hooks.bounds(false);
      if (this.hooks.settings) this.hooks.settings();
      if (this.hooks.rule) this.hooks.rule(this.rule);
      return bounds;
    } catch (error) {
      if (token === this.epoch && seq === this.boundsSeq) {
        this.state.bounds = null;
        this.boundsPending = false;
        if (this.hooks.bounds) this.hooks.bounds(false);
      }
      return null;
    }
  }

  /** Opt in (or out) of carrying the source's layer height and support intent. */
  setPreserveSourceSettings(value) {
    const next = Boolean(value);
    if (next === this.preserveSourceSettings) return false;
    this.preserveSourceSettings = next;
    this.invalidate();
    if (this.hooks.settings) this.hooks.settings(this.preserveSourceSettings);
    return true;
  }

  /** Opt in (or out) of carrying the source's compatible print settings onto a U1
   *  project.  The old download no longer describes the file that would be
   *  written, so it is dropped with the revision bump. */
  setCarrySettings(value) {
    const next = Boolean(value);
    if (next === this.carrySettings) return false;
    this.carrySettings = next;
    this.invalidate();
    if (this.hooks.settings) this.hooks.settings();
    return true;
  }

  /** Choose which support decision a U1 export writes: "auto" (the source's own),
   *  "on" (the U1 profile's defaults) or "off". */
  setFilamentProfile(index, profile) {
    this.filamentProfiles[index]=profile; this.invalidate(); this.hooks.settings?.();
  }
  setU1Nozzle(value) {
    if (!['auto','0.2','0.4','0.6','0.8'].includes(value) || value===this.u1Nozzle) return false;
    this.u1Nozzle=value; this.invalidate(); this.hooks.settings?.(); return true;
  }

  setSupportMode(mode) {
    const next = ["auto", "on", "off"].includes(mode) ? mode : "auto";
    if (next === this.supportMode) return false;
    this.supportMode = next;
    this.invalidate();
    if (this.hooks.settings) this.hooks.settings();
    return true;
  }

  /** Read a new file.  Every older load, export and download is abandoned first. */
  async load(file) {
    const token = (this.epoch += 1);
    this.revision += 1;
    // A new file cancels any export still writing: bump the sequence so its
    // `finally` cannot keep the lock, and clear it here instead.
    this.convertSeq += 1;
    this.busy = false;
    this.disposeWorker("a new file was chosen, so the old worker was stopped");
    this.dropOutput();
    this.state = null;
    this.boundsPending = false;
    this.boundsSeq = (this.boundsSeq || 0) + 1;
    // A new file starts in the homepage's own mode, with both maps cleared: an
    // assignment made for the file that was just replaced means nothing here.
    this.assignmentMode = SLOTS;
    this.rules = { [SLOTS]: {}, [REPAINT]: {} };
    this.setStatus(`Reading ${file.name}…`);
    if (this.hooks.cleared) this.hooks.cleared();
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (token === this.epoch) {
        this.setStatus(`That file could not be read: ${error.message}`);
      }
      return null;
    }
    // Checked *after* the disk read too: a newer file may have been chosen while
    // this one was still coming off disk, in which case the worker is never made.
    if (token !== this.epoch) return null;
    const worker = this.makeWorker();
    this.worker = worker;
    try {
      const reply = await worker.load(bytes.buffer, { light: true }, (progress) => {
        if (token !== this.epoch) return;
        this.setStatus(`${progress.stage === "parse" ? "Reading the model"
          : progress.stage === "zip" ? "Unpacking the file" : "Working"}… `
          + `${(progress.ms / 1000).toFixed(1)}s`);
        if (this.hooks.progress) this.hooks.progress(progress);
      });
      if (token !== this.epoch) return null;      // replaced while parsing
      this.state = {
        kind: reply.meta.kind,
        title: reply.meta.title && !/^(model|untitled|u1 project)$/i.test(reply.meta.title.trim())
          ? reply.meta.title : String(file.name || "model").replace(/\.3mf$/i, ""),
        colours: reply.meta.colors.slice(),
        filamentUsage: reply.meta.filamentUsage || null,
        includeUnused: [],
        types: reply.meta.types.slice(),
        warnings: (reply.meta.warnings || []).slice(),
        negativeVolumes: Boolean(reply.meta.negativeVolumes),
        customLayerActions: Boolean(reply.meta.customLayerActions),
        mixtures: (reply.summary && reply.summary.mixtures) || [],
        plates: reply.meta.plates.map((entry) => ({ id: entry.id, name: entry.name })),
        plateId: reply.meta.plates.length ? reply.meta.plates[0].id : null,
        coloursUsed: reply.summary ? (reply.summary.triangles || 0) : 0,
        bounds: (reply.summary && reply.summary.bounds) || null,
        plateSize: (reply.summary && reply.summary.plateSize) || null,
        // Whether the geometry carries painted support enforcers: the support
        // control's note needs it, and it is a property of the selection.
        supportsPainted: Boolean(reply.summary && reply.summary.supportsPainted),
        filename: file.name || "",
        sourceSettings: reply.meta.sourceSettings || null,
        filamentProfiles:reply.meta.filamentProfiles || [],
        objectSettings: reply.meta.objectSettings || [],
        summary: reply.summary || null,
      };
      const count = this.state.colours.length;
      this.rules = { [SLOTS]: identityRule(count), [REPAINT]: identityRule(count) };
      // A fresh file starts from a single copy. Keep the user's generic planning
      // area separately so it can never replace the U1 destination bed.
      this.layout = { ...this.layout, copies: 1, tower: true };
      // A source plate size is used only when the file really states one and the
      // user has not set their own box; otherwise the editable planning area stays.
      const plate = reply.summary && reply.summary.plateSize;
      if (plate && !this.layoutEdited
          && Number.isFinite(plate[0]) && Number.isFinite(plate[1])) {
        this.genericArea = { width: Math.max(1, Math.ceil(plate[0])),
                             depth: Math.max(1, Math.ceil(plate[1])) };
      }
      this.layout = targetLayout(this.target, { ...this.layout, ...this.genericArea });
      // A new file starts with compatible designer settings selected.
      this.preserveSourceSettings = true;
      // The U1 controls start at the converter's own defaults for the same reason:
      // a new file is converted the way the tool does it out of the box, and the
      // page shows those values rather than an inherited override.
      this.carrySettings = true;
      this.supportMode = "auto";
    this.u1Nozzle = "auto";
    this.filamentProfiles = [];
      this.layoutProblem = "";
      if (this.hooks.loaded) this.hooks.loaded(this.state);
      if (this.hooks.layout) this.hooks.layout(this.layout);
      return this.state;
    } catch (error) {
      if (token !== this.epoch) return null;
      this.setStatus(`That file could not be read: ${error.message}`);
      if (this.hooks.error) this.hooks.error(error.message);
      return null;
    } finally {
      if (token === this.epoch && this.hooks.settled) this.hooks.settled();
    }
  }

  setPlate(plateId) {
    if (!this.state) return false;
    const found = this.state.plates.find((entry) => Number(entry.id) === Number(plateId));
    if (!found) return false;
    if (Number(this.state.plateId) === Number(found.id)) return false;
    this.state.plateId = found.id;
    this.invalidate();
    if (this.hooks.rule) this.hooks.rule(this.rule);
    return true;
  }

  /**
   * Send one source colour to a destination filament.
   *
   * In slots mode the map stays a bijection: if that filament is already taken,
   * the colour sitting in it moves back to the slot this source is leaving, so
   * every colour is still written exactly once and none is lost.  In repaint mode
   * the destination is simply taken, and the colour already there is overwritten
   * (two sources may share one filament).
   */
  setSource(source, destination) {
    const from = Number(source);
    const to = Number(destination);
    const rule = this.rule;
    if (!this.state || !(from in rule)) return false;
    if (!this.activeColourIds().includes(from) || !this.destinationIds().includes(to)) return false;
    if (rule[from] === to) return false;
    if (this.assignmentMode === SLOTS) {
      const displaced = Object.keys(rule).map(Number)
        .find((other) => other !== from && rule[other] === to);
      if (displaced !== undefined) rule[displaced] = rule[from];
    }
    rule[from] = to;
    this.invalidate();
    if (this.hooks.rule) this.hooks.rule(rule);
    return true;
  }

  /** Exchange two source colours' destinations *simultaneously*. */
  swap(left, right) {
    const a = Number(left);
    const b = Number(right);
    if (!this.state || a === b) return false;
    const rule = this.rule;
    if (!(a in rule) || !(b in rule)) return false;
    const first = rule[a];
    const second = rule[b];
    rule[a] = second;
    rule[b] = first;
    this.invalidate();
    if (this.hooks.rule) this.hooks.rule(rule);
    return true;
  }

  /** Put the *active* mode's assignment back to identity; the other mode's map
   *  is left alone, because it belongs to a mode the user is not looking at. */
  reset() {
    if (!this.state) return false;
    this.rules[this.assignmentMode] = identityRule(this.state.colours.length);
    this.invalidate();
    if (this.hooks.rule) this.hooks.rule(this.rule);
    return true;
  }

  /** The sources whose destination is not their own filament, in order. */
  changes() {
    return Object.keys(this.rule).map(Number).sort((a, b) => a - b)
      .filter((source) => this.activeColourIds().includes(source) && this.rule[source] !== source)
      .map((source) => ({ source, destination: this.rule[source] }));
  }

  /** Write the loaded project to the chosen target, or drop the reply as stale. */
  async convert(target, plateId) {
    if (!this.state || this.busy || this.closed || this.layoutProblem || this.boundsPending) return null;
    this.setTarget(String(target));
    if (this.state.bounds && planLayout(this.state.bounds, this.planningLayout()).blocked) return null;
    const snapshot = {
      revision: this.revision,
      token: this.epoch,
      worker: this.worker,
      target: String(target),
      plateId: plateId === undefined || plateId === null
        ? this.state.plateId : plateId,
      mapping: { ...this.rule },
      // The mode is part of the snapshot: a mode switch while this export is
      // writing must not let it publish, and the page's thumbnail has to be
      // drawn with the palette *this* mode writes.
      assignmentMode: this.assignmentMode,
      includeUnused: this.state.includeUnused.slice(),
      layout: this.planningLayout(),
      preserveSourceSettings: this.preserveSourceSettings,
      carrySettings: this.carrySettings,
      supportMode: this.supportMode,
      u1Nozzle: this.u1Nozzle,
      filamentProfiles: structuredClone(this.filamentProfiles),
      title: this.state.title,
      colours: this.state.colours.slice(),
    };
    if (!snapshot.worker) return null;
    const seq = (this.convertSeq += 1);
    snapshot.seq = seq;
    this.busy = true;
    if (this.hooks.busy) this.hooks.busy(true);
    try {
      // The thumbnail first, then the archive with it inside: a save must never
      // claim a picture it does not carry.
      let thumbnails = null;
      if (this.renderThumbnail) {
        thumbnails = await this.renderThumbnail({
          worker: snapshot.worker, plateId: snapshot.plateId,
          target: snapshot.target, mapping: snapshot.mapping,
          assignmentMode: snapshot.assignmentMode,
          colours: snapshot.colours, layout: snapshot.layout,
        });
        if (snapshot.token !== this.epoch || snapshot.revision !== this.revision
            || snapshot.seq !== this.convertSeq) return null;   // replaced meanwhile
        if (!thumbnails || !thumbnails.main) {
          throw new Error("the output thumbnail could not be rendered, so this file "
            + "was not saved without one");
        }
      }
      const built = await snapshot.worker.convert(snapshot.plateId, null,
                                                  snapshot.target, snapshot.mapping,
                                                  snapshot.title,
                                                  { thumbnails,
                                                    removeUnused: true,
                                                    includeUnused: snapshot.includeUnused,
                                                    layout: snapshot.layout,
                                                    preserveSourceSettings:
                                                      snapshot.preserveSourceSettings,
                                                    u1Nozzle: snapshot.u1Nozzle,
                                                    filamentProfiles: snapshot.filamentProfiles,
                                                    carrySettings:
                                                      snapshot.carrySettings,
                                                    supportMode:
                                                      snapshot.supportMode,
                                                    assignmentMode:
                                                      snapshot.assignmentMode });
      if (snapshot.token !== this.epoch || snapshot.revision !== this.revision) return null;
      const bytes = built.bytes instanceof Uint8Array ? built.bytes
        : new Uint8Array(built.bytes);
      const blob = new Blob([bytes], { type: TYPED_3MF });
      const entry = {
        url: this.urls.create(blob),
        name: `${safeName(snapshot.title)}-${snapshot.target}.3mf`,
        target: snapshot.target,
        plateId: snapshot.plateId,
        mapping: snapshot.mapping,
        assignmentMode: snapshot.assignmentMode,
        colours: built.colours || snapshot.colours,
        bytes: bytes.length,
        ms: built.ms || 0,
        // What the export really did with the source's print intent: the page
        // reports it instead of claiming "your settings came across".
        settings: built.settings || null,
      };
      this.dropOutput();
      this.output = entry;
      if (this.hooks.output) this.hooks.output(entry);
      return entry;
    } catch (error) {
      if (snapshot.token === this.epoch && snapshot.revision === this.revision
          && this.hooks.error) {
        this.hooks.error(error.message || String(error));
      }
      return null;
    } finally {
      // Only the newest export may clear the lock: an obsolete one finishing
      // later must not re-open the button while its replacement is still writing.
      if (snapshot.seq === this.convertSeq) {
        this.busy = false;
        if (this.hooks.busy) this.hooks.busy(false);
      }
    }
  }

  close() {
    this.closed = true;
    this.epoch += 1;
    this.disposeWorker("the page is going away");
    this.dropOutput();
    this.state = null;
  }
}
