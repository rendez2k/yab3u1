#!/usr/bin/env python3
"""Colour handling for the local assessment step.

The one job here is to answer "which of the four loaded filaments is closest to
this colour in the file" in a way that behaves like a person would expect, and to
say honestly how far apart the two are.  Colours are converted to CIELAB (D65)
the way Strata's palette helper does (``_pwLab``/``_pwNearest`` in
``src/js/89-paint-workflow.js``, reviewed read-only as a reference), and compared
with the graphic-arts form of CIE94 rather than raw Euclidean distance: plain
Lab distance weights lightness as heavily as hue, which happily calls a brown
filament "closest" to white.  CIE94 scales the chroma and hue terms, so a brown
lands on orange and a pale blue lands on white or green, which is the order a
person would put them in.

This is an uncalibrated estimate.  It knows nothing about what a filament looks
like after it is extruded, about translucency, or about the printer's colour
order; it is a starting point the user can override per colour.
"""

from __future__ import annotations

import re

HEX_RE = re.compile(r"^#?([0-9A-Fa-f]{6})$")
HEX8_RE = re.compile(r"^#?([0-9A-Fa-f]{8})$")

# D65 white point, the reference Orca and the slicers use for sRGB.
_WHITE = (0.95047, 1.0, 1.08883)

# CIE94 distance bands, used only to word the comparison honestly.
CLOSE = 8.0
FAIR = 25.0


def norm(value: str) -> str:
    """Any spelling of a colour -> "#RRGGBB", or "" when it is not a colour."""
    text = (value or "").strip()
    m = HEX_RE.match(text)
    if not m:
        m = HEX8_RE.match(text)       # filament_colour carries an alpha byte
        if not m:
            return ""
        return "#" + m.group(1)[:6].upper()
    return "#" + m.group(1).upper()


def rgb(value: str):
    text = norm(value)
    if not text:
        return None
    return (int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16))


def _linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def to_lab(value: str):
    """sRGB -> CIELAB.  Returns None for text that is not a colour."""
    channels = rgb(value)
    if channels is None:
        return None
    r, g, b = (_linear(c / 255.0) for c in channels)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / _WHITE[0]
    y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b)
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / _WHITE[2]

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _chroma(lab) -> float:
    return (lab[1] ** 2 + lab[2] ** 2) ** 0.5


def distance(a, b) -> float:
    """CIE94 (graphic arts) distance between two colours or two Lab triples."""
    la, lb = _as_lab(a), _as_lab(b)
    if la is None or lb is None:
        return float("inf")
    delta_l = la[0] - lb[0]
    delta_a = la[1] - lb[1]
    delta_b = la[2] - lb[2]
    chroma_a, chroma_b = _chroma(la), _chroma(lb)
    delta_c = chroma_a - chroma_b
    delta_h_sq = delta_a ** 2 + delta_b ** 2 - delta_c ** 2
    delta_h = (delta_h_sq ** 0.5) if delta_h_sq > 0 else 0.0
    # Textile weighting (kL=2) is gentler on lightness; graphic arts (kL=1) is
    # what a person comparing two swatches is doing here.
    scale_c = 1 + 0.045 * chroma_a
    scale_h = 1 + 0.015 * chroma_a
    return (delta_l ** 2 + (delta_c / scale_c) ** 2 + (delta_h / scale_h) ** 2) ** 0.5


def _as_lab(value):
    if isinstance(value, (tuple, list)) and len(value) == 3:
        return tuple(float(v) for v in value)
    return to_lab(value)


def nearest(value: str, options: list[str]):
    """(index, distance) of the closest option, or (None, inf) if there are none."""
    target = _as_lab(value)
    best, best_d = None, float("inf")
    if target is None:
        return None, best_d
    for i, option in enumerate(options):
        d = distance(target, option)
        if d < best_d:
            best, best_d = i, d
    return best, best_d


def verdict(delta: float) -> str:
    """Plain wording for a Lab distance, so the page never over-promises."""
    if delta == float("inf"):
        return "unknown"
    if delta <= CLOSE:
        return "close"
    if delta <= FAIR:
        return "fair"
    return "approximate"


def suggest_mapping(colors_by_source: dict[int, str],
                    destinations: list[str]) -> dict[int, int]:
    """Nearest destination slot for each source extruder.

    ``colors_by_source`` is {source extruder: hex colour}, ``destinations`` the
    four loaded filament colours in slot order.  Slots are reused when two source
    colours are closer to the same filament than to any other -- that is what
    simplification means; the caller shows the comparison before exporting.
    """
    slots = [norm(c) for c in destinations]
    out: dict[int, int] = {}
    for source in sorted(colors_by_source):
        index, _ = nearest(colors_by_source[source], slots)
        out[source] = (index + 1) if index is not None else 1
    return out


def comparison(colors_by_source: dict[int, str], mapping: dict[int, int],
               destinations: list[str]) -> list[dict]:
    """Original -> result rows for the mapping table, with honest distances."""
    slots = [norm(c) for c in destinations]
    rows = []
    for source in sorted(colors_by_source):
        slot = mapping.get(source)
        result = slots[slot - 1] if isinstance(slot, int) and 1 <= slot <= len(slots) else ""
        delta = distance(colors_by_source[source], result) if result else float("inf")
        rows.append({
            "source": source,
            "original": norm(colors_by_source[source]),
            "slot": slot if isinstance(slot, int) else None,
            "result": result,
            "distance": None if delta == float("inf") else round(delta, 1),
            "verdict": "same" if result and delta <= 0.5 else verdict(delta),
        })
    return rows
