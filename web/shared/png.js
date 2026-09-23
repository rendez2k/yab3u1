// A tiny PNG encoder/reader, with no canvas and no DOM.
//
// Thumbnails have to be produced inside the worker (the rasterising is the
// expensive part) and must not need WebGL or even a 2D context, so the PNG is
// assembled here from raw RGBA: IHDR + one zlib IDAT + IEND.  `CompressionStream`
// does the deflate where it exists; otherwise the stream is written as stored
// zlib blocks, which every reader accepts (bigger, never wrong).

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let value = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC_TABLE[(value ^ bytes[index]) & 0xFF] ^ (value >>> 8);
  }
  return (value ^ 0xFFFFFFFF) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    a = (a + bytes[index]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib (RFC 1950) with stored (uncompressed) deflate blocks. */
function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let at = 0;
  out[at++] = 0x78;
  out[at++] = 0x01;
  for (let offset = 0; offset < blocks; offset += 1) {
    const start = offset * 65535;
    const chunk = raw.subarray(start, Math.min(start + 65535, raw.length));
    const length = chunk.length;
    out[at++] = offset === blocks - 1 ? 1 : 0;         // BFINAL, BTYPE = stored
    out[at++] = length & 0xFF;
    out[at++] = (length >>> 8) & 0xFF;
    out[at++] = (~length) & 0xFF;
    out[at++] = ((~length) >>> 8) & 0xFF;
    out.set(chunk, at);
    at += length;
  }
  const sum = adler32(raw);
  out[at++] = (sum >>> 24) & 0xFF;
  out[at++] = (sum >>> 16) & 0xFF;
  out[at++] = (sum >>> 8) & 0xFF;
  out[at++] = sum & 0xFF;
  return out.subarray(0, at);
}

async function deflate(raw) {
  if (typeof CompressionStream !== "function" || typeof Response !== "function") {
    return zlibStored(raw);
  }
  try {
    const stream = new CompressionStream("deflate");
    // Start draining before writing: a 512×512 RGBA row block is ~1 MB, and a
    // `write()` with no reader on the other end blocks once the queue fills.
    const drained = new Response(stream.readable).arrayBuffer();
    const writer = stream.writable.getWriter();
    await writer.write(raw);
    await writer.close();
    return new Uint8Array(await drained);
  } catch (error) {
    // An explicit fallback keeps the thumbnail honest instead of failing the save.
    return zlibStored(raw);
  }
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const length = body.length;
  out[0] = (length >>> 24) & 0xFF;
  out[1] = (length >>> 16) & 0xFF;
  out[2] = (length >>> 8) & 0xFF;
  out[3] = length & 0xFF;
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(body, 8);
  const crc = crc32(out.subarray(4, 8 + length));
  out[8 + length] = (crc >>> 24) & 0xFF;
  out[9 + length] = (crc >>> 16) & 0xFF;
  out[10 + length] = (crc >>> 8) & 0xFF;
  out[11 + length] = crc & 0xFF;
  return out;
}

/** Encode 8-bit RGBA pixels as a PNG. */
export async function encodePng(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`cannot encode a ${width}x${height} PNG`);
  }
  if (!rgba || rgba.length < width * height * 4) {
    throw new Error(`the image buffer holds ${rgba ? rgba.length : 0} bytes, but `
      + `${width}x${height} RGBA needs ${width * height * 4}`);
  }
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const from = row * stride;
    raw[row * (stride + 1)] = 0;                       // filter type: none
    raw.set(rgba.subarray(from, from + stride), row * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xFF;
  ihdr[1] = (width >>> 16) & 0xFF;
  ihdr[2] = (width >>> 8) & 0xFF;
  ihdr[3] = width & 0xFF;
  ihdr[4] = (height >>> 24) & 0xFF;
  ihdr[5] = (height >>> 16) & 0xFF;
  ihdr[6] = (height >>> 8) & 0xFF;
  ihdr[7] = height & 0xFF;
  ihdr[8] = 8;                                        // bit depth
  ihdr[9] = 6;                                        // colour type: RGBA
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** Read a PNG's real dimensions, or null when the bytes are not a PNG. */
export function readPng(bytes) {
  if (!bytes || bytes.length < 24) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  }
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") {
    return null;
  }
  const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8)
    | bytes[19]) >>> 0;
  const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8)
    | bytes[23]) >>> 0;
  return { width, height, depth: bytes[24], colourType: bytes[25],
           interlace: bytes[28] };
}

/** Throws unless `bytes` is a real PNG of exactly this size. */
export function assertPng(bytes, width, height, what) {
  const info = readPng(bytes);
  if (!info) throw new Error(`${what} is not a PNG`);
  if (width && (info.width !== width || info.height !== height)) {
    throw new Error(`${what} is ${info.width}x${info.height}, expected `
      + `${width}x${height}`);
  }
  if (info.depth !== 8 || info.colourType !== 6) {
    throw new Error(`${what} is not an 8-bit RGBA PNG`);
  }
  return info;
}
