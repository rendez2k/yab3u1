// The recolour page's heavy work, off the UI thread.
//
// Reading the ZIP, parsing the project, assessing a selection, preparing preview
// geometry and writing the export are all whole-XML jobs; on a 1.3M-triangle
// project they take seconds and would freeze the page if they ran on the UI
// thread.  This worker keeps the archive and the parsed project to itself and
// hands back only what the page draws or shows: lightweight metadata once, and
// transferable typed arrays for the geometry.
//
// Same-origin module worker: no CDN, no uploads, nothing leaves the machine.

import { readZip, writeZip } from "../zip.js";
import * as project from "./project.js";
import { cluster, clusterWithinBudget } from "./simplify.js";
import { encodePng } from "./png.js";
import { downscale, renderIso } from "./raster.js";
import { layoutOffsets, planLayout } from "./layout.js";

// Preview detail level, in triangles: a small fixture is drawn verbatim, a big
// model is clustered down to this so the picture stays a recognisable surface
// instead of a scatter of kept triangles.
const PREVIEW_TARGET = 60000;

let loaded = null;            // {entries, project, meta}
let geometry = null;          // {key, positions, states, meta} of the last preview
let geometrySeq = 0;          // identity the page acks with `haveGeometry`

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

function metaOf(parsed) {
  return {
    kind: parsed.kind,
    title: parsed.title || "",
    paletteCount: parsed.paletteCount,
    paletteSource: parsed.paletteSource,
    colors: parsed.colors.slice(),
    types: parsed.types.slice(),
    baseExtruder: parsed.baseExtruder,
    warnings: parsed.warnings.slice(),
    // The narrow slice the optional preservation control may carry; null when the
    // source states nothing.
    sourceSettings: parsed.sourceSettings || null,
    // Per-object intent, for files whose settings live on the objects (our own
    // standard output does this): the opt-in must stay usable on reimport.
    objectSettings: [...parsed.meta.values()]
      .filter((entry) => entry.settings)
      .map((entry) => ({ id: String(entry.id), name: entry.name || "",
                         settings: entry.settings })),
    plates: parsed.plates.map((plate) => ({
      id: plate.id, name: plate.name,
      objectIds: (plate.entries && plate.entries.length
        ? plate.entries.map((entry) => entry.id) : plate.objectIds).slice(),
      entries: (plate.entries || []).map((entry) => ({
        id: entry.id, instanceId: entry.instanceId === undefined ? null
          : entry.instanceId,
      })),
    })),
    objects: [...parsed.objects.values()].map((object) => ({
      id: String(object.id), hasMesh: Boolean(object.hasMesh),
      components: object.components.map((component) => ({
        path: component.path, objectid: component.objectid,
        transform: component.transform,
      })),
    })),
    meta: [...parsed.meta.values()].map((entry) => ({
      id: String(entry.id), name: entry.name || "",
      extruder: entry.extruder === undefined ? null : entry.extruder,
      subtype: entry.subtype || "normal_part",
      parts: (entry.parts || []).map((part) => ({
        id: String(part.id), name: part.name || "",
        extruder: part.extruder === undefined ? null : part.extruder,
        subtype: part.subtype || "normal_part",
        firstid: part.firstid === undefined ? null : part.firstid,
        lastid: part.lastid === undefined ? null : part.lastid,
      })),
    })),
    items: parsed.items.map((item) => ({
      objectid: String(item.objectid), transform: item.transform,
      printable: item.printable !== false,
    })),
  };
}

// ------------------------------------------------------------ simplification --

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255,
                      parseInt(hex.slice(3, 5), 16) / 255,
                      parseInt(hex.slice(5, 7), 16) / 255];

/** Colours for a cached geometry under one palette/mapping: no XML, no parsing. */
function colourFacets(states, colours, mapping) {
  const out = new Float32Array(states.length * 9);
  let at = 0;
  for (let i = 0; i < states.length; i += 1) {
    const state = states[i];
    let channels;
    if (state < 0) {
      channels = [0.69, 0.19, 0.38];
    } else {
      const target = state === 0 ? 1 : (mapping ? (mapping[state] ?? state) : state);
      channels = rgb(colours[target] || "#FFFFFF");
    }
    for (let corner = 0; corner < 3; corner += 1) {
      out[at] = channels[0];
      out[at + 1] = channels[1];
      out[at + 2] = channels[2];
      at += 3;
    }
  }
  return out;
}

/** The soup the page draws: simplified once per selection, recoloured after that.
 *
 * A palette, recipe or Original/Result change reuses the geometry and the facet
 * state list, so it costs one pass over ~60k facets instead of another whole-XML
 * parse.  Only a different plate/object selection re-reads the model.
 */
function preparePreview(plateId, objectIds, mode, colors, mapping, haveGeometry,
                        estimate, layout) {
  const original = mode === "original";
  const current = instanceView(plateId, objectIds,
                               layout ? { ...layout, estimate } : null);
  const had = current.reused;
  // One colour lookup per facet: a palette, recipe, layout or Original/Result
  // change is a pass over the view's facets, never another parse.
  const colours = colourFacets(current.states, colors || {},
                               original ? null : mapping);
  // The page says which geometry it already holds.  Only when that is *this*
  // geometry can the positions be left out; otherwise they are sent (and then
  // the buffer is detached here, which is why this is driven by the page's ack
  // rather than by a "sent once" flag).
  // Sending a *copy* keeps the worker's own geometry intact: a transferred
  // buffer is detached, and a later request (or a request whose reply the page
  // discarded) must still be able to supply the positions again.
  const sendPositions = haveGeometry !== current.id;
  return {
    geometryId: current.id,
    positions: sendPositions ? current.positions.slice() : null,
    colors: colours,
    triangles: current.triangles,
    subdivided: current.subdivided,
    unknown: current.unknown,
    simplified: current.simplified,
    total: current.total,
    full: current.total,
    soup_triangles: current.soupTriangles,
    reused: had,
    prepare_ms: current.ms,
  };
}

/** The simplified surface for one selection, colours computed later by facet.
 *
 * The *whole* selection is streamed into typed arrays: clustering has to start
 * from the real surface, not from something already thrown away.  The result is
 * cached, so a palette change and a thumbnail both reuse one preparation.
 */
function buildGeometry(key, plateId, objectIds, estimate) {
  const started = Date.now();
  const soup = project.previewSoup(loaded.project, plateId, objectIds, {}, null,
                                   Infinity, { full: true, estimate });
  const simple = cluster(soup.positions, soup.colors, soup.states, PREVIEW_TARGET);
  return {
    id: (geometrySeq += 1),
    key,
    positions: floatsOf(simple.positions),
    // The buffer is detached the moment it is transferred, so the count has to
    // be remembered here rather than read back from the array later.
    triangleCount: simple.positions.length / 9,
    states: Int32Array.from(simple.states || []),
    simplified: simple.simplified,
    subdivided: soup.subdivided,
    unknown: soup.unknown,
    total: soup.total,
    soupTriangles: soup.triangles,
    ms: Date.now() - started,
  };
}

/** The cached *single-copy* geometry for a selection.
 *
 * The key deliberately excludes the layout: a spacing or copy change must reuse
 * this, never re-read the model.  Copies are assembled from it by `instanceView`.
 */
function ensureGeometry(plateId, objectIds, estimate) {
  const key = `${plateId}|${(objectIds || []).join(",")}`;
  if (geometry && geometry.key === key) return geometry;
  geometry = buildGeometry(key, plateId, objectIds, estimate);
  geometryBuilds += 1;
  self.__geometryBuilds = geometryBuilds;
  return geometry;
}

let geometryBuilds = 0;
let boundsCache = null;
let viewCache = null;
let detailCache = null;

/** The selection's exact bounds, cached per selection. */
function ensureBounds(plateId, objectIds) {
  const key = `${plateId}|${(objectIds || []).join(",")}`;
  if (boundsCache && boundsCache.key === key) return boundsCache.box;
  const box = project.selectionBounds(loaded.project, plateId, objectIds);
  boundsCache = { key, box };
  return box;
}

/**
 * The per-copy view of the cached geometry: the copies come from the shared
 * layout plan, applied to the *simplified* preview data, so a big copy count can
 * never expand the source mesh before simplification.  Every copy is represented;
 * a facet budget selects a rebuilt surface for each copy.
 */
function instanceView(plateId, objectIds, layout) {
  const base = ensureGeometry(plateId, objectIds, layout && layout.estimate);
  if (!layout) {
    return { id: base.id, positions: base.positions, states: base.states,
             triangles: base.triangleCount, simplified: base.simplified,
             subdivided: base.subdivided, unknown: base.unknown, total: base.total,
             soupTriangles: base.soupTriangles, ms: base.ms, reused: false,
             copies: 1 };
  }
  const bounds = ensureBounds(plateId, objectIds);
  const viewKey = `${base.id}|${layoutKey(layout)}|${JSON.stringify(layout.centre || [0, 0])}`;
  if (viewCache && viewCache.key === viewKey) return { ...viewCache.view, reused: true };
  const plan = planLayout(bounds, layout);
  if (plan.blocked) {
    throw new Error("this model does not fit the layout box, so there is nothing "
      + "to draw");
  }
  const offsets = layoutOffsets(bounds, plan, layout.centre || [0, 0]);
  const budget = 120000;
  const perCopy = Math.max(1, Math.floor(budget / offsets.length));
  const detailKey = `${base.id}|${perCopy}`;
  if (!detailCache || detailCache.key !== detailKey) {
    detailCache = { key: detailKey,
      mesh: clusterWithinBudget(base.positions, base.states, perCopy) };
  }
  const mesh = detailCache.mesh;
  const keep = mesh.positions.length / 9;
  const positions = new Float32Array(keep * offsets.length * 9);
  const states = new Int32Array(keep * offsets.length);
  let at = 0;
  for (const [dx, dy, dz] of offsets) {
    for (let index = 0; index < keep; index += 1) {
      const from = index * 9;
      for (let corner = 0; corner < 3; corner += 1) {
        positions[at * 9 + corner * 3] = mesh.positions[from + corner * 3] + dx;
        positions[at * 9 + corner * 3 + 1] = mesh.positions[from + corner * 3 + 1] + dy;
        positions[at * 9 + corner * 3 + 2] = mesh.positions[from + corner * 3 + 2] + dz;
      }
      states[at] = mesh.states[index];
      at += 1;
    }
  }
  const view = { id: ++geometrySeq, positions: positions.subarray(0, at * 9),
           states: states.subarray(0, at), triangles: at,
           simplified: base.simplified || keep < base.triangleCount, subdivided: base.subdivided,
           unknown: base.unknown, total: base.total,
           soupTriangles: base.soupTriangles, ms: base.ms, reused: true,
           copies: offsets.length, capacity: plan.capacity,
           planCopies: plan.copies };
  viewCache = { key: viewKey, view };
  return view;
}

/** The layout part of a geometry cache key: a spacing edit must not reuse a
 *  picture drawn for a different number of copies. */
function layoutKey(layout) {
  if (!layout) return "single";
  return `${layout.copies}|${layout.spacing}|${layout.width}|${layout.depth}`
    + `|${layout.tower ? 1 : 0}|${JSON.stringify(layout.towerBox || null)}`
    + `|${layout.padding || 0}|${layout.extraHeight || 0}`;
}

function floatsOf(array) {
  return array instanceof Float32Array ? array : Float32Array.from(array);
}

/** Buffers to hand over with a preview: colours always, positions only once. */
function transferOf(preview) {
  const out = [];
  if (preview.positions) out.push(preview.positions.buffer);
  if (preview.colors) out.push(preview.colors.buffer);
  return out;
}

self.onmessage = async (event) => {
  const message = event.data || {};
  const { id, type } = message;
  try {
    if (type === "load") {
      const started = Date.now();
      const entries = await readZip(new Uint8Array(message.bytes));
      post({ type: "progress", id, stage: "zip", ms: Date.now() - started });
      const parsed = project.readProject(entries);
      post({ type: "progress", id, stage: "parse", ms: Date.now() - started });
      loaded = { entries, project: parsed };
      geometry = null;                    // a new file has new geometry
      boundsCache = viewCache = detailCache = null;
      geometryBuilds = self.__geometryBuilds = 0;
      const meta = metaOf(parsed);
      const plateId = parsed.plates.length ? parsed.plates[0].id : null;
      // A pure conversion only needs the shape of the file: the palette, the
      // plates and a triangle count.  It must not pay for the recolour mesh
      // preparation (or the per-facet state scan) it will never draw.
      if (message.light === true) {
        const summary = project.summary(parsed, plateId);
        post({ type: "loaded", id, meta, light: true, summary,
               ms: Date.now() - started });
        return;
      }
      const assessed = project.analyse(parsed, plateId, null);
      // Prepared for the selection the page will actually open with, so the
      // first preview is reused rather than prepared a second time.
      const initial = parsed.plates.length
        ? (parsed.plates[0].objectIds || []).map(String) : [];
      const preview = preparePreview(plateId, initial, "result", {}, null, null, 0);
      post({ type: "loaded", id, meta, assessed, preview, ms: Date.now() - started },
           transferOf(preview));
      return;
    }
    if (!loaded) throw new Error("no project is loaded yet");
    const { project: parsed } = loaded;
    if (type === "prepare-swaps") {
      const { prepareSwapProject } = await import("./swapProject.js");
      const built = prepareSwapProject(parsed, message.plateId, message.objects,
                                       message.thumbnails || null);
      const bytes = await writeZip([...built.entries].map(([name, data]) => ({ name, data })));
      post({ type: "prepared-swaps", id, bytes }, [bytes.buffer]);
      return;
    }
    if (type === "bounds") {
      // The selection's own bounds, for the layout box: measured on the plate the
      // user picked, never a printer bed.  The reply carries the selection's
      // painted support enforcers too: supports follow the *selection*, so a plate
      // switch has to refresh what the page says about them.
      const bounds = project.selectionBounds(parsed, message.plateId, message.objects);
      post({ type: "bounds", id,
             supportsPainted:
               project.supportPaintPresent(parsed, message.plateId, message.objects),
             bounds: Number.isFinite(bounds.min[0])
               ? { min: bounds.min.slice(), max: bounds.max.slice(),
                   size: bounds.max.map((n, i) => n - bounds.min[i]) } : null });
      return;
    }
    if (type === "assess") {
      const assessed = project.analyse(parsed, message.plateId, message.objects);
      post({ type: "assessed", id, assessed });
      return;
    }
    if (type === "preview") {
      const started = Date.now();
      const preview = preparePreview(message.plateId, message.objects, message.mode,
                                     message.colors || {}, message.mapping,
                                     message.haveGeometry, message.estimate,
                                     message.layout || null);
      post({ type: "preview", id, preview, ms: Date.now() - started },
           transferOf(preview));
      return;
    }
    if (type === "thumbnail") {
      // The saved image, rendered here from the cached surface and the *output*
      // colours.  No canvas and no WebGL are involved, so this still works when
      // the interactive preview cannot start.
      const started = Date.now();
      const current = instanceView(message.plateId, message.objects,
                                   message.layout || null);
      const colors = colourFacets(current.states, message.colors || {},
                                  message.mapping);
      const image = renderIso(current.positions, colors,
                              { size: message.size || 512 });
      const main = await encodePng(image.data, image.width, image.height);
      let small = null;
      if (message.small) {
        const scaled = downscale(image, message.small);
        small = await encodePng(scaled.data, scaled.width, scaled.height);
      }
      post({ type: "thumbnail", id, main, small, width: image.width,
             triangles: image.triangles, drawn: image.drawn,
             ms: Date.now() - started },
           small ? [main.buffer, small.buffer] : [main.buffer]);
      return;
    }
    if (type === "export") {
      const started = Date.now();
      const built = project.exportProject(parsed, message.plateId, message.objects,
                                          { ...message.options,
                                            layout: message.options.layout || null });
      if (built.problems.length) {
        post({ type: "error", id, message: built.problems[0] });
        return;
      }
      const bytes = await writeZip([...built.entries].map(([name, data]) =>
        ({ name, data })));
      post({ type: "exported", id, bytes, ms: Date.now() - started,
             recipes: built.recipes.length, thumbnails: built.thumbnails },
           [bytes.buffer]);
      return;
    }
    if (type === "convert") {
      // Portable conversion: identity painting, every source filament definition,
      // no mixtures and no machine settings.
      const started = Date.now();
      const built = project.convertProject(parsed, message.plateId, message.objects,
                                           { target: message.target,
                                             mapping: message.mapping || {},
                                             assignmentMode: message.assignmentMode
                                               || null,
                                             title: message.title,
                                             layout: message.layout || null,
                                             preserveSourceSettings:
                                               message.preserveSourceSettings === true,
                                             carrySettings:
                                               message.carrySettings !== false,
                                             supportMode: message.supportMode || "auto",
                                             thumbnails: message.thumbnails || null });
      if (built.problems.length) {
        post({ type: "error", id, message: built.problems[0] });
        return;
      }
      const bytes = await writeZip([...built.entries].map(([name, data]) =>
        ({ name, data })));
      post({ type: "converted", id, bytes, ms: Date.now() - started,
             thumbnails: built.thumbnails, settings: built.settings || null },
           [bytes.buffer]);
      return;
    }
    throw new Error(`unknown worker request ${type}`);
  } catch (error) {
    post({ type: "error", id, message: error && error.message ? error.message
      : String(error) });
  }
};
