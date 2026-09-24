/* Vendored from prusa3d/prusa-fdm-mixer @ 7dad18f9a08cdfce29fa86d561f08d14f4968205.
TypeScript types removed; runtime math unchanged.
MIT License

Copyright (c) 2026 Ondrej Bartas (Prusa Research s.r.o.) and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/**
 * Color space helpers: hex ↔ sRGB ↔ XYZ ↔ LAB.
 *
 * All RGB values use 0–255 range. All linear-light values use 0–1 range.
 * LAB uses standard CIE L*a*b* with D65 reference white.
 */

                      
            
            
            
 

                      
            
            
            
 

/** Parse a `#rrggbb` (or `rrggbb`) hex string to {r, g, b} in 0–255. */
export function hexToRgb(hex        )      {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/** Format an {r, g, b} in 0–255 (any real values; will be clamped+rounded) as `#rrggbb`. */
export function rgbToHex(rgb     )         {
  const c = (v        )         =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(rgb.r) + c(rgb.g) + c(rgb.b);
}

/** sRGB gamma decode (0–255 input → 0–1 linear output). */
export function srgbToLinear(c        )         {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB gamma encode (0–1 linear input → 0–255 output, clamped). */
export function linearToSrgb(c        )         {
  const x = Math.max(0, Math.min(1, c));
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return v * 255;
}

/** sRGB → XYZ (D65). Input 0–255, output linear XYZ. */
export function rgbToXyz(rgb     )                                      {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    z: r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  };
}

/** XYZ (D65) → CIELAB. */
export function xyzToLab(x        , y        , z        )      {
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const f = (t        )         =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** CIELAB → XYZ (D65). */
export function labToXyz(lab     )                                      {
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const finv = (t        )         =>
    Math.pow(t, 3) > 0.008856 ? Math.pow(t, 3) : (t - 16 / 116) / 7.787;
  return { x: xn * finv(fx), y: yn * finv(fy), z: zn * finv(fz) };
}

/** XYZ (D65) → sRGB (0–255 floats; not yet clamped/rounded). */
export function xyzToRgb(x        , y        , z        )      {
  return {
    r: linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314),
    g: linearToSrgb(x * -0.9692660 + y * 1.8760108 + z * 0.0415560),
    b: linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252),
  };
}

/** Hex → LAB (convenience). */
export function hexToLab(hex        )      {
  const rgb = hexToRgb(hex);
  const xyz = rgbToXyz(rgb);
  return xyzToLab(xyz.x, xyz.y, xyz.z);
}

/** LAB → hex (convenience; clamped to gamut). */
export function labToHex(lab     )         {
  const xyz = labToXyz(lab);
  const rgb = xyzToRgb(xyz.x, xyz.y, xyz.z);
  return rgbToHex(rgb);
}

/** LAB chroma (distance from neutral axis). */
export function chroma(lab     )         {
  return Math.hypot(lab.a, lab.b);
}

/** LAB hue angle in degrees [0, 360). Returns 0 for near-neutral colors. */
export function hueDegrees(lab     )         {
  if (chroma(lab) < 0.01) return 0;
  return ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
}
