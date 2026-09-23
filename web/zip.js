// zip.js -- just enough ZIP to read and write a 3MF, with no dependencies.
//
// 3MF files are ordinary ZIPs. Browsers can inflate and deflate raw streams
// natively (DecompressionStream / CompressionStream), so the only thing missing
// is the container: local headers, the central directory and the end record.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// A decompression bomb is cheap to write and expensive to read, so every limit
// is checked before and after inflating: the size in the header is a claim, not
// a fact.  These are what a real sliced 3MF needs (the alien model is 18 MB
// compressed and ~150 MB expanded) with headroom to spare.
export const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
export const MAX_MEMBER_BYTES = 256 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_MEMBERS = 5000;

let CRC_TABLE = null;

function crcTable() {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  return CRC_TABLE;
}

export function crc32(bytes) {
  const table = crcTable();
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunkStream(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function inflateRaw(bytes) {
  const stream = chunkStream(bytes).pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate, refusing to buffer past `limit` however small the input claims to be. */
export async function inflateRawBounded(bytes, limit = MAX_MEMBER_BYTES) {
  const stream = chunkStream(bytes).pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`a member expands to more than ${Math.round(limit / 1048576)} MB; `
        + "this reader stops there");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export async function deflateRaw(bytes) {
  const stream = chunkStream(bytes).pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEOCD(u8) {
  const floor = Math.max(0, u8.length - 66000);
  for (let i = u8.length - 22; i >= floor; i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

/** Read every member as { name -> Uint8Array }. */
export async function readZip(u8) {
  if (u8.length < 22 || u8[0] !== 0x50 || u8[1] !== 0x4b) {
    throw new Error("not a ZIP/3MF archive");
  }
  if (u8.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`this archive is ${(u8.length / 1048576).toFixed(0)} MB; this `
      + `reader stops at ${MAX_ARCHIVE_BYTES / 1048576} MB`);
  }
  const eocd = findEOCD(u8);
  if (eocd < 0) throw new Error("no ZIP end-of-central-directory record found");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    throw new Error("ZIP64 archives are not supported");
  }
  if (count > MAX_MEMBERS) {
    throw new Error(`this archive lists ${count} members; this reader stops at `
      + MAX_MEMBERS);
  }

  const decoder = new TextDecoder("utf-8");
  const out = new Map();
  let expanded = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const rawSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localAt = dv.getUint32(p + 42, true);
    const name = decoder.decode(u8.subarray(p + 46, p + 46 + nameLen));

    if (out.has(name)) {
      // Two members with one name would let the second silently replace the
      // first, which is how a "harmless" zip hides different geometry.
      throw new Error(`damaged archive: ${name} is stored more than once`);
    }
    // the local header carries its own name/extra lengths, and they can differ
    if (dv.getUint32(localAt, true) !== SIG_LOCAL) {
      throw new Error(`damaged archive: bad local header for ${name}`);
    }
    // Checked before inflating: rawSize is the archive's own claim, so it also
    // has to be re-checked afterwards.
    if (rawSize > MAX_MEMBER_BYTES) {
      throw new Error(`${name} claims to expand to `
        + `${(rawSize / 1048576).toFixed(0)} MB; this reader stops at `
        + `${MAX_MEMBER_BYTES / 1048576} MB`);
    }
    if (expanded + rawSize > MAX_TOTAL_BYTES) {
      throw new Error(`this archive expands to more than `
        + `${MAX_TOTAL_BYTES / 1048576} MB; this reader stops there`);
    }
    const lNameLen = dv.getUint16(localAt + 26, true);
    const lExtraLen = dv.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const body = u8.subarray(dataAt, dataAt + compSize);

    let data;
    if (method === 0) {
      if (body.length > MAX_MEMBER_BYTES) {
        throw new Error(`${name} is larger than this reader will hold`);
      }
      data = body.slice();
    } else if (method === 8) {
      data = await inflateRawBounded(body, MAX_MEMBER_BYTES);
    } else {
      throw new Error(`unsupported compression method ${method} for ${name}`);
    }
    if (rawSize && data.length !== rawSize) {
      throw new Error(`size mismatch reading ${name}`);
    }
    expanded += data.length;
    if (expanded > MAX_TOTAL_BYTES) {
      throw new Error(`this archive expands to more than `
        + `${MAX_TOTAL_BYTES / 1048576} MB; this reader stops there`);
    }
    const expected = dv.getUint32(p + 16, true);
    if (crc32(data) !== expected) {
      throw new Error(`${name} is damaged (its checksum does not match)`);
    }
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (out.size === 0) throw new Error("archive contains no files");
  return out;
}

/**
 * Write members back out. `items` is an array of { name, data } so the caller
 * controls the order, which keeps the output comparable to the desktop tool's.
 */
export async function writeZip(items, { compress = true } = {}) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2) & 31);
  const dosDate =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts = [];
  const central = [];
  let offset = 0;

  for (const item of items) {
    const nameBytes = encoder.encode(item.name);
    const data = item.data;
    const stored = !compress || item.store === true;
    const payload = stored ? data : await deflateRaw(data);
    const crc = crc32(data);

    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, SIG_LOCAL, true);
    hv.setUint16(4, 20, true);          // version needed
    hv.setUint16(6, 0x0800, true);      // names are UTF-8
    hv.setUint16(8, stored ? 0 : 8, true);
    hv.setUint16(10, dosTime, true);
    hv.setUint16(12, dosDate, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, payload.length, true);
    hv.setUint32(22, data.length, true);
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    parts.push(header, payload);
    central.push({ nameBytes, crc, comp: payload.length, raw: data.length,
                   offset, stored, dosTime, dosDate });
    offset += header.length + payload.length;
  }

  const cdStart = offset;
  for (const e of central) {
    const entry = new Uint8Array(46 + e.nameBytes.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, SIG_CENTRAL, true);
    ev.setUint16(4, 20, true);          // version made by
    ev.setUint16(6, 20, true);          // version needed
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, e.stored ? 0 : 8, true);
    ev.setUint16(12, e.dosTime, true);
    ev.setUint16(14, e.dosDate, true);
    ev.setUint32(16, e.crc, true);
    ev.setUint32(20, e.comp, true);
    ev.setUint32(24, e.raw, true);
    ev.setUint16(28, e.nameBytes.length, true);
    ev.setUint16(30, 0, true);          // extra
    ev.setUint16(32, 0, true);          // comment
    ev.setUint16(34, 0, true);          // disk
    ev.setUint16(36, 0, true);          // internal attrs
    ev.setUint32(38, 0, true);          // external attrs
    ev.setUint32(42, e.offset, true);
    entry.set(e.nameBytes, 46);
    parts.push(entry);
    offset += entry.length;
  }

  const eocd = new Uint8Array(22);
  const xv = new DataView(eocd.buffer);
  xv.setUint32(0, SIG_EOCD, true);
  xv.setUint16(8, central.length, true);
  xv.setUint16(10, central.length, true);
  xv.setUint32(12, offset - cdStart, true);
  xv.setUint32(16, cdStart, true);
  parts.push(eocd);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
