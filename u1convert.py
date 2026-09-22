#!/usr/bin/env python3
"""
u1convert.py -- turn a 3MF model into a Snapmaker U1 project for Snapmaker Orca.

Two container flavours are understood:

  * PrusaSlicer / PrusaSlicer-derived projects (this is what Printables ships and
    what OrcaSlicer writes when it saves in "Slic3r PE" format):
        Metadata/Slic3r_PE.config, Metadata/Slic3r_PE_model.config, 3D/3dmodel.model
  * Bambu Studio / OrcaSlicer projects:
        Metadata/project_settings.config, Metadata/model_settings.config, ...

Why a converter is needed at all
--------------------------------
PrusaSlicer, Bambu Studio and OrcaSlicer share one code base, so the bitstream that
describes painted triangles is byte-for-byte the same.  What differs is the *name* of
the XML attribute that carries it:

        Prusa  : slic3rpe:mmu_segmentation  ->  Bambu/Orca : paint_color
        Prusa  : slic3rpe:custom_supports   ->  Bambu/Orca : paint_supports
        Prusa  : slic3rpe:custom_seam       ->  Bambu/Orca : paint_seam
        Prusa  : slic3rpe:fuzzy_skin        ->  Bambu/Orca : paint_fuzzy_skin

Snapmaker Orca reads projects with the Bambu reader, which only looks for the Bambu
names.  A Prusa project opened directly -- or a Prusa model file copied into a Bambu
container, which is what naive converters do -- therefore loses every painted
triangle and collapses to one colour.  This tool renames the attributes, so the paint
survives untouched, and additionally rebuilds the printer/process/filament settings
for the U1 and places the object on the U1 bed.

Usage
-----
    python u1convert.py "model.3mf"
    python u1convert.py "model.3mf" -o out.3mf --colors "#FF8000,#008000,#000000,#FFFFFF"
    python u1convert.py --list-filaments
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile

# --------------------------------------------------------------------------------------
# constants
# --------------------------------------------------------------------------------------

MODEL_FILE = "3D/3dmodel.model"
MODEL_RELS = "3D/_rels/3dmodel.model.rels"
OBJECTS_DIR = "3D/Objects/"

SRC_PRUSA_MODEL = "Metadata/Slic3r_PE_model.config"
SRC_PRUSA_PRINT = "Metadata/Slic3r_PE.config"
SRC_BBL_PROJECT = "Metadata/project_settings.config"
SRC_BBL_MODEL = "Metadata/model_settings.config"

OUT_OBJECT_ID = 5           # id used for the object in 3dmodel.model / model_settings.config
TARGET_SLOTS = 4            # U1 tool heads

# Orca warns "Model too close to bed boundary ... keep at least 3.5mm gap to avoid
# collision" when a model sits closer than that to the plate edge, because spiral
# lifting can swing the toolhead into the frame.  The brim is part of the printed
# footprint, so it is added on top of this rather than counted inside it.
BED_MARGIN = 4.0

PAINT_ATTRS = (
    ("slic3rpe:mmu_segmentation", "paint_color"),
    ("slic3rpe:custom_supports", "paint_supports"),
    ("slic3rpe:custom_seam", "paint_seam"),
    ("slic3rpe:fuzzy_skin", "paint_fuzzy_skin"),
)

DEFAULT_MACHINE = "Snapmaker U1 (0.4 nozzle)"
DEFAULT_PROCESS = "0.20mm Standard @Snapmaker U1 (0.4 nozzle)"
DEFAULT_FILAMENT = "Snapmaker PLA Basic @U1"

DEFAULT_ORCA_DIRS = [
    r"C:\Program Files\Snapmaker_Orca",
    r"C:\Program Files\OrcaSlicer",
    "/Applications/Snapmaker_Orca.app/Contents/Resources",
    "/Applications/OrcaSlicer.app/Contents/Resources",
    os.path.expanduser("~/.config/Snapmaker_Orca"),
    os.path.expanduser("~/.config/OrcaSlicer"),
]

XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'


class ConvertError(RuntimeError):
    pass


LOG_SINK = None  # assign a callable to capture progress instead of printing


def log(msg: str) -> None:
    if LOG_SINK is not None:
        LOG_SINK(msg)
    else:
        print(msg, flush=True)


# --------------------------------------------------------------------------------------
# painted-triangle bitstream
#
# One node per original triangle, serialised least-significant-bit first:
#   2 bits : number of split sides (0 = leaf triangle)
#   leaf, state 0..2 : 2 more bits holding the state
#   leaf, state 3..17: the prefix 0b11 then a nibble holding state-3
# The whole stream is emitted as hex; the value of the hex literal, read
# low-bit-first, is the bit stream (so a 4-bit leaf is one hex character and an
# 8-bit leaf is two).
# --------------------------------------------------------------------------------------

def hex_to_bits(text: str) -> list[int]:
    if not text or not re.fullmatch(r"[0-9A-Fa-f]+", text):
        return []
    value = int(text, 16)
    return [(value >> i) & 1 for i in range(4 * len(text))]


def bits_to_hex(bits: list[int]) -> str:
    value = sum(b << i for i, b in enumerate(bits))
    digits = max(1, len(bits) // 4)
    return "%0*X" % (digits, value)


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
        return 0                      # state >= 18, two-nibble form
    return 3 + nib


def encode_leaf_state(state: int) -> str:
    bits = [0, 0]
    if state < 3:
        bits += [state & 1, (state >> 1) & 1]
    else:
        bits += [1, 1] + [((state - 3) >> i) & 1 for i in range(4)]
    return bits_to_hex(bits)


# --------------------------------------------------------------------------------------
# affine helpers -- 4x4 row matrices, point' = point * M (3MF / PrusaSlicer convention)
# --------------------------------------------------------------------------------------

IDENTITY = [[1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]]


def matrix_from_text(text: str) -> list[list[float]]:
    """Parse either matrix flavour into one internal row-vector 4x4 (p' = p * M).

    The two containers disagree about where the translation lives, and getting it
    wrong silently scales the model:

      * a 3MF <item transform> / <component transform> is a 4x3 matrix listed
        row-major with the *last row* holding the translation;
      * the 'matrix' metadata PrusaSlicer and Bambu write for a volume/part is a
        4x4 listed row-major with the translation in the *last column*, i.e. the
        conventional p' = M * p form.

    The 4x4 form is therefore the transpose of what the internal representation
    wants.
    """
    vals = [float(v) for v in text.split()]
    if len(vals) == 12:
        return [[vals[0], vals[1], vals[2], 0.0],
                [vals[3], vals[4], vals[5], 0.0],
                [vals[6], vals[7], vals[8], 0.0],
                [vals[9], vals[10], vals[11], 1.0]]
    if len(vals) == 16:
        rows = [vals[0:4], vals[4:8], vals[8:12], vals[12:16]]
        return [[rows[c][r] for c in range(4)] for r in range(4)]
    raise ConvertError(f"unsupported transform ({len(vals)} numbers): {text!r}")


def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def apply(m, p):
    x, y, z = p
    return (x * m[0][0] + y * m[1][0] + z * m[2][0] + m[3][0],
            x * m[0][1] + y * m[1][1] + z * m[2][1] + m[3][1],
            x * m[0][2] + y * m[1][2] + z * m[2][2] + m[3][2])


def transform_3mf_text(m) -> str:
    """Serialise back to the 4x3 form a 3MF <item transform=...> expects."""
    vals = (m[0][0], m[0][1], m[0][2],
            m[1][0], m[1][1], m[1][2],
            m[2][0], m[2][1], m[2][2],
            m[3][0], m[3][1], m[3][2])
    return " ".join("%.9g" % v for v in vals)


# --------------------------------------------------------------------------------------
# Snapmaker Orca profiles
# --------------------------------------------------------------------------------------

def find_profile_root(explicit: str | None = None) -> str:
    candidates = []
    if explicit:
        candidates.append(explicit)
    for base in DEFAULT_ORCA_DIRS:
        candidates.append(os.path.join(base, "resources", "profiles"))
        candidates.append(os.path.join(base, "profiles"))
    for cand in candidates:
        if cand and os.path.isdir(os.path.join(cand, "Snapmaker", "machine")):
            return cand
    raise ConvertError(
        "Could not locate the Snapmaker Orca profiles directory. "
        "Point at it with --profile-dir, e.g.\n"
        r'  --profile-dir "C:\Program Files\Snapmaker_Orca\resources\profiles"'
    )


class Profiles:
    KINDS = ("machine", "process", "filament")

    def __init__(self, root: str):
        self.root = root
        self.by_kind: dict[str, dict[str, dict]] = {k: {} for k in self.KINDS}
        for vendor in sorted(os.listdir(root)):
            vdir = os.path.join(root, vendor)
            if not os.path.isdir(vdir):
                continue
            for kind in self.KINDS:
                kdir = os.path.join(vdir, kind)
                if not os.path.isdir(kdir):
                    continue
                for entry in sorted(os.listdir(kdir)):
                    if not entry.endswith(".json"):
                        continue
                    try:
                        # Orca's preset files are frequently UTF-8 with a BOM
                        with open(os.path.join(kdir, entry), "r", encoding="utf-8-sig") as fh:
                            data = json.load(fh)
                    except Exception:
                        continue
                    name = data.get("name")
                    if isinstance(name, str) and name:
                        # Snapmaker's own vendor folder is scanned last alphabetically,
                        # so give it priority explicitly.
                        if vendor == "Snapmaker":
                            self.by_kind[kind][name] = data
                        else:
                            self.by_kind[kind].setdefault(name, data)
        self._cache: dict[tuple[str, str], dict] = {}

    _SKIP = {
        "inherits", "type", "name", "instantiation", "description", "from",
        "compatible_printers", "compatible_printers_condition", "compatible_prints",
        "compatible_prints_condition", "is_custom_defined", "setting_id",
    }

    def resolve(self, kind: str, name: str) -> dict:
        cached = self._cache.get((kind, name))
        if cached is not None:
            return cached
        chain: list[dict] = []
        seen: set[str] = set()
        cur: str | None = name
        while cur:
            if cur in seen:
                raise ConvertError(f"circular 'inherits' resolving {kind} profile {name!r}")
            seen.add(cur)
            prof = self.by_kind[kind].get(cur)
            if prof is None:
                if not chain:
                    raise ConvertError(f"{kind} profile {name!r} not found under {self.root}")
                log(f"  note: {kind} parent {cur!r} not found, chain stops there")
                break
            chain.append(prof)
            parent = prof.get("inherits")
            cur = parent if isinstance(parent, str) else None

        merged: dict = {}
        for prof in reversed(chain):
            for key, val in prof.items():
                if key in self._SKIP:
                    continue
                merged[key] = val
        self._cache[(kind, name)] = merged
        return merged

    def has(self, kind: str, name: str) -> bool:
        return name in self.by_kind[kind]

    def find(self, kind: str, *needles: str) -> str | None:
        """First profile whose name contains every needle (case insensitive)."""
        for name in sorted(self.by_kind[kind]):
            if all(n.lower() in name.lower() for n in needles):
                return name
        return None

    def matching(self, kind: str, *needles: str) -> list[str]:
        return [n for n in sorted(self.by_kind[kind])
                if all(x.lower() in n.lower() for x in needles)]

    def u1_filaments(self) -> list[str]:
        out = []
        for name, data in self.by_kind["filament"].items():
            if str(data.get("instantiation", "true")).lower() == "false":
                continue
            if "base" in name.lower():      # abstract parents, not selectable
                continue
            if "U1" in json.dumps(data.get("compatible_printers", [])):
                out.append(name)
        return sorted(out)


# --------------------------------------------------------------------------------------
# reading the source
# --------------------------------------------------------------------------------------

def parse_prusa_ini(text: str) -> dict[str, str]:
    out = {}
    for line in text.splitlines():
        m = re.match(r"^;\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def split_list(value: str) -> list[str]:
    return [v.strip() for v in (value or "").split(";")]


def norm_color(color: str) -> str:
    c = (color or "").strip().lstrip("#").upper()
    if len(c) == 8:
        c = c[:6]
    if len(c) != 6:
        return ""
    try:
        int(c, 16)
    except ValueError:
        return ""
    return "#" + c


class Source:
    def __init__(self):
        self.kind = "plain"
        self.colors: list[str] = []
        self.types: list[str] = []
        self.palette_count = 0
        self.palette_source = ""
        self.base_extruder = 1
        self.used_extruders: set[int] = set()
        self.paint_states: dict[int, int] = {}
        self.paint_undecodable = False
        self.subdivided = 0
        self.mesh_bounds = None
        self.preview = None
        self.preview_from = ""
        self.plate_objects = 0
        self.source_settings = None
        self.support = None
        self.layer_height = None
        self.volume_matrix = [row[:] for row in IDENTITY]
        self.build_transform = "1 0 0 0 1 0 0 0 1 0 0 0"
        self.placement = None
        self.mesh_file = None
        self.object_name = "object"
        self.source_file = ""

    def color_for(self, extruder: int) -> str:
        if 1 <= extruder <= len(self.colors) and self.colors[extruder - 1]:
            return self.colors[extruder - 1]
        return "#FFFFFF"

    def type_for(self, extruder: int) -> str:
        if 1 <= extruder <= len(self.types) and self.types[extruder - 1]:
            return self.types[extruder - 1]
        return "PLA"


def scan_model(zf: zipfile.ZipFile, name: str) -> dict:
    """Single streaming pass over a .model file: paint histogram + build placement.

    The <build> element sits *after* the mesh, so the whole file has to be walked.
    """
    result = {
        "states": {},
        "undecodable": 0,
        "painted": 0,
        "supports": False,
        "transform": None,
        "lo": [float("inf")] * 3,
        "hi": [float("-inf")] * 3,
    }
    pattern = re.compile(r'mmu_segmentation="([0-9A-Fa-f]*)"|paint_color="([0-9A-Fa-f]*)"')
    item_re = re.compile(r'<item\b[^>]*transform="([^"]*)"')

    with zf.open(name) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
            if result["transform"] is None and "<item" in line:
                m = item_re.search(line)
                if m:
                    result["transform"] = m.group(1)
            if "<vertex" in line:
                m = VERTEX_RE.search(line)
                if m:
                    for i in range(3):
                        v = float(m.group(i + 1))
                        if v < result["lo"][i]:
                            result["lo"][i] = v
                        if v > result["hi"][i]:
                            result["hi"][i] = v
                continue
            has_ml = "mmu_segmentation" in line
            has_pc = "paint_color" in line
            if has_ml or has_pc:
                if "custom_supports" in line or "paint_supports" in line:
                    result["supports"] = True
                for m in pattern.finditer(line):
                    text = m.group(1) or m.group(2) or ""
                    if not text:
                        continue
                    result["painted"] += 1
                    state = decode_leaf_state(text)
                    if state:
                        result["states"][state] = result["states"].get(state, 0) + 1
                    else:
                        result["undecodable"] += 1
            elif "custom_supports" in line or "paint_supports" in line:
                result["supports"] = True
    return result


def _has_mesh(zf: zipfile.ZipFile, name: str) -> bool:
    with zf.open(name) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
            s = line.lstrip()
            if s.startswith("<mesh"):
                return True
            if s.startswith("</resources") or s.startswith("<build"):
                return False
    return False


def locate_mesh(zf: zipfile.ZipFile) -> str:
    """Archive member that actually holds the triangles.

    PrusaSlicer keeps the mesh inline in 3D/3dmodel.model.  Bambu Studio and Orca
    split it into 3D/Objects/*.model and reference it from <components>, which is
    what you get as soon as a project is saved by Orca.
    """
    if _has_mesh(zf, MODEL_FILE):
        return MODEL_FILE
    candidates = [n for n in zf.namelist()
                  if n.startswith(OBJECTS_DIR) and n.endswith(".model")]
    with_mesh = [n for n in candidates if _has_mesh(zf, n)]
    if not with_mesh:
        raise ConvertError("no triangle mesh found in the archive")
    if len(with_mesh) > 1:
        raise ConvertError(
            f"the archive holds {len(with_mesh)} meshes; only single-object models "
            "are supported")
    return with_mesh[0]


def _xml_pairs(text: str, tag: str):
    return re.findall(r"<%s\b[^>]*?/?>" % tag, text)


def _attr(tag_text: str, name: str):
    m = re.search(r'\b%s="([^"]*)"' % name, tag_text)
    return m.group(1) if m else None


def read_source(zf: zipfile.ZipFile) -> Source:
    names = set(zf.namelist())
    if SRC_PRUSA_MODEL in names:
        src = _read_prusa(zf)
    elif SRC_BBL_PROJECT in names:
        src = _read_bambu(zf)
    elif MODEL_FILE in names:
        src = Source()
        src.colors = ["#FFFFFF"]
        src.types = ["PLA"]
        src.palette_count = 1
    else:
        raise ConvertError("not a 3MF archive (3D/3dmodel.model is missing)")

    src.mesh_file = locate_mesh(zf)

    paint = scan_model(zf, src.mesh_file)
    src.paint_states = paint["states"]
    src.paint_undecodable = paint["undecodable"] > 0
    src.subdivided = paint["undecodable"]
    src.paint_count = paint["painted"]
    src.has_supports = paint["supports"]
    if paint["lo"][0] != float("inf"):
        src.mesh_bounds = (tuple(paint["lo"]), tuple(paint["hi"]))

    if src.mesh_file == MODEL_FILE:
        placement_scan = paint
    else:
        placement_scan = scan_model(zf, MODEL_FILE)
    if placement_scan["transform"]:
        src.build_transform = placement_scan["transform"]

    src.placement = _source_placement(zf, src)

    # Preview image, so the output shows a thumbnail in Explorer and Orca rather
    # than a generic icon. Prefer the plate render Bambu/Orca write, and fall back
    # to PrusaSlicer's model thumbnail.
    names = set(zf.namelist())
    for name in ("Metadata/plate_1.png", "Metadata/thumbnail.png", "Metadata/top_1.png"):
        if name in names:
            src.preview = zf.read(name)
            src.preview_from = name
            break

    return src


def _source_placement(zf: zipfile.ZipFile, src: Source):
    """world = local * part-matrix * component-transform * build-item-transform."""
    item = matrix_from_text(src.build_transform)
    if src.kind == "prusa":
        # PrusaSlicer stores the volume transform in Slic3r_PE_model.config
        return matmul(src.volume_matrix, item)

    doc = zf.read(MODEL_FILE).decode("utf-8", "replace")

    def component_path(object_id: str):
        """The mesh file an object's single component points at, if any."""
        for m in re.finditer(r'<object\b([^>]*)>(.*?)</object>', doc, re.S):
            if _attr("<object " + m.group(1), "id") == object_id:
                comps = _xml_pairs(m.group(2), "component")
                return _attr(comps[0], "p:path") if comps else None
        return None

    items = _xml_pairs(doc, "item")
    if not items:
        raise ConvertError("the project has no objects on the plate")

    # A plate of several objects is fine as long as they are all the same mesh:
    # that is a MakerWorld-style download, or a plate someone arranged and saved.
    # The first placement carries the scale and orientation, and the rest are
    # rebuilt from the copies/spacing controls, so the result is consistent with
    # the single-object path. Several *different* models still cannot be handled.
    paths = {component_path(_attr(it, "objectid") or "") for it in items}
    if len(paths) > 1 or None in paths:
        raise ConvertError(
            f"the project places {len(items)} objects on the plate and they are not "
            "all the same model; only plates built from one repeated mesh are "
            "supported")

    src.plate_objects = len(items)
    obj_id = _attr(items[0], "objectid")
    item_tf = _attr(items[0], "transform")

    comp_tf = None
    for m in re.finditer(r'<object\b([^>]*)>(.*?)</object>', doc, re.S):
        if _attr("<object " + m.group(1), "id") == obj_id:
            comps = _xml_pairs(m.group(2), "component")
            if len(comps) != 1:
                raise ConvertError(
                    f"the object is built from {len(comps)} component(s); only "
                    "single-part objects are supported")
            comp_tf = _attr(comps[0], "transform")
            break

    part_tf = None
    if SRC_BBL_MODEL in zf.namelist():
        ms = zf.read(SRC_BBL_MODEL).decode("utf-8", "replace")
        for m in re.finditer(r'<object\b([^>]*)>(.*?)</object>', ms, re.S):
            if _attr("<object " + m.group(1), "id") == obj_id:
                parts = _xml_pairs(m.group(2), "part")
                if len(parts) != 1:
                    raise ConvertError(
                        f"the object has {len(parts)} parts; only single-part "
                        "objects are supported")
                mm = re.search(r'key="matrix"\s+value="([^"]*)"', parts[0])
                if not mm:
                    mm = re.search(r'key="matrix"\s+value="([^"]*)"', m.group(2))
                if mm:
                    part_tf = mm.group(1)
                break

    out = matrix_from_text(part_tf) if part_tf else [r[:] for r in IDENTITY]
    if comp_tf:
        out = matmul(out, matrix_from_text(comp_tf))
    if item_tf:
        out = matmul(out, matrix_from_text(item_tf))
    return out


def _read_prusa(zf: zipfile.ZipFile) -> Source:
    src = Source()
    src.kind = "prusa"
    cfg = parse_prusa_ini(zf.read(SRC_PRUSA_PRINT).decode("utf-8", "replace"))
    src.source_settings = cfg

    tool_colors = [norm_color(c) for c in split_list(cfg.get("extruder_colour", ""))]
    fil_colors = [norm_color(c) for c in split_list(cfg.get("filament_colour", ""))]
    types = [t.strip().upper() for t in split_list(cfg.get("filament_type", ""))]

    def uniform(cols):
        real = [c for c in cols if c]
        return len(set(real)) <= 1

    # Painted files that started life as a plain mesh routinely carry a placeholder
    # filament_colour (the same colour in every slot).  The tool colours are the ones
    # that actually describe the painted model, so prefer them when they differ.
    if tool_colors and not uniform(tool_colors):
        palette, why = tool_colors, "extruder_colour"
    elif fil_colors and not uniform(fil_colors):
        palette, why = fil_colors, "filament_colour"
    else:
        palette, why = (tool_colors or fil_colors or ["#FFFFFF"]), "fallback"
    log(f"palette      : {len(palette)} slots from {why}")

    src.colors = palette
    src.palette_source = why
    src.types = types or ["PLA"] * len(palette)
    src.palette_count = max(len(src.colors), len(src.types))
    src.support = prusa_support(cfg)
    src.layer_height = _as_float(cfg.get("layer_height"))

    blob = zf.read(SRC_PRUSA_MODEL).decode("utf-8", "replace")
    objects = re.findall(r"<object\b[^>]*>(.*?)</object>", blob, re.S)
    if len(objects) != 1:
        raise ConvertError(
            f"the project holds {len(objects)} objects; only single-object "
            "PrusaSlicer projects are supported"
        )
    body = objects[0]
    name_m = re.search(r'key="name"\s+value="([^"]*)"', body)
    ext_m = re.search(r'<metadata type="object" key="extruder" value="(\d+)"', body)
    src.object_name = os.path.splitext(name_m.group(1))[0] if name_m else "object"
    src.base_extruder = int(ext_m.group(1)) if ext_m else 1

    volumes = re.findall(r"<volume\b([^>]*)>(.*?)</volume>", body, re.S)
    if len(volumes) > 1:
        raise ConvertError(
            f"the object holds {len(volumes)} volumes; only single-volume objects "
            "are supported"
        )
    if volumes:
        vol_body = volumes[0][1]
        src_m = re.search(r'key="source_file"\s+value="([^"]*)"', vol_body)
        if src_m:
            src.source_file = src_m.group(1)
        mat_m = re.search(r'key="matrix"\s+value="([^"]*)"', vol_body)
        if mat_m:
            try:
                src.volume_matrix = matrix_from_text(mat_m.group(1))
            except ConvertError:
                src.volume_matrix = [row[:] for row in IDENTITY]
    return src


def _read_bambu(zf: zipfile.ZipFile) -> Source:
    src = Source()
    src.kind = "bambu"
    cfg = json.loads(zf.read(SRC_BBL_PROJECT).decode("utf-8", "replace"))
    src.source_settings = cfg
    src.colors = [norm_color(c) for c in cfg.get("filament_colour", [])]
    src.types = [str(t).upper() for t in cfg.get("filament_type", [])]
    src.palette_count = max(len(src.colors), len(src.types))
    src.support = bambu_support(cfg)
    src.layer_height = _as_float(_first_scalar(cfg, "layer_height"))

    names = set(zf.namelist())
    if SRC_BBL_MODEL in names:
        blob = zf.read(SRC_BBL_MODEL).decode("utf-8", "replace")
        m = re.search(r'key="name"\s+value="([^"]*)"', blob)
        if m:
            src.object_name = os.path.splitext(m.group(1))[0]
        # the object's own extruder: look inside the object block rather than
        # requiring it to be the first metadata, since Orca writes "name" first
        block = re.search(r"<object\b[^>]*>(.*?)</object>", blob, re.S)
        if block:
            ext = re.search(r'key="extruder"\s+value="(\d+)"', block.group(1))
            if ext:
                src.base_extruder = int(ext.group(1))
        used = {int(v) for v in re.findall(r'key="extruder" value="(\d+)"', blob)}
        src.used_extruders = {u for u in used if u >= 1}
    return src


# --------------------------------------------------------------------------------------
# writing the output
# --------------------------------------------------------------------------------------

def esc(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))


def new_uuid() -> str:
    return str(uuid.uuid4())


def content_types_xml() -> str:
    return (XML_HEADER
            + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
              ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
              ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
              ' <Default Extension="png" ContentType="image/png"/>\n'
              ' <Default Extension="gcode" ContentType="text/x.gcode"/>\n'
              "</Types>\n")


def root_rels_xml() -> str:
    return (XML_HEADER
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
              f' <Relationship Target="/{MODEL_FILE}" Id="rel-1" '
              'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
              "</Relationships>\n")


def model_rels_xml(object_file: str) -> str:
    return (XML_HEADER
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
              f' <Relationship Target="/{object_file}" Id="rel-1" '
              'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
              "</Relationships>\n")


def main_model_xml(object_file: str, title: str, transforms: list[str]) -> str:
    """One <object> per copy, all sharing the same mesh, rather than one object
    with N instances.

    Orca rejects a plate of *instances* with "gcode path conflicts found between
    WipeTower and ..." for layouts it accepts when the copies are separate
    objects -- its conflict checker appears not to place the copies correctly when
    they are instances of a single object, so every copy piles up in the check and
    the tower hits them. Writing them out as objects matches what Orca itself does
    when you copy a model, and the plate then slices.
    """
    n = max(1, len(transforms))
    resources = []
    for k in range(n):
        resources.append(
            f'  <object id="{OUT_OBJECT_ID + k}" p:UUID="{new_uuid()}" type="model">\n'
            "   <components>\n"
            f'    <component p:path="/{esc(object_file)}" objectid="1" '
            f'p:UUID="{new_uuid()}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n'
            "   </components>\n"
            "  </object>\n")
    items = "".join(
        f'  <item objectid="{OUT_OBJECT_ID + k}" p:UUID="{new_uuid()}" '
        f'transform="{tf}" printable="1"/>\n'
        for k, tf in enumerate(transforms)
    )
    return (XML_HEADER
            + '<model unit="millimeter" xml:lang="en-US" '
              'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
              'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
              'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" '
              'requiredextensions="p">\n'
              ' <metadata name="Application">Snapmaker Orca</metadata>\n'
              ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n'
              f' <metadata name="Title">{esc(title)}</metadata>\n'
              " <resources>\n"
            + "".join(resources)
            + " </resources>\n"
              f' <build p:UUID="{new_uuid()}">\n'
            + items
            + " </build>\n"
              "</model>\n")


def model_settings_xml(name: str, extruder: int, source_file: str, count: int = 1) -> str:
    # One entry per copy, matching the objects in 3dmodel.model.
    # No <plate> block: Orca maps build items onto the first plate by itself, and a
    # plate whose model_instance id does not line up with the model's object indices
    # makes the Bambu reader dereference out of bounds.
    entries = []
    for k in range(max(1, count)):
        entries.append(
            f'  <object id="{OUT_OBJECT_ID + k}">\n'
            f'    <metadata key="name" value="{esc(name)}"/>\n'
            f'    <metadata key="extruder" value="{extruder}"/>\n'
            '    <part id="1" subtype="normal_part">\n'
            f'      <metadata key="name" value="{esc(source_file or name + ".stl")}"/>\n'
            '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n'
            f'      <metadata key="source_file" value="{esc(source_file or name)}"/>\n'
            '      <metadata key="source_object_id" value="0"/>\n'
            '      <metadata key="source_volume_id" value="0"/>\n'
            f'      <metadata key="extruder" value="{extruder}"/>\n'
            '      <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" '
            'facets_reversed="0" backwards_edges="0"/>\n'
            "    </part>\n"
            "  </object>\n")
    return XML_HEADER + "<config>\n" + "".join(entries) + "</config>\n"


def slice_info_xml() -> str:
    return (XML_HEADER
            + "<config>\n"
              "  <header>\n"
              '    <header_item key="X-BBL-Client-Type" value="slicer"/>\n'
              '    <header_item key="X-BBL-Client-Version" value=""/>\n'
              "  </header>\n"
              "</config>\n")


def object_file_open() -> str:
    return (XML_HEADER
            + '<model unit="millimeter" xml:lang="en-US" '
              'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
              'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
              'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" '
              'requiredextensions="p">\n'
              ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n'
              " <resources>\n"
              f'  <object id="1" p:UUID="{new_uuid()}" type="model">\n'
              "   <mesh>\n")


def object_file_close() -> str:
    return ("   </mesh>\n"
            "  </object>\n"
            " </resources>\n"
            " <build/>\n"
            "</model>\n")


VERTEX_RE = re.compile(r'<vertex x="([-0-9.eE+]+)" y="([-0-9.eE+]+)" z="([-0-9.eE+]+)"')
# The namespace prefix has to be part of the match, otherwise the rename would leave
# it behind and produce "slic3rpe:paint_color", which the reader does not recognise.
PAINT_RE = re.compile(r'(?:slic3rpe:)?mmu_segmentation="([0-9A-Fa-f]*)"')


def copy_mesh(zf: zipfile.ZipFile, src_name: str, out, mapping: dict[int, int], stats: dict):
    """Stream the <mesh> block through, renaming paint attributes (and remapping states)."""
    in_mesh = False
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    triangles = 0
    repaint = {k: v for k, v in mapping.items() if k != v}

    def rename_paint(m):
        text = m.group(1)
        if repaint:
            state = decode_leaf_state(text)
            if state in repaint:
                return 'paint_color="%s"' % encode_leaf_state(repaint[state])
        return 'paint_color="%s"' % text

    with zf.open(src_name) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
            stripped = line.lstrip()
            if not in_mesh:
                if stripped.startswith("<mesh"):
                    in_mesh = True
                continue
            if stripped.startswith("</mesh"):
                break
            if stripped.startswith("<vertex"):
                m = VERTEX_RE.search(line)
                if m:
                    for i in range(3):
                        v = float(m.group(i + 1))
                        lo[i] = min(lo[i], v)
                        hi[i] = max(hi[i], v)
            elif stripped.startswith("<triangle ") or stripped.startswith("<triangle>"):
                # note the space/close: "<triangles>" is the container, not a facet
                triangles += 1
                if "mmu_segmentation" in line:
                    line = PAINT_RE.sub(rename_paint, line)
                for old, new in PAINT_ATTRS[1:]:
                    if old in line:
                        line = line.replace(old + "=", new + "=")
            out.write(line.encode("utf-8"))

    if not in_mesh:
        raise ConvertError("no <mesh> found in the source model file")
    stats["lo"], stats["hi"], stats["triangles"] = tuple(lo), tuple(hi), triangles


# --------------------------------------------------------------------------------------
# project settings
# --------------------------------------------------------------------------------------

def load_base_template() -> dict:
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "u1_base_project_settings.json")
    if not os.path.isfile(path):
        return {}
    with open(path, "r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def build_project_config(base, profiles, colors, types, filament, machine, process) -> dict:
    cfg = dict(base)
    per_slot = {k for k, v in base.items() if isinstance(v, list) and len(v) == TARGET_SLOTS}

    def overlay(prof):
        for key, val in prof.items():
            if isinstance(val, list):
                if len(val) == TARGET_SLOTS:
                    cfg[key] = list(val)
                elif len(val) == 1 and key in per_slot:
                    cfg[key] = list(val) * TARGET_SLOTS
                else:
                    cfg[key] = list(val)
            else:
                cfg[key] = val

    if profiles is not None:
        overlay(profiles.resolve("machine", machine))
        overlay(profiles.resolve("process", process))
        overlay(profiles.resolve("filament", filament))

    colors = (list(colors) + ["#FFFFFF"] * TARGET_SLOTS)[:TARGET_SLOTS]
    types = (list(types) + ["PLA"] * TARGET_SLOTS)[:TARGET_SLOTS]
    cfg["filament_colour"] = [c + "FF" for c in colors]
    cfg["extruder_colour"] = list(colors)
    cfg["filament_type"] = types
    cfg["filament_settings_id"] = [filament] * TARGET_SLOTS
    cfg["printer_settings_id"] = machine
    cfg["printer_model"] = "Snapmaker U1"
    cfg["printer_variant"] = "0.4"
    cfg["nozzle_diameter"] = ["0.4"] * TARGET_SLOTS
    cfg["print_settings_id"] = process
    cfg["from"] = "project"

    # every per-extruder array must end up exactly TARGET_SLOTS long
    for key, val in list(cfg.items()):
        if key in per_slot and isinstance(val, list) and len(val) != TARGET_SLOTS:
            if len(val) == 1:
                cfg[key] = val * TARGET_SLOTS
            elif val:
                cfg[key] = (val * TARGET_SLOTS)[:TARGET_SLOTS]
    return cfg


def printable_bounds(cfg: dict):
    area = cfg.get("printable_area") or ["0.5x1", "270.5x1", "270.5x271", "0.5x271"]
    xs, ys = [], []
    for point in area:
        try:
            x, y = point.split("x")
            xs.append(float(x))
            ys.append(float(y))
        except Exception:
            continue
    if not xs:
        xs, ys = [0.5, 270.5], [1.0, 271.0]
    return min(xs), max(xs), min(ys), max(ys)


def _scan_bounds(stats: dict):
    lo, hi = stats.get("lo"), stats.get("hi")
    if not lo or not hi or lo[0] == float("inf") or hi[0] == float("-inf"):
        return None
    return (tuple(lo), tuple(hi))


def world_aabb(transform, lo, hi):
    corners = [(x, y, z) for x in (lo[0], hi[0])
               for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    pts = [apply(transform, c) for c in corners]
    return (tuple(min(p[i] for p in pts) for i in range(3)),
            tuple(max(p[i] for p in pts) for i in range(3)))


def place_on_bed(transform, bounds, cfg, enabled):
    """Centre one copy on the plate, but only when it would not fit as it stands."""
    if not enabled or bounds is None:
        return transform, False
    wlo, whi = world_aabb(transform, *bounds)

    ax0, ax1, ay0, ay1 = printable_bounds(cfg)
    if (wlo[0] >= ax0 - 1e-6 and whi[0] <= ax1 + 1e-6
            and wlo[1] >= ay0 - 1e-6 and whi[1] <= ay1 + 1e-6
            and wlo[2] >= -1e-3):
        return transform, False

    moved = [row[:] for row in transform]
    moved[3][0] += (ax0 + ax1) / 2.0 - (wlo[0] + whi[0]) / 2.0
    moved[3][1] += (ay0 + ay1) / 2.0 - (wlo[1] + whi[1]) / 2.0
    moved[3][2] += -wlo[2]
    return moved, True


def _first(cfg: dict, key: str, default=None):
    v = cfg.get(key, default)
    if isinstance(v, list):
        v = v[0] if v else default
    return v


def brim_allowance(cfg: dict) -> float:
    """How far a copy's brim reaches beyond its bounding box."""
    if str(_first(cfg, "brim_type", "")).strip().lower() in ("", "no_brim", "none"):
        return 0.0
    return max(0.0, _as_float(_first(cfg, "brim_width", 0)) or 0.0)


# Measured against a real slice: with prime_tower_width 30, brim 5 and the tower
# anchored at (13, 211), the tower's first layer covers x 3.3..50.2, y 201.3..248.8.
# So its footprint is a square of roughly width + 2*brim + 8 that starts a little
# before the configured point.
TOWER_ALLOWANCE = 8.0
TOWER_INSET = 5.0


def tower_box(cfg: dict, margin: float = 3.0):
    """Plate rectangle the prime tower occupies, or None if there is no tower.

    Orca anchors the tower at wipe_tower_x/y and refuses to slice when its
    toolpaths meet the model's ("gcode path conflicts found between WipeTower and
    ..."), so this has to be kept clear.
    """
    if str(_first(cfg, "enable_prime_tower", "0")).strip() in ("", "0", "false", "False"):
        return None
    tx = _as_float(_first(cfg, "wipe_tower_x"))
    ty = _as_float(_first(cfg, "wipe_tower_y"))
    if tx is None or ty is None:
        return None
    width = _as_float(_first(cfg, "prime_tower_width", 30)) or 30.0
    brim = _as_float(_first(cfg, "prime_tower_brim_width", 5)) or 5.0
    inset = TOWER_INSET + brim
    size = width + 2 * brim + TOWER_ALLOWANCE + 2 * margin
    return (tx - inset - margin, tx - inset - margin + size,
            ty - inset - margin, ty - inset - margin + size)


def layout_copies(transform, bounds, cfg, reposition, copies, gap, avoid_tower=True):
    """Lay the placed object out in a grid so it fills the plate.

    Spacing is measured between bounding boxes, which is conservative for a
    rotated model. Returns (transforms, cols, rows, capacity).

    Where the prime tower is concerned this deliberately errs on the side of
    caution: Orca computes the tower's footprint while slicing and it grows with
    the number of tool changes, so a copy that merely comes close to it can turn
    into a hard "gcode path conflicts" failure. Cells that fall inside the tower's
    reserve are dropped rather than nudged up against it.

    A single copy is deliberately left exactly where it was -- re-centring on a
    request for one copy would move models that already sit where the user wants.
    """
    base, _ = place_on_bed(transform, bounds, cfg, reposition)
    if bounds is None:
        return [base], 1, 1, 1

    ax0, ax1, ay0, ay1 = printable_bounds(cfg)
    bed_w, bed_h = ax1 - ax0, ay1 - ay0
    wlo, whi = world_aabb(base, *bounds)
    sx = max(whi[0] - wlo[0], 1e-3)
    sy = max(whi[1] - wlo[1], 1e-3)

    # Tree supports flare outwards at their base and reach past the model's bounding
    # box, so neighbouring copies collide there long before the models themselves
    # would. Orca reports it as "conflicts of G-code paths ... please separate the
    # conflicted objects farther". Grow the footprint by the support's reach so the
    # spacing still means what it says.
    # Only when supports are generated automatically. With "(manual)" they exist
    # only where the model was painted, which is inside the footprint already, so
    # inflating the footprint there just costs platespace.
    if (str(cfg.get("enable_support", "0")).strip() not in ("", "0")
            and "auto" in str(cfg.get("support_type", ""))):
        raw = cfg.get("tree_support_brim_width", 3)
        if isinstance(raw, list):
            raw = raw[0] if raw else 3
        try:
            reach = max(3.0, float(raw))
        except (TypeError, ValueError):
            reach = 3.0
        sx += 2 * reach
        sy += 2 * reach

    gap = max(0.0, float(gap))

    # a copy occupies its bounding box, its brim, and the clearance Orca wants
    pad = brim_allowance(cfg) + BED_MARGIN
    # Strip the margin before counting columns.  Counting against the whole bed
    # lets the block come out too wide to fit *with* the margin, and the fallback
    # below then centres it over the plate edge -- which is exactly what makes Orca
    # warn that a model is too close to the bed boundary.
    usable_w = max(0.0, bed_w - 2 * pad)
    usable_h = max(0.0, bed_h - 2 * pad)
    cols = max(1, int((usable_w + gap) // (sx + gap)))
    rows = max(1, int((usable_h + gap) // (sy + gap)))
    block_w = cols * sx + (cols - 1) * gap
    block_h = rows * sy + (rows - 1) * gap
    box = tower_box(cfg, margin=4.0) if avoid_tower else None

    def clashes(ox, oy):
        """How many grid cells sit on the tower, or None if the block leaves the plate."""
        if (ox - pad < ax0 - 1e-6 or ox + block_w + pad > ax1 + 1e-6
                or oy - pad < ay0 - 1e-6 or oy + block_h + pad > ay1 + 1e-6):
            return None
        if box is None:
            return 0
        bx0, bx1, by0, by1 = box
        bad = 0
        for j in range(rows):
            for i in range(cols):
                x = ox + i * (sx + gap)
                y = oy + j * (sy + gap)
                if not (x + sx + pad <= bx0 or x - pad >= bx1
                        or y + sy + pad <= by0 or y - pad >= by1):
                    bad += 1
        return bad

    origin_x = ax0 + max(0.0, (bed_w - block_w) / 2.0)
    origin_y = ay0 + max(0.0, (bed_h - block_h) / 2.0)

    # Slide the block aside to clear the prime tower rather than deleting the copies
    # that land on it. A hand-made 12-up plate for this model does the same thing --
    # same 5 mm grid, block shifted ~18 mm right -- and it previews and slices in
    # Orca. (An earlier version dropped those copies instead, losing two of twelve,
    # after a measurement mistake: the slicer's command line refuses on any
    # prime-tower path conflict using a stricter tower model than the GUI, so it was
    # saying "no" to plates Orca slices happily. See slices_cleanly.)
    if box is not None and clashes(origin_x, origin_y):
        best = None
        step = 1.0
        nx = int(max(0.0, bed_w - block_w - 2 * pad) / step)
        ny = int(max(0.0, bed_h - block_h - 2 * pad) / step)
        for jy in range(ny + 1):
            oy = ay0 + pad + jy * step
            for ix in range(nx + 1):
                ox = ax0 + pad + ix * step
                bad = clashes(ox, oy)
                if bad is None:
                    continue
                off = (abs(ox + block_w / 2 - (ax0 + ax1) / 2)
                       + abs(oy + block_h / 2 - (ay0 + ay1) / 2))
                if best is None or (bad, off) < best[0]:
                    best = ((bad, off), ox, oy)
        if best is not None and best[0][0] < clashes(origin_x, origin_y):
            origin_x, origin_y = best[1], best[2]

    cells = []
    for j in range(rows):
        for i in range(cols):
            x = origin_x + i * (sx + gap)
            y = origin_y + j * (sy + gap)
            if box is not None:
                bx0, bx1, by0, by1 = box
                if not (x + sx + pad <= bx0 or x - pad >= bx1
                        or y + sy + pad <= by0 or y - pad >= by1):
                    continue
            cells.append((i, j))

    capacity = max(1, len(cells))
    n = max(1, min(int(copies), capacity))
    if n <= 1:
        return [base], 1, 1, capacity

    used = cells[:n]
    out = []
    for i, j in used:
        t = [row[:] for row in base]
        t[3][0] += (origin_x + i * (sx + gap)) - wlo[0]
        t[3][1] += (origin_y + j * (sy + gap)) - wlo[1]
        out.append(t)
    return out, max(i for i, _ in used) + 1, max(j for _, j in used) + 1, capacity


# --------------------------------------------------------------------------------------
# conversion
# --------------------------------------------------------------------------------------

def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_scalar(cfg: dict, key: str):
    v = cfg.get(key)
    if isinstance(v, list):
        v = v[0] if v else None
    return v


def prusa_support(cfg: dict):
    """Translate PrusaSlicer's support options into the Orca ones.

    support_material_auto is the interesting one: 0 means "do not generate over
    overhangs, only where the model was painted", which is Orca's (manual) form.
    Orca's process naming is tree|normal + (auto)|(manual).
    """
    raw = (cfg.get("support_material") or "").strip().lower()
    if raw not in ("0", "1", "true", "false"):
        return None
    style = (cfg.get("support_material_style") or "").strip().lower()
    auto = (cfg.get("support_material_auto") or "1").strip().lower() not in ("0", "false")
    angle = _as_float(cfg.get("support_material_threshold") or 0)
    return {
        "enabled": raw in ("1", "true"),
        "type": "%s(%s)" % ("tree" if style in ("organic", "tree") else "normal",
                            "auto" if auto else "manual"),
        "angle": angle if angle and angle > 0 else None,
    }


def bambu_support(cfg: dict):
    """Orca/Bambu projects already use the Orca vocabulary."""
    raw = _first_scalar(cfg, "enable_support")
    if raw is None:
        return None
    stype = _first_scalar(cfg, "support_type")
    angle = _as_float(_first_scalar(cfg, "support_threshold_angle"))
    return {
        "enabled": str(raw).strip() in ("1", "true", "True"),
        "type": str(stype) if stype else None,
        "angle": angle if angle and angle > 0 else None,
    }


def apply_support(cfg: dict, support, mode: str = "auto", painted: bool = False) -> str:
    """Write the support decision into a project config.

    mode:
      auto -- follow the source file (the default)
      on   -- enable supports but keep the *profile's* type and threshold, which
              is what you want if the source was painted-only and you would rather
              let Orca generate supports normally
      off  -- disable supports

    `painted` says whether the model carries painted support enforcers. Leaving
    those with support switched off is a contradiction Orca refuses to let pass
    ("Support enforcers are used but support is not enabled"), so it is never done
    quietly here.
    """
    def describe():
        return "%s at %s degrees" % (cfg.get("support_type"),
                                     cfg.get("support_threshold_angle"))

    if mode == "off":
        cfg["enable_support"] = "0"
        if painted:
            return ("supports off (asked for it) -- NOTE the model has painted "
                    "support enforcers, which do nothing with support off; Orca "
                    "will warn about them")
        return "supports off (asked for it)"
    if mode == "on":
        cfg["enable_support"] = "1"
        return "supports on, profile defaults: " + describe()

    if support is None:
        return ("source had no support setting, left at the profile default "
                f"(enable_support={cfg.get('enable_support')})")
    if not support["enabled"]:
        if painted:
            # the source contradicts itself; Orca's own warning says enable it
            cfg["enable_support"] = "1"
            return ("supports enabled: the source has them off but carries painted "
                    "support enforcers, which are meaningless without support")
        cfg["enable_support"] = "0"
        return "supports off (the source had them off)"

    cfg["enable_support"] = "1"
    if support.get("type"):
        cfg["support_type"] = support["type"]
    if support.get("angle"):
        cfg["support_threshold_angle"] = "%.0f" % support["angle"]
    return "supports carried over: " + describe()


ORCA_CANDIDATES = [
    r"C:\Program Files\Snapmaker_Orca\snapmaker-orca.exe",
    r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
    r"C:\Program Files\Bambu Studio\bambu-studio.exe",
    "/Applications/Snapmaker_Orca.app/Contents/MacOS/Snapmaker_Orca",
    "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
    "orca-slicer",
    "orcaslicer",
]


def find_orca() -> str | None:
    for cand in ORCA_CANDIDATES:
        if os.path.isabs(cand):
            if os.path.isfile(cand):
                return cand
        elif shutil.which(cand):
            return shutil.which(cand)
    return None


def slices_cleanly(orca: str, path: str, timeout: int = 2400):
    """Ask the slicer about a plate. Returns (verdict, reason).

    verdict is "ok", "conflict" or "error".

    "conflict" is deliberately NOT treated as a failure. The CLI command line runs
    a stricter check than the GUI -- its own message says so:

        "G-code conflicts detected after slicing. Please make sure the 3mf file can
         be successfully sliced in the latest Orca Slicer. If the file slices
         normally in Orca Slicer, try moving the wipe tower further from other
         models, as we use more conservative parameters for it during upload."

    The GUI only records the conflict (Print.cpp stashes it into the result and
    carries on), so a plate the CLI refuses on this ground routinely slices fine in
    Orca. Treating it as fatal made this tool far more conservative than Orca
    itself.
    """
    outdir = tempfile.mkdtemp(prefix="u1verify-")
    try:
        proc = subprocess.run([orca, "--slice", "0", "--outputdir", outdir, path],
                              capture_output=True, text=True, timeout=timeout)
        text = (proc.stdout or "") + "\n" + (proc.stderr or "")
        if any(f.endswith(".gcode") for f in os.listdir(outdir)):
            return "ok", ""
        for line in text.splitlines():
            if "conflicts found between" in line:
                return "conflict", line.split("]")[-1].strip()
        # Report what actually went wrong, not the wrapper. The top-level handler
        # prints "Slic3r::CLI::run found error, exit" for any failure -- a crash, a
        # bad_alloc from a plate that is too big for the machine's memory -- so
        # prefer the last meaningful line and skip the logging noise.
        if "Param values in 3mf/config error" in text:
            return "error", ("the slicer could not read its own configuration -- that "
                             "usually means Orca is open and holding it; close Orca and "
                             "try again")
        noise = ("found error, exit", "calc_exclude", "Initializing StaticPrintConfigs",
                 "sentry_init", "Starting Sentry")
        causes = [ln.split("]")[-1].strip() for ln in text.splitlines()
                  if ln.strip() and not any(n in ln for n in noise)]
        if causes:
            return "error", " / ".join(causes[-2:])
        return "error", "the slicer produced no G-code"
    except subprocess.TimeoutExpired:
        return "error", "the slicer timed out"
    except OSError as exc:
        return "error", f"could not run the slicer: {exc}"
    finally:
        shutil.rmtree(outdir, ignore_errors=True)


def _norm_setting(value) -> str:
    if isinstance(value, (list, tuple)):
        return "|".join(str(v) for v in value)
    return "" if value is None else str(value)


def different_settings(cfg: dict, profiles, machine: str, process: str,
                       slots: int) -> list[str]:
    """Build the project-override list Orca reads its tick marks from.

    Orca does not work out which settings a project overrides by comparing values
    against the preset -- it trusts this list in project_settings.config. A
    project without it shows every box as the preset default, unticked, even where
    the project value genuinely differs, which is exactly what our output did.

    Format follows what Orca itself writes: one entry for the global settings,
    then one (usually empty) entry per filament.
    """
    system: dict = {}
    if profiles is not None:
        for kind, name in (("machine", machine), ("process", process)):
            try:
                system.update(profiles.resolve(kind, name) or {})
            except Exception:
                pass
    changed = [k for k in sorted(cfg)
               if k in system and _norm_setting(cfg[k]) != _norm_setting(system[k])]
    return [";".join(changed)] + [""] * max(0, slots)


def plan_slots(src: Source):
    """Which source extruders are really in play, and where they land on the U1."""
    used = set(src.used_extruders) | set(src.paint_states) | {src.base_extruder}
    if src.paint_undecodable and src.kind == "prusa":
        used |= set(range(1, min(src.palette_count, TARGET_SLOTS) + 1))
    used = {u for u in used if u >= 1} or {1}
    if len(used) > TARGET_SLOTS:
        raise ConvertError(
            f"the model uses {len(used)} extruders ({sorted(used)}) but the U1 has "
            f"{TARGET_SLOTS}. Reduce the colours in a slicer first."
        )
    ordered = sorted(used)
    return ordered, {e: i + 1 for i, e in enumerate(ordered)}


def analyze(src_path: str, profile_root: str | None = None,
            machine: str = DEFAULT_MACHINE,
            process: str = DEFAULT_PROCESS,
            filament_profile: str | None = None,
            gap: float = 5.0) -> dict:
    """Describe a source 3MF, and work out how many copies the plate holds."""
    with zipfile.ZipFile(src_path) as zf:
        src = read_source(zf)

CARRY_KEYS = (
    # geometry and shells -- numbers only. Enum spellings change between Orca
    # versions (a Bambu file says ensure_vertical_shell_thickness = "enabled",
    # this Orca only knows "ensure_all"), and carrying one makes Orca pop up a
    # "some values have been replaced" warning on load. The U1 profile's own
    # value is right for a U1, so those keys are left alone.
    "layer_height", "initial_layer_print_height",
    "wall_loops", "top_shell_layers", "top_shell_thickness",
    "bottom_shell_layers", "bottom_shell_thickness",
    # infill
    "sparse_infill_density",
    "infill_anchor", "infill_anchor_max",
    # surface finish: ironing and fuzzy skin are numbers; the patterns below are
    # the handful of enums whose spellings are stable across versions
    "ironing_spacing", "ironing_speed", "ironing_inset", "ironing_angle",
    "fuzzy_skin_thickness", "fuzzy_skin_point_distance",
    # first layer and adhesion
    "brim_width", "brim_object_gap",
    "elefant_foot_compensation", "elefant_foot_compensation_layers",
    # resolution and the painted-region knobs
    "resolution",
    "mmu_segmented_region_max_width", "mmu_segmented_region_interlocking_depth",
    # support geometry -- the on/off decision is handled by apply_support
    "support_threshold_overlap",
    # reviewed enums
    "sparse_infill_pattern", "top_surface_pattern", "bottom_surface_pattern",
    "ironing_type", "ironing_pattern", "brim_type",
)


# PrusaSlicer calls several of the same settings something else.  Without these a
# Prusa project carries far less than a Bambu one, because the names simply do not
# match the Orca config.
PRUSA_ALIASES = {
    "initial_layer_print_height": ("first_layer_height",),
    "wall_loops": ("perimeters",),
    "top_shell_layers": ("top_solid_layers",),
    "bottom_shell_layers": ("bottom_solid_layers",),
    "top_shell_thickness": ("top_solid_min_thickness",),
    "bottom_shell_thickness": ("bottom_solid_min_thickness",),
    "sparse_infill_density": ("fill_density",),
    "sparse_infill_pattern": ("fill_pattern",),
    "internal_solid_infill_pattern": ("solid_infill_pattern",),
    "top_surface_pattern": ("top_fill_pattern",),
    "bottom_surface_pattern": ("bottom_fill_pattern",),
}


# Values this Orca will accept.  There is no schema to check against, so these are
# the spellings known to work; anything else keeps the U1 profile's value.  A newer
# Orca writes values this one does not know -- "enabled" for an enum, -1 for
# raft_first_layer_expansion meaning "auto" -- and Orca either warns about them or
# refuses to open the file, so carrying them unchecked is worse than not carrying.
ENUM_VALUES = {
    "sparse_infill_pattern": {
        "grid", "line", "concentric", "honeycomb", "3dhoneycomb", "gyroid",
        "crosshatch", "cubic", "triangles", "tri-hexagon", "star", "supportcubic",
        "lightning", "zig-zag", "cross-zag", "rectilinear", "monotonic",
        "monotonicline", "alignedrectilinear"},
    "top_surface_pattern": {
        "monotonic", "monotonicline", "rectilinear", "concentric", "zig-zag",
        "cross-zag", "alignedrectilinear"},
    "bottom_surface_pattern": {
        "monotonic", "monotonicline", "rectilinear", "concentric", "zig-zag",
        "cross-zag", "alignedrectilinear"},
    "ironing_type": {"no ironing", "top", "topmost", "solid"},
    "ironing_pattern": {"rectilinear", "concentric", "zig-zag"},
    "brim_type": {"auto_brim", "outer_only", "inner_only", "no_brim",
                  "outer_and_inner", "brim_ears"},
}


def _acceptable(key: str, value: str) -> bool:
    """Would this Orca accept the value as it stands?"""
    if key in ENUM_VALUES:
        return value in ENUM_VALUES[key]
    try:
        # Orca writes percentages as "400%", so the suffix is part of the value
        return float(value.rstrip("%")) >= 0
    except ValueError:
        return False


def carry_print_settings(cfg: dict, source_settings, enabled: bool = True) -> list:
    """Overlay the source's print-intent settings onto the U1 config.

    Settings describing the *print* travel; settings describing the *printer* or the
    *filament* do not, and stay with the U1 profile -- bed and filament
    temperatures, speeds, accelerations, retraction, purge and prime-tower numbers,
    toolchange and machine g-code, and the bed geometry are all properties of the
    machine that wrote the file, and copying them onto a U1 prints worse than the
    U1 profile does.

    Returns the list of keys actually carried, for the log.
    """
    if not source_settings or not enabled:
        return []

    carried = []
    for key in CARRY_KEYS:
        name = key
        if name not in source_settings:
            name = next((a for a in PRUSA_ALIASES.get(key, ())
                         if a in source_settings), None)
            if name is None:
                continue
        value = source_settings[name]
        if isinstance(value, (list, tuple)):
            value = value[0] if value else None
        if value is None or value == "":
            continue
        value = str(value)
        if not _acceptable(key, value):
            continue
        current = cfg.get(key)
        if isinstance(current, list):
            cfg[key] = [value] * len(current) if current else [value]
        else:
            cfg[key] = value
        carried.append(key)
    return carried


def plate_inputs(src: Source, profile_root=None, machine: str = DEFAULT_MACHINE,
                 process: str = DEFAULT_PROCESS, filament_profile=None,
                 colors=None, types=None, supports: str = "auto",
                 carry: bool = True):
    """Everything the plate layout needs, from an already-parsed source.

    Split out so the capacity can be recomputed for a new spacing without
    re-reading the mesh.
    """
    ordered, mapping = plan_slots(src)
    profiles = Profiles(profile_root) if profile_root else None
    cfg = build_project_config(
        load_base_template(), profiles,
        colors if colors is not None else [src.color_for(e) for e in ordered],
        types if types is not None else [src.type_for(e) for e in ordered],
        filament_profile or DEFAULT_FILAMENT, machine, process)
    carry_print_settings(cfg, src.source_settings, carry)
    apply_support(cfg, src.support, supports, painted=src.has_supports)
    placement = src.placement or matrix_from_text(src.build_transform)
    return cfg, placement, src.mesh_bounds


def plate_capacity(src: Source, gap: float = 5.0, avoid_tower: bool = True,
                   **kwargs) -> int:
    """How many copies fit at a given spacing."""
    cfg, placement, bounds = plate_inputs(src, **kwargs)
    return layout_copies(placement, bounds, cfg, True, 10 ** 6, gap, avoid_tower)[3]


def describe(src: Source, profile_root: str | None = None,
             machine: str = DEFAULT_MACHINE,
             process: str = DEFAULT_PROCESS,
             filament_profile: str | None = None,
             gap: float = 5.0) -> dict:
    """Describe an already-parsed source, including how many copies fit."""
    ordered, mapping = plan_slots(src)
    profiles = Profiles(profile_root) if profile_root else None
    filament_profile = filament_profile or DEFAULT_FILAMENT

    cfg, placement, bounds = plate_inputs(
        src, profile_root, machine, process, filament_profile)

    footprint = {"x": 0.0, "y": 0.0, "z": 0.0}
    capacity = 1
    if bounds:
        wlo, whi = world_aabb(placement, *bounds)
        footprint = {"x": round(whi[0] - wlo[0], 2),
                     "y": round(whi[1] - wlo[1], 2),
                     "z": round(whi[2] - wlo[2], 2)}
        capacity = layout_copies(placement, bounds, cfg, True, 10 ** 6, gap, True)[3]
    ax0, ax1, ay0, ay1 = printable_bounds(cfg)

    return {
        "kind": src.kind,
        "object": src.object_name,
        "source_file": src.source_file,
        "palette_source": src.palette_source,
        "filaments_in_source": src.palette_count,
        "painted_triangles": src.paint_count,
        "subdivided_triangles": src.subdivided,
        "supports_painted": src.has_supports,
        "support": src.support,
        "layer_height": src.layer_height,
        "footprint": footprint,
        "capacity": capacity,
        "bed": {"x": round(ax1 - ax0, 2), "y": round(ay1 - ay0, 2)},
        "slots": [
            {
                "slot": mapping[e],
                "source_extruder": e,
                "color": src.color_for(e),
                "type": src.type_for(e),
                "painted_triangles": src.paint_states.get(e, 0),
                "is_base": e == src.base_extruder,
            }
            for e in ordered
        ],
        "profiles": {
            "filament": profiles.u1_filaments() if profiles else [filament_profile],
            "process": profiles.matching("process", "U1", "0.4") if profiles else [process],
            "machine": profiles.matching("machine", "U1") if profiles else [machine],
        },
        "defaults": {
            "machine": machine,
            "process": process,
            "filament": filament_profile,
        },
    }


def analyze(src_path: str, profile_root: str | None = None,
            machine: str = DEFAULT_MACHINE,
            process: str = DEFAULT_PROCESS,
            filament_profile: str | None = None,
            gap: float = 5.0) -> dict:
    """Describe a source 3MF, and work out how many copies the plate holds."""
    with zipfile.ZipFile(src_path) as zf:
        src = read_source(zf)
    return describe(src, profile_root, machine, process, filament_profile, gap)


def convert(src_path: str, out_path: str, profile_root: str | None,
            filament_profile: str | None, machine: str, process: str,
            colors_override: list[str], types_override: list[str],
            reposition: bool, copies: int = 1, gap: float = 5.0,
            avoid_tower: bool = True, supports: str = "auto",
            verify: bool = False, carry: bool = True) -> dict:

    with zipfile.ZipFile(src_path) as zf:
        src = read_source(zf)

        profiles = None
        if profile_root:
            profiles = Profiles(profile_root)
            # Preset names drift between Orca releases (0.20 vs 0.20mm, ...), so fall
            # back to picking by keyword rather than failing on an exact-match miss.
            if not profiles.has("machine", machine):
                alt = profiles.find("machine", "U1", "0.4")
                if alt:
                    log(f"note: machine preset {machine!r} unavailable, using {alt!r}")
                    machine = alt
            if not profiles.has("process", process):
                alt = profiles.find("process", "U1", "0.4", "Standard")
                if alt:
                    log(f"note: process preset {process!r} unavailable, using {alt!r}")
                    process = alt
            if not filament_profile:
                for cand in (DEFAULT_FILAMENT, "Snapmaker PLA Basic @U1 base", "Generic PLA"):
                    if profiles.has("filament", cand):
                        filament_profile = cand
                        break
                else:
                    filament_profile = profiles.find("filament", "PLA")
        filament_profile = filament_profile or DEFAULT_FILAMENT

        log(f"input        : {os.path.basename(src_path)}  [{src.kind} project]")
        log(f"object       : {src.object_name}  ({src.paint_count} painted triangles)")
        if src.plate_objects > 1:
            log(f"plate        : {src.plate_objects} copies of that one model on the "
                "source plate; the original layout is dropped and rebuilt from the "
                "copies/spacing settings")
        if src.preview:
            log("thumbnail    : carried over from %s (%d KB)"
                % (src.preview_from, len(src.preview) // 1024))
        else:
            log("thumbnail    : none in the source to carry over")
        if src.paint_states:
            log("paint        : " + ", ".join(
                f"extruder {k} on {v} tris" for k, v in sorted(src.paint_states.items())))
        if src.subdivided:
            log(f"paint        : {src.subdivided} sub-divided triangles "
                "(copied through unchanged)")

        # ---- which extruders are in play, and where do they land on the U1? ----
        ordered, mapping = plan_slots(src)

        out_colors = [src.color_for(e) for e in ordered]
        out_types = [src.type_for(e) for e in ordered]
        if colors_override:
            got = [norm_color(c) for c in colors_override]
            if len(got) > len(out_colors):
                raise ConvertError(
                    f"--colors supplies {len(got)} colours but the model only uses "
                    f"{len(out_colors)}")
            out_colors = (got + out_colors)[:len(out_colors)]
        if types_override:
            out_types = (types_override + out_types)[:len(out_types)]

        log("slots        : " + ", ".join(
            f"{mapping[e]}<-{e} {src.color_for(e)}" for e in ordered))
        log(f"printer      : {machine}")
        log(f"process      : {process}")
        log(f"filament     : {filament_profile}")

        cfg = build_project_config(
            load_base_template(), profiles,
            out_colors, out_types, filament_profile, machine, process,
        )
        carried = carry_print_settings(cfg, src.source_settings, carry)
        if carried:
            shown = ", ".join(carried[:8]) + (" ..." if len(carried) > 8 else "")
            log(f"settings     : carried {len(carried)} print setting"
                f"{'' if len(carried) == 1 else 's'} from the source ({shown}); "
                "machine and filament settings come from the U1 profile")
        else:
            log("settings     : all print settings come from the U1 profile")
        log("supports     : " + apply_support(cfg, src.support, supports,
                                              painted=src.has_supports))

        # The output stores the mesh in its own local frame with identity part and
        # component matrices, so the source transforms are folded into the build item.
        placement = src.placement or matrix_from_text(src.build_transform)

        object_file = OBJECTS_DIR + src.object_name + ".model"
        stats: dict = {}

        # The mesh is the expensive part and never changes between attempts, so
        # build it once and keep it in memory for the verification loop.
        buf = io.BytesIO()
        buf.write(object_file_open().encode("utf-8"))
        copy_mesh(zf, src.mesh_file, buf, mapping, stats)
        buf.write(object_file_close().encode("utf-8"))
        object_bytes = buf.getvalue()

        bounds = _scan_bounds(stats)
        _, _, _, capacity = layout_copies(placement, bounds, cfg, reposition,
                                          10 ** 6, gap, avoid_tower)
        _, moved = place_on_bed(placement, bounds, cfg, reposition)

        def assemble(path: str, want: int):
            transforms, cols, rows, cap = layout_copies(
                placement, bounds, cfg, reposition, want, gap, avoid_tower)
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
                zout.writestr("[Content_Types].xml", content_types_xml())
                zout.writestr("_rels/.rels", root_rels_xml())
                zout.writestr(MODEL_RELS, model_rels_xml(object_file))
                zout.writestr("Metadata/slice_info.config", slice_info_xml())
                zout.writestr(
                    SRC_BBL_MODEL,
                    model_settings_xml(src.object_name, mapping.get(src.base_extruder, 1),
                                       src.source_file, len(transforms)))
                overrides = different_settings(cfg, profiles, machine, process,
                                               len(out_colors))
                cfg["different_settings_to_system"] = overrides
                keys = overrides[0].split(";") if overrides[0] else []
                detail = ", ".join(keys[:8]) + (" ..." if len(keys) > 8 else "")
                log(f"overrides    : {len(keys)} project settings flagged as changed"
                    + (f" ({detail})" if keys else ""))
                zout.writestr(SRC_BBL_PROJECT,
                              json.dumps(cfg, indent=4, ensure_ascii=False))
                # Written under both names on purpose: Windows and PrusaSlicer look
                # for thumbnail.png, Bambu Studio and Orca look for plate_1.png.
                if src.preview:
                    zout.writestr("Metadata/thumbnail.png", src.preview)
                    zout.writestr("Metadata/plate_1.png", src.preview)
                zout.writestr(object_file, object_bytes)
                zout.writestr(MODEL_FILE,
                              main_model_xml(object_file, src.object_name,
                                             [transform_3mf_text(t) for t in transforms]))
            return transforms, cols, rows, cap

        # Build beside the destination and rename at the end: a failure part way
        # through must not leave a truncated file where the real output used to be.
        tmp_path = out_path + ".partial"
        trial_dir = None
        try:
            chosen = min(copies, capacity)
            verified = None
            if verify:
                orca = find_orca()
                if not orca:
                    log("verify       : skipped, no slicer found to check with")
                else:
                    # candidates need a .3mf extension or the slicer refuses them
                    trial_dir = tempfile.mkdtemp(prefix="u1trials-")
                    trial_path = os.path.join(trial_dir, "candidate.3mf")
                    log(f"verify       : asking {os.path.basename(orca)} how many fit")
                    chosen, verified = None, False
                    for trial in range(min(copies, capacity), 0, -1):
                        assemble(trial_path, trial)
                        verdict, reason = slices_cleanly(orca, trial_path)
                        if verdict in ("ok", "conflict"):
                            chosen = trial
                            verified = verdict == "ok"
                            log(f"verify       : {trial} copies "
                                + ("slice cleanly" if verdict == "ok"
                                   else "sliced, with a prime-tower warning"))
                            if verdict == "conflict":
                                log("warning      : " + reason)
                                log("warning      : the command line gates on a stricter "
                                    "prime-tower model than the GUI and refuses to export. "
                                    "Orca itself only warns, so this plate should preview "
                                    "and slice normally there.")
                            break
                        log(f"verify       : {trial} copies rejected ({reason})")
                        if "conflicts found between" not in reason:
                            log("verify       : that is not a prime-tower conflict, so a "
                                "smaller plate is unlikely to help -- keeping the "
                                "geometric layout as it is")
                            break
                    if chosen is None:
                        chosen = min(copies, capacity)
                        log("verify       : nothing sliced, keeping the geometric layout")

            transforms, cols, rows, capacity = assemble(tmp_path, chosen)
            os.replace(tmp_path, out_path)
        except BaseException:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            raise
        finally:
            if trial_dir:
                shutil.rmtree(trial_dir, ignore_errors=True)

    log(f"triangles    : {stats.get('triangles', 0)}")
    if len(transforms) > 1:
        log(f"copies       : {len(transforms)} ({cols} x {rows} grid, {gap:g} mm apart, "
            f"geometry allows {capacity})")
    elif capacity > 1:
        log(f"copies       : 1 (geometry would allow {capacity})")
    if moved:
        log("placement    : recentred on the U1 bed")
    log(f"output       : {out_path}  ({os.path.getsize(out_path):,} bytes)")

    return {
        "output": out_path,
        "colors": out_colors,
        "types": out_types,
        "slots": {str(k): v for k, v in mapping.items()},
        "copies": len(transforms),
        "cols": cols,
        "rows": rows,
        "capacity": capacity,
        "verified": verified,
        "supports": cfg.get("enable_support"),
        "support_type": cfg.get("support_type"),
        "moved": moved,
    }


# --------------------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="u1convert.py",
        description="Convert a 3MF model into a Snapmaker U1 project for Snapmaker Orca.",
    )
    ap.add_argument("input", nargs="?", help="source .3mf")
    ap.add_argument("-o", "--output", help="output .3mf (default <input>-U1.3mf)")
    ap.add_argument("--profile-dir", help="Orca profiles directory (auto-detected)")
    ap.add_argument("--machine", default=DEFAULT_MACHINE)
    ap.add_argument("--process", default=DEFAULT_PROCESS)
    ap.add_argument("--filament", help="Orca filament profile used for every slot")
    ap.add_argument("--colors", help="comma separated colour overrides")
    ap.add_argument("--types", help="comma separated filament type overrides")
    ap.add_argument("--no-reposition", action="store_true",
                    help="keep the original placement instead of centring on the bed")
    ap.add_argument("--copies", type=int, default=1,
                    help="lay this many copies out across the plate")
    ap.add_argument("--fill-bed", action="store_true",
                    help="lay out as many copies as the plate holds")
    ap.add_argument("--gap", type=float, default=5.0,
                    help="spacing between copies in mm (default 5)")
    ap.add_argument("--supports", choices=("auto", "on", "off"), default="auto",
                    help="carry the source's support setting over (default auto)")
    ap.add_argument("--verify", action="store_true",
                    help="slice each candidate layout and keep the largest that "
                         "the slicer accepts (slower, but the result is guaranteed)")
    ap.add_argument("--list-filaments", action="store_true",
                    help="list the U1 filament profiles Orca knows about")
    args = ap.parse_args(argv)

    try:
        root = find_profile_root(args.profile_dir)
    except ConvertError as exc:
        root = None
        if args.list_filaments or not args.input:
            print(exc, file=sys.stderr)
            return 1
        log("warning: no Orca profiles found, falling back to the bundled U1 base settings")

    if args.list_filaments:
        for name in Profiles(root).u1_filaments():
            print(name)
        return 0

    if not args.input:
        ap.error("an input .3mf is required")
    if not os.path.isfile(args.input):
        print(f"error: {args.input} not found", file=sys.stderr)
        return 1

    output = args.output or os.path.splitext(args.input)[0] + "-U1.3mf"
    try:
        convert(
            args.input, output, root, args.filament, args.machine, args.process,
            [c for c in (args.colors or "").split(",") if c.strip()],
            [t for t in (args.types or "").split(",") if t.strip()],
            not args.no_reposition,
            copies=10 ** 6 if args.fill_bed else max(1, args.copies),
            gap=args.gap,
            supports=args.supports,
            verify=args.verify,
        )
    except ConvertError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except zipfile.BadZipFile:
        print("error: the input is not a valid 3MF (zip) archive", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
