// Reads an exported 3MF for the model-aware toolpath check (built-in colours spike,
// Task 12): the mesh in bed coordinates with each triangle's reel, streamed member by
// member so that a model member larger than readZip will hold (They Live's is 571 MB)
// can still be read; and an upward sweep over its triangles. Node only.
import {readFileSync} from 'node:fs';
import {createInflateRaw, crc32} from 'node:zlib';
import {readZip} from '../web/zip.js';
import {applyMatrix} from '../web/shared/project.js';
import * as paint from '../web/shared/paint.js';
import {placements} from './builtInToolpathCheck.mjs';

const PAINT_RE = /\s(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"/;
const attr = (text, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(text)?.[1];

/** Grows a typed array as values are pushed. */
function growing(Type, size = 1 << 16) {
  let data = new Type(size), length = 0;
  return {
    push(...values) {
      if (length + values.length > data.length) { const next = new Type(Math.max(data.length * 2, length + values.length)); next.set(data); data = next; }
      for (const v of values) data[length++] = v;
    },
    get length() { return length; },
    done() { return data.subarray(0, length); },
  };
}

/** The archive's members with where their compressed data starts (ZIP central directory). */
function zipMembers(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Error('no ZIP end-of-central-directory record found');
  const out = [];
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0, n = dv.getUint16(eocd + 10, true); i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw Error('damaged ZIP central directory');
    const nameLen = dv.getUint16(p + 28, true), local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const dataAt = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    out.push({name, method: dv.getUint16(p + 10, true), crc: dv.getUint32(p + 16, true), compSize: dv.getUint32(p + 20, true), rawSize: dv.getUint32(p + 24, true), dataAt});
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}

/** Inflates one member as text chunks that each end at a '>' (so no tag is split), checking its CRC. */
async function* memberText(u8, m) {
  const body = u8.subarray(m.dataAt, m.dataAt + m.compSize);
  const decoder = new TextDecoder();
  let carry = '', crc = 0, size = 0;
  const chunks = m.method === 0 ? [body] : (() => { const z = createInflateRaw({chunkSize: 1 << 20}); z.end(body); return z; })();
  if (m.method !== 0 && m.method !== 8) throw Error(`unsupported compression method ${m.method} for ${m.name}`);
  for await (const chunk of chunks) {
    crc = crc32(chunk, crc); size += chunk.length;
    const text = carry + decoder.decode(chunk, {stream: true}), cut = text.lastIndexOf('>') + 1;
    carry = text.slice(cut);
    if (cut) yield text.slice(0, cut);
  }
  if (crc >>> 0 !== m.crc || size !== m.rawSize) throw Error(`${m.name} is damaged (size or checksum does not match)`);
  if ((carry + decoder.decode()).trim()) throw Error(`${m.name} ends inside a tag`);
}

/** Per build object: its extruder and its parts' extruder and subtype, from model_settings.config. */
function readSettings(text) {
  const objects = new Map();
  for (const o of text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const parts = new Map();
    const own = o[2].replace(/<part\b[\s\S]*?<\/part>/g, '');
    for (const p of o[2].matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g))
      parts.set(attr(p[1], 'id'), {subtype: attr(p[1], 'subtype') || 'normal_part', extruder: Number(/key="extruder" value="(\d+)"/.exec(p[2])?.[1]) || null});
    objects.set(attr(o[1], 'id'), {extruder: Number(/key="extruder" value="(\d+)"/.exec(own)?.[1]) || null, parts});
  }
  return objects;
}

/**
 * The exported model in bed coordinates: flat vertices, triangle corners, the reel of each
 * triangle (its paint leaf, or its part's extruder when unpainted or state 0; 0 when a
 * split paints several reels), and its part. Each build item is dropped so that its lowest
 * printed point is at z = 0, as the slicer places it.
 */
export async function loadModel(path, offset = [0, 0, 0]) {
  const u8 = readFileSync(path);
  const small = await readZip(u8, {include: n => n === '3D/3dmodel.model' || n === 'Metadata/model_settings.config'});
  const where = placements(small);
  const settings = small.has('Metadata/model_settings.config') ? readSettings(new TextDecoder().decode(small.get('Metadata/model_settings.config'))) : new Map();
  const V = growing(Float64Array, 1 << 20), T = growing(Int32Array, 1 << 20), R = growing(Uint8Array, 1 << 20), P = growing(Uint16Array, 1 << 20);
  const parts = [], stats = {triangles: 0, painted: 0, unpainted: 0, stateZero: 0, splitSameReel: 0, splitMixedReel: 0, skippedParts: [], reelTriangles: {}};
  const cache = new Map();
  const reelOf = (hex, fallback) => {
    let r = cache.get(hex);
    if (r === undefined) {
      const node = paint.decode(hex), states = new Set(paint.walkStates(node));
      r = node.kind === 'leaf' ? node.state : states.size === 1 ? -[...states][0] : -1000;
      cache.set(hex, r);
    }
    if (r === -1000) { stats.splitMixedReel += 1; return 0; }
    if (r < 0) { stats.splitSameReel += 1; r = -r; }
    if (r === 0) { stats.stateZero += 1; return fallback; }
    return r;
  };
  const TAG = /<(object|vertex|triangle)\b([^>]*?)\/?>|<\/object>/g;
  for (const m of zipMembers(u8).filter(m => /^3D\/.*\.model$/i.test(m.name))) {
    let cur = null;
    for await (const text of memberText(u8, m)) {
      for (const t of text.matchAll(TAG)) {
        if (t[1] === 'vertex') {
          if (!cur) continue;
          const a = t[2], p = applyMatrix(cur.place.m, [Number(attr(a, 'x')), Number(attr(a, 'y')), Number(attr(a, 'z'))]);
          V.push(p[0] + offset[0], p[1] + offset[1], p[2]);
        } else if (t[1] === 'triangle') {
          if (!cur) continue;
          const a = t[2], found = PAINT_RE.exec(a);
          // A mirroring placement (determinant < 0) turns the winding inside out; swap two
          // corners so that the triangle still faces outwards in bed coordinates.
          if (cur.mirrored) T.push(cur.base + Number(attr(a, 'v1')), cur.base + Number(attr(a, 'v3')), cur.base + Number(attr(a, 'v2')));
          else T.push(cur.base + Number(attr(a, 'v1')), cur.base + Number(attr(a, 'v2')), cur.base + Number(attr(a, 'v3')));
          let reel;
          if (found && found[1]) { stats.painted += 1; reel = reelOf(found[1], cur.extruder); } else { stats.unpainted += 1; reel = cur.extruder; }
          R.push(reel); P.push(cur.index);
          stats.reelTriangles[reel] = (stats.reelTriangles[reel] || 0) + 1;
        } else if (t[1] === 'object') {
          const id = attr(t[2], 'id'), place = where.get(`${m.name}#${id}`);
          cur = null;
          if (!place) continue;
          const object = settings.get(place.object), part = object?.parts.get(id) ?? (place.object === id ? {subtype: 'normal_part', extruder: object?.extruder} : null);
          const subtype = part?.subtype || 'normal_part';
          if (subtype !== 'normal_part' && subtype !== 'negative_part') { stats.skippedParts.push({member: m.name, id, subtype}); continue; }
          const info = {member: m.name, id, item: place.item, subtype, negative: subtype === 'negative_part', extruder: part?.extruder || object?.extruder || 1,
            vertexStart: V.length / 3, triangleStart: T.length / 3};
          parts.push(info);
          const M = place.m;
          info.mirrored = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]) < 0;
          cur = {place, base: info.vertexStart, index: parts.length - 1, extruder: info.extruder, mirrored: info.mirrored};
        } else cur = null;                                                  // </object>
      }
    }
  }
  const vertices = V.done(), tri = T.done(), reel = R.done(), part = P.done();
  stats.triangles = reel.length;
  // Drop each build item onto the bed: its lowest point of a printed (not negative) part goes to z = 0.
  // tools/built-in-colours-spike.mjs bands by painted meshes only; the two agree when every
  // printed part is painted (true of the spike's files after applyDualWall).
  const itemMin = new Map();
  parts.forEach((p, i) => {
    p.vertexEnd = i + 1 < parts.length ? parts[i + 1].vertexStart : vertices.length / 3;
    if (p.negative) return;
    let lo = itemMin.get(p.item) ?? Infinity;
    for (let v = p.vertexStart; v < p.vertexEnd; v++) lo = Math.min(lo, vertices[3 * v + 2]);
    itemMin.set(p.item, lo);
  });
  // The z offset (investigation only) is applied after the drop, so it really moves the model off the bed.
  for (const p of parts) { const lo = itemMin.get(p.item) ?? 0; p.droppedBy = lo; for (let v = p.vertexStart; v < p.vertexEnd; v++) vertices[3 * v + 2] += offset[2] - lo; }
  return {vertices, tri, reel, part, parts, stats, itemMinWorldZ: Object.fromEntries(itemMin)};
}

/** Triangles in order of their lowest corner, for one upward sweep. */
export function sweeper(model, bin = 0.05) {
  const {vertices: V, tri: T} = model, n = T.length / 3;
  const zmin = new Float64Array(n), zmax = new Float64Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const a = V[3 * T[3 * i] + 2], b = V[3 * T[3 * i + 1] + 2], c = V[3 * T[3 * i + 2] + 2];
    zmin[i] = Math.min(a, b, c); zmax[i] = Math.max(a, b, c); top = Math.max(top, zmax[i]);
  }
  const binOf = z => Math.max(0, Math.min(bins - 1, Math.floor(z / bin)));
  const bins = Math.max(1, Math.ceil(top / bin) + 1), start = new Uint32Array(bins + 1);
  for (let i = 0; i < n; i++) start[binOf(zmin[i]) + 1] += 1;
  for (let k = 0; k < bins; k++) start[k + 1] += start[k];
  const fill = start.slice(0, bins), order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[fill[binOf(zmin[i])]++] = i;
  let next = 0, active = [], last = -Infinity;
  return {
    /** The triangles that may cross height z; heights must not go down. */
    at(z) {
      if (z < last) throw Error(`layer heights go down (${last} then ${z}); the sweep needs them in order`);
      last = z;
      const upto = binOf(z) + 1;
      while (next < n && binOf(zmin[order[next]]) < upto) active.push(order[next++]);
      active = active.filter(i => zmax[i] > z);
      return active;
    },
  };
}
