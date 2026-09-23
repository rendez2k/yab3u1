#!/usr/bin/env python3
"""The painted-triangle bitstream, as PrusaSlicer, Bambu Studio and OrcaSlicer share it.

PrusaSlicer stores it in ``slic3rpe:mmu_segmentation``, Orca and Bambu read the
same bytes from ``paint_color``; support and seam painting use the identical
grammar under ``slic3rpe:custom_supports`` / ``paint_supports`` and
``slic3rpe:custom_seam`` / ``paint_seam``.

One attribute value describes one original triangle.  The value is a hex literal
whose bits, least-significant first, are a tree:

    2 bits   n -- how many of the triangle's sides the paint splits
    if n=0:  a leaf: the escaped material state for this whole (sub)triangle
    if n>0:  2 bits of the node's *special side* -- geometry metadata recording
             where the cut runs, never a filament -- then n+1 child nodes in
             order, each described the same way

A leaf carries 2 bits of state for materials 0..2; the code ``0b11`` introduces a
nibble holding ``state - 3`` (states 3..17), and a nibble of ``0b1111`` introduces
a second nibble holding ``state - 18`` (states 18..33).  State 0 means "no
override" -- the object's own filament -- which is why it is never remapped.

Only the leaf field names a material.  The second field of a split node is the
``special_side`` the slicer's ``TriangleSelector`` stores (OrcaSlicer
``src/libslic3r/TriangleSelector.cpp``, serialise/deserialise: ``xx`` is the
special side, ``yy`` the number of split sides, and only a leaf reads the escaped
state).  Rewriting it would look harmless -- it is two bits like the others -- but
a material that needs the escape prefix changes the *shape* of the tree, so the
branch below it would be parsed as something else entirely.  It is preserved bit
for bit.

The split form was also pinned down against 671 real sub-divided attribute values
taken from "They live alien_5 colors.3mf" (129 painted, 542 support-painted):
every one round-trips bit for bit.  Round-tripping alone does not prove the
*meaning* of a field, which is why the special side is treated as opaque metadata
rather than inferred from the values.  ``decode`` refuses a value it cannot fully
explain rather than guessing, so a remap built on it either rewrites the whole
tree or is abandoned by the caller.
"""

from __future__ import annotations

import re

HEX_RE = re.compile(r"^[0-9A-Fa-f]*$")

STATE_LEAF_MAX = 3       # states 0..2 are two bits; 3 is the escape marker
STATE_NIBBLE_MAX = 18    # states 3..17 fit one nibble
STATE_SECOND_MAX = 34    # states 18..33 fit an escape plus one nibble

# The id range this tool writes and reads back with confidence.  Twelve virtual
# filaments after four reels is 16; above that, newer Prusa-format files reuse
# the escape marker for a longer encoding, so a value in that range means
# different things to different slicers.  Such a value is refused rather than
# remapped.
SUPPORTED_STATE_MAX = 16


def excessive_states(text: str) -> list:
    """States above :data:`SUPPORTED_STATE_MAX` in this value, or [] if none."""
    try:
        node = decode(text)
    except PaintError:
        return []
    return sorted({s for s in walk_states(node) if s > SUPPORTED_STATE_MAX})


class PaintError(ValueError):
    """The attribute value is not a bitstream this module can rewrite."""


def hex_to_bits(text: str) -> list[int]:
    """Hex literal -> bits, least-significant bit of the literal first."""
    if not text or not HEX_RE.match(text):
        return []
    value = int(text, 16)
    return [(value >> i) & 1 for i in range(4 * len(text))]


def bits_to_hex(bits: list[int]) -> str:
    """Bits -> hex literal.  Short counts are padded with zero bits, the way the
    slicers pad them, and never truncated."""
    value = sum(b << i for i, b in enumerate(bits))
    digits = max(1, -(-len(bits) // 4))
    return "%0*X" % (digits, value)


# --------------------------------------------------------------------------------------
# node grammar
#
# A node is ("leaf", state) or ("split", sides, special_side, [child, ...]).
# ``special_side`` is geometry metadata and is never rewritten.
# --------------------------------------------------------------------------------------

def _read_state(bits: list[int], i: int, end: int):
    if i + 2 > end:
        raise PaintError("paint stream ends inside a state field")
    code = bits[i] | (bits[i + 1] << 1)
    i += 2
    if code != 3:
        return code, i
    if i + 4 > end:
        raise PaintError("paint stream ends inside an escaped state")
    nibble = bits[i] | (bits[i + 1] << 1) | (bits[i + 2] << 2) | (bits[i + 3] << 3)
    i += 4
    if nibble != 0xF:
        return 3 + nibble, i
    if i + 4 > end:
        raise PaintError("paint stream ends inside a two-nibble state")
    nibble2 = bits[i] | (bits[i + 1] << 1) | (bits[i + 2] << 2) | (bits[i + 3] << 3)
    i += 4
    return 18 + nibble2, i


def _write_state(state: int) -> list[int]:
    if state < 0:
        raise PaintError(f"negative paint state {state}")
    if state < 3:
        return [state & 1, (state >> 1) & 1]
    if state < 18:
        value = state - 3
        return [1, 1] + [(value >> k) & 1 for k in range(4)]
    if state < 34:
        value = state - 18
        return [1, 1, 1, 1, 1, 1] + [(value >> k) & 1 for k in range(4)]
    raise PaintError(f"paint state {state} is beyond the format's range")


def _decode_node(bits: list[int], i: int, end: int, depth: int):
    if depth > 12:
        raise PaintError("paint stream nests deeper than the format allows")
    if i + 2 > end:
        raise PaintError("paint stream ends inside a split count")
    sides = bits[i] | (bits[i + 1] << 1)
    i += 2
    if sides == 0:
        state, i = _read_state(bits, i, end)
        return ("leaf", state), i
    if i + 2 > end:
        raise PaintError("paint stream ends inside a special side")
    special_side = bits[i] | (bits[i + 1] << 1)     # two raw bits, no escape
    i += 2
    children = []
    for _ in range(sides + 1):
        child, i = _decode_node(bits, i, end, depth + 1)
        children.append(child)
    return ("split", sides, special_side, children), i


def _encode_node(node) -> list[int]:
    kind = node[0]
    if kind == "leaf":
        return [0, 0] + _write_state(node[1])
    if kind == "split":
        _, sides, special_side, children = node
        if sides not in (1, 2, 3):
            raise PaintError(f"a node cannot split {sides} sides")
        if special_side not in (0, 1, 2, 3):
            raise PaintError(f"a special side of {special_side} is not two bits")
        if len(children) != sides + 1:
            raise PaintError("split node has the wrong number of children")
        out = [sides & 1, (sides >> 1) & 1, special_side & 1, (special_side >> 1) & 1]
        for child in children:
            out += _encode_node(child)
        return out
    raise PaintError(f"unknown paint node {kind!r}")


def decode(text: str):
    """Attribute value -> paint tree.

    Raises PaintError when the value is empty, malformed, or leaves unexplained
    non-zero bits behind.  The caller treats that as "copy this value through
    unchanged, and refuse a remap that would need to touch it".
    """
    if not text:
        raise PaintError("empty paint value")
    if not HEX_RE.match(text):
        raise PaintError(f"paint value {text!r} is not hexadecimal")
    bits = hex_to_bits(text)
    node, used = _decode_node(bits, 0, len(bits), 0)
    if any(bits[used:]):
        raise PaintError("paint stream has non-zero bits after the last node")
    return node


def encode(node) -> str:
    return bits_to_hex(_encode_node(node))


def is_leaf(node) -> bool:
    return node[0] == "leaf"


def walk_states(node):
    """Every *material* state in the tree, in order of appearance.

    Only leaves carry one; a split node's second field is its special side.
    """
    if node[0] == "leaf":
        return [node[1]]
    out: list = []
    for child in node[3]:
        out.extend(walk_states(child))
    return out


def special_sides(node):
    """The special-side metadata of every split node, in order (for diagnostics)."""
    if node[0] == "leaf":
        return []
    out = [node[2]]
    for child in node[3]:
        out.extend(special_sides(child))
    return out


def topology(node):
    """The tree's shape -- split counts and special sides, with no materials.

    Two values with the same topology differ only in their leaf materials, which
    is exactly what a colour remap is allowed to change.
    """
    if node[0] == "leaf":
        return ("leaf",)
    return ("split", node[1], node[2], tuple(topology(child) for child in node[3]))


def leaf_states(node):
    """Just the leaf states -- the materials a whole (sub)triangle is painted."""
    if node[0] == "leaf":
        return [node[1]]
    out = []
    for child in node[3]:
        out.extend(leaf_states(child))
    return out


def is_split(text: str) -> bool:
    """True when the value describes a sub-divided triangle (best effort)."""
    bits = hex_to_bits(text)
    if len(bits) < 2:
        return False
    return bool(bits[0] | (bits[1] << 1))


def remap_node(node, mapping: dict[int, int]):
    """Rewrite every leaf state through ``mapping``; state 0 always stays 0.

    Split metadata (how many sides are split, and the special side) is copied
    through untouched -- it is not a material.
    """
    if node[0] == "leaf":
        state = node[1]
        return ("leaf", 0 if state == 0 else mapping.get(state, state))
    _, sides, special_side, children = node
    return ("split", sides, special_side,
            [remap_node(child, mapping) for child in children])


def remap_text(text: str, mapping: dict[int, int]) -> str:
    """Rewrite one attribute value, or raise PaintError if that cannot be done.

    The result is re-decoded and compared with the rewritten tree, so a value
    that only *looks* parsable can never be written back as something else.
    """
    if not text:
        return text
    node = decode(text)
    if not any(state != 0 and state in mapping and mapping[state] != state
               for state in walk_states(node)):
        return text                       # nothing to do; keep the bytes
    rewritten = remap_node(node, mapping)
    out = encode(rewritten)
    if decode(out) != rewritten:
        raise PaintError("remapped paint value did not round-trip")
    return out


def needed_states(text: str) -> set[int]:
    """Non-zero states a value refers to, for mapping validation."""
    try:
        node = decode(text)
    except PaintError:
        return set()
    return {s for s in walk_states(node) if s}


# --------------------------------------------------------------------------------------
# whole-triangle helpers (kept for the single-object path in u1convert.py)
# --------------------------------------------------------------------------------------

def decode_leaf_state(text: str) -> int:
    """Extruder index for a whole-triangle paint, or 0 when not a simple leaf."""
    bits = hex_to_bits(text)
    if len(bits) < 4:
        return 0
    code = bits[0] | (bits[1] << 1) | (bits[2] << 2) | (bits[3] << 3)
    if code & 0b11:
        return 0
    if (code & 0b1100) != 0b1100:
        return code >> 2
    if len(bits) < 8:
        return 0
    nib = bits[4] | (bits[5] << 1) | (bits[6] << 2) | (bits[7] << 3)
    if nib == 0b1111:
        return 0                      # state >= 18, the two-nibble form
    return 3 + nib


def encode_leaf_state(state: int) -> str:
    return bits_to_hex([0, 0] + _write_state(state))
