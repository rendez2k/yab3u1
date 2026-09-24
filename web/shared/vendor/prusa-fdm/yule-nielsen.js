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
 * Yule-Nielsen color mixing — pure baseline, no empirical corrections.
 *
 * Per channel in linear-light RGB:
 *   (Σ ratio · linear^(1/n))^n
 *
 * `yuleNielsenMix` is the primitive (returns RGB) and is reused as step 1 of
 * the v7 model in `prusa-fdm-mixer.ts`. `mixYuleNielsen` is the public
 * comparison-baseline wrapper that returns `MixResult` like the other mixers.
 */

import {
  hexToRgb,
  rgbToHex,
  srgbToLinear,
  linearToSrgb,
  hexToLab,
           
} from './color.js';
                                                                    

export function yuleNielsenMix(parts                , n = 3.0)      {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of parts) {
    const rgb = hexToRgb(p.hex);
    r += Math.pow(srgbToLinear(rgb.r), 1 / n) * p.ratio;
    g += Math.pow(srgbToLinear(rgb.g), 1 / n) * p.ratio;
    b += Math.pow(srgbToLinear(rgb.b), 1 / n) * p.ratio;
  }
  return {
    r: linearToSrgb(Math.pow(Math.max(0, r), n)),
    g: linearToSrgb(Math.pow(Math.max(0, g), n)),
    b: linearToSrgb(Math.pow(Math.max(0, b), n)),
  };
}

export function mixYuleNielsen(parts                )            {
  const rgb = yuleNielsenMix(parts, 3.0);
  const hex = rgbToHex(rgb);
  const lab = hexToLab(hex);
  return { hex, lab, rgb };
}
