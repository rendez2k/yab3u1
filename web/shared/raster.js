// A small, deterministic software rasteriser for the saved thumbnail.
//
// It takes the *same* simplified soup the interactive preview draws (world-space
// positions and one flat colour per facet, both in the worker) and returns a
// bounded RGBA image.  There is no canvas, no WebGL and no DOM here, so a
// thumbnail is still produced on a machine where the 3D view cannot start, and
// the same input always gives the same image: the camera is fixed, so a user who
// orbited or panned the preview cannot save a blank or off-model picture.

export const DEFAULT_BACKGROUND = [242, 244, 247, 255];

/** Fixed isometric-ish camera: eye direction and its screen basis, z-up world. */
const VIEW = (() => {
  const yaw = -Math.PI / 4;
  const pitch = Math.atan(1 / Math.SQRT2);            // 35.264°: true isometric
  const eye = [Math.cos(pitch) * Math.sin(yaw),
               -Math.cos(pitch) * Math.cos(yaw),
               Math.sin(pitch)];
  const length = Math.hypot(eye[0], eye[1], eye[2]);
  const forward = [eye[0] / length, eye[1] / length, eye[2] / length];
  // right = worldUp × forward, then up = forward × right.
  let right = [-forward[1], forward[0], 0];
  const rightLength = Math.hypot(right[0], right[1], right[2]) || 1;
  right = [right[0] / rightLength, right[1] / rightLength, right[2] / rightLength];
  const up = [forward[1] * right[2] - forward[2] * right[1],
              forward[2] * right[0] - forward[0] * right[2],
              forward[0] * right[1] - forward[1] * right[0]];
  return { forward, right, up };
})();

const to255 = (value) => Math.max(0, Math.min(255, Math.round(value * 255)));

/**
 * Rasterise triangle soup to RGBA.
 *
 * @param {Float32Array|Array} positions flat x,y,z per vertex (3 per triangle)
 * @param {Float32Array|Array} colors    flat r,g,b per vertex, 0..1
 * @param {{size?: number, background?: number[], margin?: number}} options
 * @returns {{width: number, height: number, data: Uint8ClampedArray,
 *            triangles: number, drawn: number}}
 */
export function renderIso(positions, colors, options = {}) {
  const size = Math.max(32, Math.min(2048, Math.round(options.size || 512)));
  const background = options.background || DEFAULT_BACKGROUND;
  const margin = options.margin === undefined ? 0.06 : options.margin;
  const total = Math.floor((positions ? positions.length : 0) / 9);
  if (!total) {
    throw new Error("there is no geometry to draw, so no thumbnail can be made");
  }

  // Project every vertex once: screen x/y in world units, depth towards the eye.
  const { forward, right, up } = VIEW;
  const projected = new Float32Array(total * 9);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let vertex = 0; vertex < total * 3; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const sx = x * right[0] + y * right[1] + z * right[2];
    const sy = x * up[0] + y * up[1] + z * up[2];
    const depth = x * forward[0] + y * forward[1] + z * forward[2];
    const at = vertex * 3;
    projected[at] = sx;
    projected[at + 1] = sy;
    projected[at + 2] = depth;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const usable = size * (1 - 2 * Math.max(0, margin));
  const scale = usable / Math.max(spanX, spanY);
  const offsetX = (size - spanX * scale) / 2 - minX * scale;
  const offsetY = (size - spanY * scale) / 2 - minY * scale;

  const data = new Uint8ClampedArray(size * size * 4);
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    data[pixel * 4] = background[0];
    data[pixel * 4 + 1] = background[1];
    data[pixel * 4 + 2] = background[2];
    data[pixel * 4 + 3] = background[3] === undefined ? 255 : background[3];
  }

  // Geometry is already simplified in the worker. Dropping more facets here
  // exposes the back surface and leaves holes in the saved image.
  const depths = new Float32Array(size * size).fill(-Infinity);
  let drawn = 0;
  for (let index = 0; index < total; index += 1) {
    const at = index * 9;
    const ax = projected[at] * scale + offsetX;
    const ay = size - (projected[at + 1] * scale + offsetY);
    const bx = projected[at + 3] * scale + offsetX;
    const by = size - (projected[at + 4] * scale + offsetY);
    const cx = projected[at + 6] * scale + offsetX;
    const cy = size - (projected[at + 7] * scale + offsetY);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!area) continue;                                // edge-on: nothing to fill
    const colour = index * 9;
    const red = to255(colors[colour]);
    const green = to255(colors[colour + 1]);
    const blue = to255(colors[colour + 2]);
    const minPixelX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxPixelX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minPixelY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxPixelY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const step = area < 0 ? -1 : 1;
    drawn += 1;
    for (let py = minPixelY; py <= maxPixelY; py += 1) {
      const sampleY = py + 0.5;
      for (let px = minPixelX; px <= maxPixelX; px += 1) {
        const sampleX = px + 0.5;
        const e0 = step * ((bx - ax) * (sampleY - ay) - (by - ay) * (sampleX - ax));
        if (e0 < 0) continue;
        const e1 = step * ((cx - bx) * (sampleY - by) - (cy - by) * (sampleX - bx));
        if (e1 < 0) continue;
        const e2 = step * ((ax - cx) * (sampleY - cy) - (ay - cy) * (sampleX - cx));
        if (e2 < 0) continue;
        const pixelIndex = py * size + px;
        const depth = (e1 * projected[at + 2] + e2 * projected[at + 5]
          + e0 * projected[at + 8]) / Math.abs(area);
        if (depth <= depths[pixelIndex]) continue;
        depths[pixelIndex] = depth;
        const pixel = pixelIndex * 4;
        data[pixel] = red;
        data[pixel + 1] = green;
        data[pixel + 2] = blue;
        data[pixel + 3] = 255;
      }
    }
  }
  return { width: size, height: size, data, triangles: total, drawn };
}

/** Integer box-average downscale, used for the 128 px cover image. */
export function downscale(image, size) {
  const { width, height, data } = image;
  if (width === size && height === size) return image;
  const out = new Uint8ClampedArray(size * size * 4);
  const scaleX = width / size;
  const scaleY = height / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let sy = y0; sy < y1 && sy < height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < width; sx += 1) {
          const at = (sy * width + sx) * 4;
          red += data[at];
          green += data[at + 1];
          blue += data[at + 2];
          alpha += data[at + 3];
          count += 1;
        }
      }
      const at = (y * size + x) * 4;
      const divisor = count || 1;
      out[at] = red / divisor;
      out[at + 1] = green / divisor;
      out[at + 2] = blue / divisor;
      out[at + 3] = alpha / divisor;
    }
  }
  return { width: size, height: size, data: out, triangles: image.triangles,
           drawn: image.drawn };
}
