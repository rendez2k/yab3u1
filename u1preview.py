#!/usr/bin/env python3
"""Triangle soup for the interactive preview, in the colours the export would use.

The preview shows the selection as it will print: every facet is painted with the
colour its *state* maps to under the plan that is on screen, so changing a reel or
unticking a recipe changes the picture as well as the file.  Positions are already
in world space (instance and part transforms applied), which is what makes the
preview agree with the placement in the export.

Two honest simplifications, both labelled in the UI:

* a sub-divided facet is drawn in the colour of the leaf state that covers most of
  it, because drawing the true sub-triangles needs the slicer's split maths and is
  not what the export writes either -- the exported attribute keeps every leaf;
* facets whose paint this tool will not rewrite are drawn in a hatch colour and
  reported, rather than being guessed at.

The soup is capped: past the cap the preview says so instead of stalling.
"""

from __future__ import annotations

import base64
import io
import re
import struct

import u1convert as u1
import u1paint
from u1project import _attr, _is_triangle, _tag_attrs

DEFAULT_LIMIT = 300000
TRI_RE = re.compile(r'\bv1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"')
UNKNOWN_COLOUR = "#B03060"


def colour_floats(value: str) -> tuple:
    """'#RRGGBB' -> three 0..1 floats for the vertex colour buffer."""
    text = (value or "").strip().lstrip("#")
    if len(text) != 6:
        text = "FFFFFF"
    try:
        channels = [int(text[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    except ValueError:
        channels = [1.0, 1.0, 1.0]
    return tuple(channels)


def _world(matrix):
    return ((matrix[0][0], matrix[1][0], matrix[2][0], matrix[3][0]),
            (matrix[0][1], matrix[1][1], matrix[2][1], matrix[3][1]),
            (matrix[0][2], matrix[1][2], matrix[2][2], matrix[3][2]))


def _facet_states(zf, member: str, wanted: set, matrix, base_state: int, stride: int,
                  cursor: dict, out_positions: list, out_states: list,
                  stats: dict) -> None:
    """Append one member's sampled facets (world space) and their leaf state.

    ``cursor['seen']`` counts every triangle in the whole selection, so keeping the
    ``stride``-th one samples evenly across all the parts and instances instead of
    stopping at the first ``limit`` triangles (which is one corner of a big model).
    """
    # The same convention as u1.apply: row-major storage, point as a column vector,
    # so x' = m00*x + m10*y + m20*z + m30 (and likewise for y and z). Reading the
    # matrix by rows here transposes the rotation, which turns a 90 degree turn
    # into its opposite -- exactly the bug this replaces.
    m00, m10, m20, m30 = matrix[0][0], matrix[1][0], matrix[2][0], matrix[3][0]
    m01, m11, m21, m31 = matrix[0][1], matrix[1][1], matrix[2][1], matrix[3][1]
    m02, m12, m22, m32 = matrix[0][2], matrix[1][2], matrix[2][2], matrix[3][2]
    current = None
    points: list = []
    with zf.open(member) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
            s = line.lstrip()
            if current is None:
                if s.startswith("<object"):
                    oid = _attr(_tag_attrs(s), "id")
                    current = str(oid) if oid is not None and str(oid) in wanted else None
                    points = []
                    if "</object>" in s:
                        current = None
                continue
            if s.startswith("<vertex"):
                m = u1.VERTEX_RE.search(s)
                if m is None:
                    continue
                x, y, z = (float(m.group(i + 1)) for i in range(3))
                points.append((
                    x * m00 + y * m10 + z * m20 + m30,
                    x * m01 + y * m11 + z * m21 + m31,
                    x * m02 + y * m12 + z * m22 + m32,
                ))
                continue
            if not _is_triangle(s):
                if s.startswith("</object>"):
                    current = None
                    points = []
                continue
            keep = cursor["seen"] % stride == 0
            cursor["seen"] += 1
            if not keep:
                continue
            m = TRI_RE.search(s)
            if m is None:
                continue
            ids = [int(m.group(i)) for i in (1, 2, 3)]
            if any(index >= len(points) for index in ids):
                continue
            state = base_state
            paint = u1.PAINT_RE.search(s)
            if paint is not None and paint.group(1):
                try:
                    node = u1paint.decode(paint.group(1))
                except u1paint.PaintError:
                    stats["unknown"] += 1
                    out_states.append(-1)
                    for index in ids:
                        out_positions.extend(points[index])
                    continue
                if node[0] == "leaf":
                    # State 0 means "no override": the facet prints in the part's
                    # own filament, which is what the export writes for it.
                    state = int(node[1]) or base_state
                else:
                    stats["subdivided"] += 1
                    leaves = [leaf or base_state for leaf in u1paint.walk_states(node)]
                    if leaves:
                        state = max(set(leaves), key=leaves.count)
            # No paint attribute at all is unpainted geometry: also the base.
            out_states.append(state)
            for index in ids:
                out_positions.extend(points[index])
            stats["triangles"] += 1


def soup(zf, project, selection, palette: dict, mapping: dict | None = None,
         limit: int = DEFAULT_LIMIT) -> dict:
    """{'positions': base64, 'colors': base64, 'triangles': n, ...} for the page."""
    import u1project as u1p

    # No mapping means "show the file's own colours": every source state stays what
    # it is, so the palette the caller passes is the source palette.
    remap = None if mapping is None else {int(k): int(v) for k, v in mapping.items()}
    positions: list = []
    states: list = []
    stats = {"triangles": 0, "subdivided": 0, "unknown": 0, "truncated": False}
    parts: list = []
    for object_id, item_transform in u1p.selection_instances(project, selection):
        meta = project.meta.get(str(object_id))
        object_base = (meta.extruder if meta is not None and meta.extruder
                       else None) or project.base_extruder
        obj = project.objects.get(str(object_id))
        parts_meta = u1p.match_parts(meta, [str(c.objectid) for c in obj.components]) \
            if obj is not None else []
        for member, oid, matrix, index in u1p.instance_chain(zf, project, object_id,
                                                             item_transform):
            # Each part keeps its own filament; the object's only applies where the
            # part says nothing, exactly as the export resolves it.
            base = object_base
            part = (parts_meta[index] if index is not None and index < len(parts_meta)
                    else None)
            if part is not None:
                if u1p.is_hidden_role(part.subtype):
                    continue
                base = part.extruder or object_base
            parts.append((member, str(oid), matrix, base))

    # One stride for the whole selection: an even sample of *all* the triangles the
    # picture stands for, rather than the first `limit` of them.
    total = 0
    for member, oid, _matrix, _base in parts:
        inner = u1p.inner_object(zf, project, member, oid)
        total += inner.triangles if inner is not None else 0
    stride = max(1, -(-total // max(1, limit)))
    cursor = {"seen": 0}
    for member, oid, matrix, base in parts:
        _facet_states(zf, member, {oid}, matrix, base, stride, cursor,
                      positions, states, stats)
    stats["truncated"] = stride > 1
    stats["stride"] = stride
    stats["total"] = total

    colours: list = []
    for state in states:
        if state < 0:
            channels = colour_floats(UNKNOWN_COLOUR)
        else:
            target = state if (state == 0 or remap is None) else remap.get(state, state)
            if target == 0:
                target = 1
            channels = colour_floats(palette.get(target) or "#FFFFFF")
        # One colour per vertex: the three corners of a facet share its colour, so
        # the buffer lines up with the position buffer (9 floats per facet).
        for _corner in range(3):
            colours.extend(channels)

    return {
        "positions": base64.b64encode(struct.pack("<%df" % len(positions),
                                                  *positions)).decode("ascii"),
        "colors": base64.b64encode(struct.pack("<%df" % len(colours),
                                               *colours)).decode("ascii"),
        "triangles": len(states),
        "subdivided": stats["subdivided"],
        "unknown_paint": stats["unknown"],
        "truncated": stats["truncated"],
        "sampled": stats["truncated"],
        "stride": stats.get("stride", 1),
        "total": stats.get("total", len(states)),
        "limit": limit,
        "floats": len(positions),
    }
