"""An independent reader for the painted-triangle bitstream.

This is deliberately *not* built on ``u1paint``: it is a second implementation,
written from the upstream grammar, so that a test can compare the two and catch a
codec that only agrees with itself.  The grammar, from OrcaSlicer
``src/libslic3r/TriangleSelector.cpp`` (serialise/deserialise):

* a **leaf** writes two zero bits, then its material state -- 2 bits for states
  0..2, the marker ``0b11`` plus a nibble for 3..17, and ``0b11`` + ``0b1111``
  plus a nibble for 18..33;
* a **split node** writes two bits for the number of split sides, then two bits
  for the **special side** (geometry metadata, never a material), then its
  children in order;
* only a leaf carries a material state.

Bits are read least-significant-first from the hex literal, which the whole
triangle values pin down: ``4`` is material 1, ``8`` is 2, ``0C`` is 3, ``1C``
is 4, ``2C`` is 5.
"""

from __future__ import annotations


class Invalid(ValueError):
    """The value does not follow the upstream grammar."""


def _bits(text: str) -> list[int]:
    if not text:
        raise Invalid("empty value")
    try:
        value = int(text, 16)
    except ValueError:
        raise Invalid(f"{text!r} is not hexadecimal") from None
    return [(value >> i) & 1 for i in range(4 * len(text))]


def _read_state(bits, i, end):
    if i + 2 > end:
        raise Invalid("ends inside a leaf state")
    code = bits[i] | (bits[i + 1] << 1)
    i += 2
    if code != 3:
        return code, i
    if i + 4 > end:
        raise Invalid("ends inside an escaped state")
    nibble = bits[i] | (bits[i + 1] << 1) | (bits[i + 2] << 2) | (bits[i + 3] << 3)
    i += 4
    if nibble != 15:
        return 3 + nibble, i
    if i + 4 > end:
        raise Invalid("ends inside a two-nibble state")
    nibble2 = bits[i] | (bits[i + 1] << 1) | (bits[i + 2] << 2) | (bits[i + 3] << 3)
    return 18 + nibble2, i + 4


def _node(bits, i, end, depth=0):
    if depth > 12:
        raise Invalid("nests too deeply")
    if i + 2 > end:
        raise Invalid("ends inside a node header")
    sides = bits[i] | (bits[i + 1] << 1)
    i += 2
    if sides == 0:
        state, i = _read_state(bits, i, end)
        return ("leaf", state), i
    if i + 2 > end:
        raise Invalid("ends inside a special side")
    special = bits[i] | (bits[i + 1] << 1)
    i += 2
    children = []
    for _ in range(sides + 1):
        child, i = _node(bits, i, end, depth + 1)
        children.append(child)
    return ("split", sides, special, tuple(children)), i


def parse(value: str):
    """(topology, leaf materials) for one attribute value."""
    bits = _bits(value)
    node, used = _node(bits, 0, len(bits))
    if any(bits[used:]):
        raise Invalid("trailing non-zero bits")
    return _topology(node), _leaves(node)


def _topology(node):
    if node[0] == "leaf":
        return ("leaf",)
    return ("split", node[1], node[2], tuple(_topology(c) for c in node[3]))


def _leaves(node):
    if node[0] == "leaf":
        return [node[1]]
    out: list = []
    for child in node[3]:
        out.extend(_leaves(child))
    return out


def topology(value: str):
    return parse(value)[0]


def leaves(value: str):
    return parse(value)[1]


def mapped_leaves(value: str, mapping: dict):
    return [0 if s == 0 else mapping.get(s, s) for s in leaves(value)]


def compare_values(source: str, output: str, mapping: dict) -> list:
    """Problems with one source/output attribute pair, or [] when they agree."""
    problems = []
    try:
        source_topology, source_leaves = parse(source)
    except Invalid as exc:
        return [f"source value {source!r} is invalid: {exc}"]
    try:
        output_topology, output_leaves = parse(output)
    except Invalid as exc:
        return [f"output value {output!r} is invalid: {exc}"]
    if source_topology != output_topology:
        problems.append(f"topology changed: {source!r} -> {output!r}")
    expected = [0 if s == 0 else mapping.get(s, s) for s in source_leaves]
    if expected != output_leaves:
        problems.append(f"materials changed: {source!r} maps to {expected}, "
                        f"{output!r} carries {output_leaves}")
    return problems


_ATTR = {
    "paint": (r'(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"',
              "paint_color"),
    "supports": (r'(?:slic3rpe:)?(?:custom_supports|paint_supports)="([0-9A-Fa-f]*)"',
                 "paint_supports"),
    "seam": (r'(?:slic3rpe:)?(?:custom_seam|paint_seam)="([0-9A-Fa-f]*)"', "paint_seam"),
}


def _triangles(handle):
    """Yield (inner object id, triangle index, attributes) per facet."""
    import io
    import re

    object_re = re.compile(r"<object\b([^>]*)>")
    triangle_re = re.compile(r"<triangle\b([^>]*?)/?>")
    current = None
    index = 0
    for line in io.TextIOWrapper(handle, encoding="utf-8", errors="replace"):
        stripped = line.lstrip()
        if stripped.startswith("<object"):
            match = object_re.search(stripped)
            if match:
                current = re.search(r'id="([^"]*)"', match.group(1))
                current = current.group(1) if current else None
                index = 0
            continue
        if stripped.startswith("<triangle") and not stripped.startswith("<triangles"):
            match = triangle_re.search(stripped)
            if match is None:
                continue
            attrs = match.group(1)
            values = {}
            for key, (pattern, _name) in _ATTR.items():
                found = re.search(pattern, attrs)
                values[key] = found.group(1) if found else None
            geometry = re.sub(r'(?:slic3rpe:)?(?:mmu_segmentation|paint_color|'
                              r'custom_supports|paint_supports|custom_seam|paint_seam|'
                              r'fuzzy_skin|paint_fuzzy_skin)="[^"]*"', "", attrs)
            yield current, index, geometry, values
            index += 1


def compare_members(source_handle, output_handle, mapping: dict, limit: int = 8) -> list:
    """Compare two mesh members facet by facet, using only this grammar.

    Checks the geometry attributes are identical, each painted facet's topology
    survives and its materials map as expected, and support/seam painting is
    carried over unchanged.
    """
    problems: list = []
    source = _triangles(source_handle)
    output = _triangles(output_handle)
    count = 0
    while True:
        try:
            s_object, s_index, s_geometry, s_values = next(source)
        except StopIteration:
            s_object = None
        try:
            o_object, o_index, o_geometry, o_values = next(output)
        except StopIteration:
            o_object = None
        if s_object is None and o_object is None:
            break
        if s_object is None or o_object is None:
            problems.append(f"different triangle counts ({s_object} vs {o_object})")
            break
        count += 1
        if s_object != o_object or s_index != o_index:
            problems.append(f"facet order changed: {s_object}#{s_index} -> "
                            f"{o_object}#{o_index}")
            break
        if s_geometry != o_geometry:
            problems.append(f"{s_object}#{s_index} geometry changed")
        if s_values["paint"] and o_values["paint"]:
            problems.extend(f"{s_object}#{s_index}: {p}"
                            for p in compare_values(s_values["paint"],
                                                    o_values["paint"], mapping))
        elif bool(s_values["paint"]) != bool(o_values["paint"]):
            problems.append(f"{s_object}#{s_index} lost or gained its paint attribute")
        for key in ("supports", "seam"):
            if s_values[key] != o_values[key]:
                problems.append(f"{s_object}#{s_index} {key} painting changed")
        if len(problems) >= limit:
            break
    return problems
