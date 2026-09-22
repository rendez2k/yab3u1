#!/usr/bin/env python3
"""
make_icon.py -- draw u1convert.ico.

A .bat can never show a custom icon in Explorer, so the launcher is a shortcut
(.lnk) pointing at the .bat, and this is the icon it uses.

The artwork is deliberately plain: the four U1 filament colours as a 2x2 plate on
the same dark panel the UI uses, which stays readable down to 16 px.

    python make_icon.py            # writes u1convert.ico next to this file
    python make_icon.py --png      # also writes a preview PNG
"""

from __future__ import annotations

import argparse
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))

# straight from the web UI's palette, so the icon and the page agree
PANEL = (0x1C, 0x1F, 0x25, 0xFF)
EDGE = (0x2E, 0x33, 0x3D, 0xFF)
SQUARES = [
    (0xFF, 0x80, 0x00, 0xFF),   # slot 1 orange
    (0x00, 0x80, 0x00, 0xFF),   # slot 2 green
    (0xFF, 0xFF, 0xFF, 0xFF),   # slot 4 white
    (0x0A, 0x0A, 0x0C, 0xFF),   # slot 3 black
]
# the black tile needs a hairline or it disappears into the panel
SQUARE_EDGE = (0x55, 0x5B, 0x66, 0xFF)

SUPERSAMPLE = 4
SIZES = (16, 24, 32, 48, 64, 256)


def inside_round_rect(px, py, x0, y0, x1, y1, r) -> bool:
    if not (x0 <= px <= x1 and y0 <= py <= y1):
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    if px == cx or py == cy:
        return True
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def pixel(u, v) -> tuple:
    """Colour at normalised (u, v), or None for transparent."""
    if not inside_round_rect(u, v, 0.01, 0.01, 0.99, 0.99, 0.19):
        return None
    # border ring
    if not inside_round_rect(u, v, 0.035, 0.035, 0.965, 0.965, 0.17):
        return EDGE

    m, g = 0.17, 0.085
    size = (1.0 - 2 * m - g) / 2.0
    for idx, colour in enumerate(SQUARES):
        col, row = idx % 2, idx // 2
        x0 = m + col * (size + g)
        y0 = m + row * (size + g)
        if inside_round_rect(u, v, x0, y0, x0 + size, y0 + size, size * 0.22):
            # hairline so the black tile reads as a tile
            if not inside_round_rect(u, v, x0 + 0.012, y0 + 0.012,
                                     x0 + size - 0.012, y0 + size - 0.012,
                                     size * 0.19):
                return SQUARE_EDGE
            return colour
    return PANEL


def render(size: int):
    """Return rows of RGBA bytes, top-down, anti-aliased by supersampling."""
    n = size * SUPERSAMPLE
    # sample the full grid once
    grid = [[pixel((x + 0.5) / n, (y + 0.5) / n) for x in range(n)] for y in range(n)]
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    c = grid[y * SUPERSAMPLE + sy][x * SUPERSAMPLE + sx]
                    if c is None:
                        continue
                    # composite over transparent, so edges stay clean
                    r += c[0] * c[3]
                    g += c[1] * c[3]
                    b += c[2] * c[3]
                    a += c[3]
            total = SUPERSAMPLE * SUPERSAMPLE
            if a == 0:
                row += bytes(4)
            else:
                row += bytes((round(r / a), round(g / a), round(b / a), round(a / total)))
        rows.append(bytes(row))
    return rows


def png_bytes(w: int, h: int, rows) -> bytes:
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def bmp_bytes(w: int, h: int, rows) -> bytes:
    """32-bit bottom-up DIB plus the (unused) AND mask, as ICO wants it."""
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0,
                         w * h * 4, 0, 0, 0, 0)
    body = bytearray()
    for y in range(h - 1, -1, -1):
        row = rows[y]
        for x in range(w):
            r, g, b, a = row[x * 4:x * 4 + 4]
            body += bytes((b, g, r, a))
    mask_stride = ((w + 31) // 32) * 4
    return header + bytes(body) + bytes(mask_stride * h)


def ico_bytes(images) -> bytes:
    """images: list of (w, h, payload). 256 px entries are PNG, rest are DIB."""
    out = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = bytearray()
    for w, h, payload in images:
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32,
                               len(payload), offset)
        offset += len(payload)
    return out + bytes(entries) + b"".join(p for _, _, p in images)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="make_icon.py")
    ap.add_argument("-o", "--output", default=os.path.join(HERE, "u1convert.ico"))
    ap.add_argument("--png", action="store_true",
                    help="also write u1convert-preview.png")
    args = ap.parse_args(argv)

    images = []
    for size in SIZES:
        rows = render(size)
        payload = (png_bytes(size, size, rows) if size >= 256
                   else bmp_bytes(size, size, rows))
        images.append((size, size, payload))
        print(f"  {size:3d} px  {len(payload):,} bytes"
              f"  ({'png' if size >= 256 else 'bmp'})")

    data = ico_bytes(images)
    with open(args.output, "wb") as fh:
        fh.write(data)
    print(f"wrote {args.output} ({len(data):,} bytes)")

    if args.png:
        rows = render(256)
        preview = os.path.join(HERE, "u1convert-preview.png")
        with open(preview, "wb") as fh:
            fh.write(png_bytes(256, 256, rows))
        print(f"wrote {preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
