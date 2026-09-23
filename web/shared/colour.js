// Colour handling shared by the local page and the static one.
//
// The Python copy is u1colour.py; the two are kept in step by tests that compare
// their answers on the same inputs. Colours are compared in CIELAB with the
// graphic-arts CIE94 metric, which is what makes a brown land on orange rather
// than on white. Everything here is an uncalibrated estimate from swatch values.

const HEX_RE = /^#?([0-9A-Fa-f]{6})$/;
const HEX8_RE = /^#?([0-9A-Fa-f]{8})$/;

const WHITE = [0.95047, 1.0, 1.08883];
export const CLOSE = 8.0;
export const FAIR = 25.0;

export function norm(value) {
  const text = String(value == null ? "" : value).trim();
  let m = HEX_RE.exec(text);
  if (!m) {
    m = HEX8_RE.exec(text);
    if (!m) return "";
    return "#" + m[1].slice(0, 6).toUpperCase();
  }
  return "#" + m[1].toUpperCase();
}

export function rgb(value) {
  const text = norm(value);
  if (!text) return null;
  return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16),
          parseInt(text.slice(5, 7), 16)];
}

function linear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function toLab(value) {
  const channels = rgb(value);
  if (!channels) return null;
  const [r, g, b] = channels.map((c) => linear(c / 255));
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0];
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const asLab = (value) => (Array.isArray(value) && value.length === 3
  ? value.map(Number) : toLab(value));

function chroma(lab) {
  return Math.hypot(lab[1], lab[2]);
}

export function distance(a, b) {
  const la = asLab(a);
  const lb = asLab(b);
  if (!la || !lb) return Infinity;
  const dL = la[0] - lb[0];
  const dA = la[1] - lb[1];
  const dB = la[2] - lb[2];
  const cA = chroma(la);
  const cB = chroma(lb);
  const dC = cA - cB;
  const dHsq = dA * dA + dB * dB - dC * dC;
  const dH = dHsq > 0 ? Math.sqrt(dHsq) : 0;
  const scaleC = 1 + 0.045 * cA;
  const scaleH = 1 + 0.015 * cA;
  return Math.sqrt(dL * dL + (dC / scaleC) ** 2 + (dH / scaleH) ** 2);
}

export function nearest(value, options) {
  const target = asLab(value);
  let best = null;
  let bestD = Infinity;
  if (!target) return [null, bestD];
  options.forEach((option, index) => {
    const d = distance(target, option);
    if (d < bestD) {
      best = index;
      bestD = d;
    }
  });
  return [best, bestD];
}

export function verdict(delta) {
  if (!Number.isFinite(delta)) return "unknown";
  if (delta <= CLOSE) return "close";
  if (delta <= FAIR) return "fair";
  return "approximate";
}

export function suggestMapping(colorsBySource, destinations) {
  const slots = destinations.map((c) => norm(c));
  const out = {};
  Object.keys(colorsBySource).map(Number).sort((a, b) => a - b).forEach((source) => {
    const [index] = nearest(colorsBySource[source], slots);
    out[source] = index == null ? 1 : index + 1;
  });
  return out;
}

export function comparison(sourceColors, mapping, destinations) {
  const slots = destinations.map((c) => norm(c));
  return Object.keys(sourceColors).map(Number).sort((a, b) => a - b).map((source) => {
    const original = norm(sourceColors[source]);
    const slot = mapping[source] || 1;
    const result = slots[slot - 1] || "";
    const delta = distance(original, result);
    return {
      source, original, slot,
      result,
      distance: Number.isFinite(delta) ? Math.round(delta * 10) / 10 : null,
      verdict: verdict(delta),
    };
  });
}
