#!/usr/bin/env python3
"""Multi-object, multi-plate 3MF projects: import, assessment, selection, export.

The single-object path in :mod:`u1convert` answers "one model, up to four
colours".  Real projects are not like that: a plate can hold twenty parts built
from shared mesh files, the colours can live in per-part metadata rather than in
the paint, and the palette in the project settings is a *menu* rather than the
list of colours a print actually uses.  This module reads that structure, reports
what a chosen plate/object selection really needs, and writes a Snapmaker U1
project for it.

What is preserved on export
---------------------------
* every mesh, vertex and triangle of the selected objects, byte-identical apart
  from the paint attribute rename every Orca-family project needs;
* painted triangles, including sub-divided ones, remapped state by state with
  :mod:`u1paint` -- or refused outright when a value cannot be rewritten safely;
* support and seam painting (renamed, never renumbered);
* per-part colours: the source's part metadata becomes the output's part
  metadata, so a file coloured by *part* (no paint at all) keeps its colours.

What is normalised on export
----------------------------
* the plate translation: objects keep their relative arrangement, and the
  selection as a whole is centred on the U1 bed with its lowest point on Z=0;
* the four physical slots: source extruders are renumbered onto U1 slots 1..4
  through the plan's mapping.

This is the local assessment milestone only.  Nothing here simulates native
Full Spectrum mixing, pause-based swaps, or printer execution.
"""

from __future__ import annotations

import io
import json
import os
import re
import zipfile
from dataclasses import dataclass, field

import u1colour
import u1convert as u1
import u1mix
import u1paint
import u1spectrum
import u1targets

MAX_SLOTS = u1.TARGET_SLOTS

# The physical reels loaded in the machine when this milestone was written.  The
# hues come from a screenshot of the printer's filament screen and are explicitly
# approximate; they are editable in the UI and are never silently equated with
# colours imported from a file.
DEFAULT_FILAMENTS = (
    {"slot": 1, "color": "#FFFFFF", "type": "PLA"},
    {"slot": 2, "color": "#000000", "type": "PLA"},
    {"slot": 3, "color": "#3D9140", "type": "PLA"},
    {"slot": 4, "color": "#FF9500", "type": "PLA"},
)

SUPPORT_ATTRS = (
    ("slic3rpe:custom_supports", "paint_supports"),
    ("slic3rpe:custom_seam", "paint_seam"),
    ("slic3rpe:fuzzy_skin", "paint_fuzzy_skin"),
)

PAINT_VALUE_RE = re.compile(
    r'(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"')
MODEL_OBJECT_RE = re.compile(r"<object\b([^>]*)>(.*?)</object>", re.S)
PART_RE = re.compile(r"<part\b([^>]*)>(.*?)</part>", re.S)
PLATE_RE = re.compile(r"<plate>(.*?)</plate>", re.S)


def _attr(text: str, name: str):
    m = re.search(r'\b%s="([^"]*)"' % re.escape(name), text)
    return m.group(1) if m else None


def _tag_attrs(line: str) -> str:
    """The attribute text of the first tag on a line."""
    start = line.find("<")
    end = line.find(">", start + 1)
    return line[start + 1:end] if start >= 0 and end > start else line


def _int(value, default=None):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _unique(values) -> list:
    out, seen = [], set()
    for value in values:
        if value not in seen:
            seen.add(value)
            out.append(value)
    return out


def _is_triangle(line: str) -> bool:
    """A facet, not the <triangles> container that starts with the same word."""
    return line.startswith("<triangle ") or line.startswith("<triangle>")


# --------------------------------------------------------------------------------------
# project structure
# --------------------------------------------------------------------------------------

@dataclass
class Component:
    path: str | None            # "/3D/Objects/object_441.model"; None = this model file
    objectid: str               # id of the object inside that member
    transform: str | None


@dataclass
class ObjectDef:
    id: str
    components: list = field(default_factory=list)
    has_mesh: bool = False
    mesh_ref: str | None = None


@dataclass
class BuildItem:
    objectid: str
    transform: str | None
    printable: bool = True


@dataclass
class PartMeta:
    id: str
    name: str | None = None
    matrix: str | None = None
    source_file: str | None = None
    extruder: int | None = None
    subtype: str | None = None


def is_hidden_role(subtype) -> bool:
    """True for a volume that modifies or subtracts instead of printing.

    Bambu/Orca call these ``negative_part``, ``modifier_part`` and
    ``support_blocker``; PrusaSlicer writes ``NegativeVolume``,
    ``ParameterModifier`` and ``SupportBlocker``.  None of them is printed
    geometry, so writing one as ``normal_part`` would fill in a hole or print a
    support blocker as solid.
    """
    text = str(subtype or "").lower().replace(" ", "").replace("_", "")
    return ("negative" in text or "modifier" in text
            or "supportblocker" in text or "support_blocker" in text)


@dataclass
class ObjectMeta:
    id: str
    name: str | None = None
    extruder: int | None = None
    parts: list = field(default_factory=list)
    volumes: int = 0          # PrusaSlicer volumes; >1 is not supported yet


@dataclass
class Plate:
    id: int
    name: str
    entries: list = field(default_factory=list)      # PlateEntry, in plate order

    @property
    def object_ids(self) -> list:
        """The plate's objects in plate order, one entry per instance."""
        return [entry.object_id for entry in self.entries]


@dataclass
class PlateEntry:
    object_id: str
    instance_id: str | None = None


@dataclass
class InnerObject:
    id: str
    triangles: int = 0
    leaf_states: dict = field(default_factory=dict)        # whole-triangle materials
    unpainted: int = 0                                     # facets with no attribute
    split: int = 0                                         # sub-divided facets
    split_leaf_states: dict = field(default_factory=dict)  # materials inside them
    painted_split: int = 0                                 # sub-divided, non-zero leaf
    undecodable: int = 0
    support_painted: int = 0
    support_split: int = 0
    bounds: tuple | None = None
    components: list = field(default_factory=list)

    def used_states(self) -> set:
        """Non-zero materials this mesh actually paints with."""
        used = {s for s in self.leaf_states if s}
        return used | {s for s in self.split_leaf_states if s}

    def uses_base(self) -> bool:
        """True when some facet leans on the object's own filament.

        A base colour is only a colour this print needs when geometry is left
        unpainted (or explicitly painted state 0).  A part whose every facet is
        overridden must not add its base to the count.
        """
        if self.unpainted:
            return True
        if self.leaf_states.get(0):
            return True
        return bool(self.split and self.split_leaf_states.get(0))

    def painted_triangles(self) -> int:
        return sum(c for s, c in self.leaf_states.items() if s) + self.painted_split


@dataclass
class MeshIndex:
    """Everything the assessment needs from one mesh-bearing archive member."""

    member: str
    objects: dict = field(default_factory=dict)
    order: list = field(default_factory=list)

    def get(self, oid) -> InnerObject | None:
        return self.objects.get(str(oid))


class Project:
    """One 3MF's structure, independent of any open zip handle."""

    def __init__(self):
        self.kind = "plain"                       # prusa | bambu | plain
        self.colors: list = []
        self.types: list = []
        self.palette_source = ""
        self.palette_count = 0
        self.source_settings = None
        self.support = None
        self.layer_height = None
        self.base_extruder = 1
        self.title = ""
        self.warnings: list = []
        self.objects: dict = {}
        self.object_order: list = []
        self.items: list = []
        self.plates: list = []
        self.meta: dict = {}
        self.previews: dict = {}
        self.mesh_cache: dict = {}
        self.inline_member = u1.MODEL_FILE

    def items_for(self, object_id) -> list:
        return [it for it in self.items if it.objectid == str(object_id)]

    def printable_items_for(self, object_id) -> list:
        """Build items that actually place the object on the plate."""
        return [it for it in self.items if it.objectid == str(object_id) and it.printable]

    def color_for(self, extruder: int, default: str = "#FFFFFF") -> str:
        if 1 <= extruder <= len(self.colors) and self.colors[extruder - 1]:
            return self.colors[extruder - 1]
        return default

    def type_for(self, extruder: int, default: str = "PLA") -> str:
        if 1 <= extruder <= len(self.types) and self.types[extruder - 1]:
            return self.types[extruder - 1]
        return default

    def plate(self, plate_id) -> Plate | None:
        for plate in self.plates:
            if plate.id == plate_id:
                return plate
        return None

    def object_name_for(self, object_id) -> str:
        meta = self.meta.get(str(object_id))
        if meta is not None and meta.name:
            return meta.name
        return f"object {object_id}"


@dataclass
class Selection:
    plate_id: int | None
    object_ids: list

    def as_ids(self) -> list:
        return [str(o) for o in self.object_ids]


@dataclass
class Plan:
    """How a selection reaches four physical slots."""

    mode: str = "direct"                                  # direct | approximate
    mapping: dict = field(default_factory=dict)            # source extruder -> slot
    filaments: list = field(default_factory=lambda: [dict(f) for f in DEFAULT_FILAMENTS])

    def colors(self) -> list:
        return [u1colour.norm(f.get("color")) or "#FFFFFF" for f in self.filaments]

    def types(self) -> list:
        return [str(f.get("type") or "PLA") for f in self.filaments]


# --------------------------------------------------------------------------------------
# reading
# --------------------------------------------------------------------------------------

def _scan_main_model(zf: zipfile.ZipFile, member: str):
    """(objects dict, object order, build items) from a 3dmodel.model.

    PrusaSlicer keeps a 150 MB mesh inline here, so this streams the file and
    never holds more than one line plus the (small) structure it builds.
    """
    objects: dict = {}
    order: list = []
    items: list = []
    current = None

    with zf.open(member) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
            stripped = line.lstrip()
            if not stripped:
                continue
            if current is None:
                if stripped.startswith("<object"):
                    attrs = _tag_attrs(stripped)
                    oid = _attr(attrs, "id")
                    if oid is not None:
                        current = ObjectDef(id=str(oid))
                        objects[str(oid)] = current
                        order.append(str(oid))
                    if "</object>" in stripped:
                        current = None
                elif stripped.startswith("<item"):
                    attrs = _tag_attrs(stripped)
                    oid = _attr(attrs, "objectid")
                    if oid is not None:
                        items.append(BuildItem(
                            objectid=str(oid),
                            transform=_attr(attrs, "transform"),
                            printable=(_attr(attrs, "printable") or "1") not in ("0", "false"),
                        ))
                continue
            if stripped.startswith("<mesh"):
                current.has_mesh = True
            elif stripped.startswith("<component"):
                attrs = _tag_attrs(stripped)
                if _attr(attrs, "objectid") is not None:
                    current.components.append(Component(
                        path=_attr(attrs, "p:path"),
                        objectid=str(_attr(attrs, "objectid")),
                        transform=_attr(attrs, "transform"),
                    ))
            if stripped.startswith("</object>"):
                current = None
    for obj in objects.values():
        if obj.has_mesh:
            obj.mesh_ref = obj.id
    return objects, order, items


def _scan_member_objects(zf: zipfile.ZipFile, member: str) -> MeshIndex:
    """Per-inner-object statistics for one mesh-bearing member."""
    index = MeshIndex(member=member)
    current = None
    in_mesh = False

    with zf.open(member) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
            stripped = line.lstrip()
            if current is None:
                if stripped.startswith("<object"):
                    attrs = _tag_attrs(stripped)
                    oid = _attr(attrs, "id")
                    if oid is not None:
                        current = InnerObject(id=str(oid))
                        index.objects[str(oid)] = current
                        index.order.append(str(oid))
                    if "</object>" in stripped:
                        current = None
                continue
            if stripped.startswith("<mesh"):
                in_mesh = True
            elif stripped.startswith("<component"):
                attrs = _tag_attrs(stripped)
                if _attr(attrs, "objectid") is not None:
                    current.components.append((
                        _attr(attrs, "p:path"), str(_attr(attrs, "objectid")),
                        _attr(attrs, "transform")))
            elif stripped.startswith("<vertex") and in_mesh:
                m = u1.VERTEX_RE.search(stripped)
                if m:
                    point = tuple(float(m.group(i + 1)) for i in range(3))
                    if current.bounds is None:
                        current.bounds = (point, point)
                    else:
                        lo, hi = current.bounds
                        current.bounds = (
                            tuple(min(lo[i], point[i]) for i in range(3)),
                            tuple(max(hi[i], point[i]) for i in range(3)),
                        )
            elif _is_triangle(stripped) and in_mesh:
                current.triangles += 1
                paint = PAINT_VALUE_RE.search(stripped)
                if paint is not None and paint.group(1):
                    text = paint.group(1)
                    try:
                        node = u1paint.decode(text)
                    except u1paint.PaintError:
                        current.undecodable += 1
                        node = None
                    if node is not None and node[0] == "leaf":
                        state = node[1]
                        if state > u1paint.SUPPORTED_STATE_MAX:
                            # A newer encoding this tool will not rewrite; the id is
                            # still shown so the colour is visible, but the selection
                            # counts as unknown paint and no remap may touch it.
                            current.undecodable += 1
                        current.leaf_states[state] = current.leaf_states.get(state, 0) + 1
                    elif node is not None:
                        current.split += 1
                        states = u1paint.walk_states(node)
                        if any(s > u1paint.SUPPORTED_STATE_MAX for s in states):
                            current.undecodable += 1
                        for state in set(states):
                            current.split_leaf_states[state] = \
                                current.split_leaf_states.get(state, 0) + states.count(state)
                        if any(states):
                            current.painted_split += 1
                else:
                    current.unpainted += 1
                if "custom_supports" in stripped or "paint_supports" in stripped:
                    current.support_painted += 1
                    value = re.search(
                        r'(?:slic3rpe:)?(?:custom_supports|paint_supports)="([0-9A-Fa-f]*)"',
                        stripped)
                    if value is not None and value.group(1) and u1paint.is_split(value.group(1)):
                        current.support_split += 1
            if stripped.startswith("</object>"):
                current = None
                in_mesh = False
    return index


def _read_bambu_model_settings(zf: zipfile.ZipFile):
    """(object metadata, plates) from Metadata/model_settings.config."""
    meta: dict = {}
    plates: list = []
    if u1.SRC_BBL_MODEL not in zf.namelist():
        return meta, plates
    blob = zf.read(u1.SRC_BBL_MODEL).decode("utf-8", "replace")
    for attrs, body in MODEL_OBJECT_RE.findall(blob):
        oid = _attr(attrs, "id")
        if oid is None:
            continue
        name = re.search(r'key="name"\s+value="([^"]*)"', body)
        extruder = re.search(r'key="extruder"\s+value="(\d+)"', body)
        entry = ObjectMeta(
            id=str(oid),
            name=name.group(1) if name else None,
            extruder=_int(extruder.group(1)) if extruder else None,
        )
        for part_attrs, part_body in PART_RE.findall(body):
            pname = re.search(r'key="name"\s+value="([^"]*)"', part_body)
            matrix = re.search(r'key="matrix"\s+value="([^"]*)"', part_body)
            source = re.search(r'key="source_file"\s+value="([^"]*)"', part_body)
            pext = re.search(r'key="extruder"\s+value="(\d+)"', part_body)
            entry.parts.append(PartMeta(
                id=str(_attr(part_attrs, "id") or len(entry.parts) + 1),
                name=pname.group(1) if pname else None,
                matrix=matrix.group(1) if matrix else None,
                source_file=source.group(1) if source else None,
                extruder=_int(pext.group(1)) if pext else None,
                subtype=_attr(part_attrs, "subtype") or "normal_part",
            ))
        meta[str(oid)] = entry

    for body in PLATE_RE.findall(blob):
        pid = re.search(r'key="plater_id"\s+value="([^"]*)"', body)
        if pid is None:
            continue
        name = re.search(r'key="plater_name"\s+value="([^"]*)"', body)
        entries = []
        for instance in re.findall(r"<model_instance>(.*?)</model_instance>", body, re.S):
            oid = re.search(r'key="object_id"\s+value="([^"]*)"', instance)
            if oid is None:
                continue
            iid = re.search(r'key="instance_id"\s+value="([^"]*)"', instance)
            entries.append(PlateEntry(object_id=oid.group(1),
                                      instance_id=iid.group(1) if iid else None))
        plates.append(Plate(id=_int(pid.group(1), 1) or 1,
                            name=(name.group(1) if name else "") or f"Plate {pid.group(1)}",
                            entries=entries))
    return meta, plates


def _read_prusa_model_settings(zf: zipfile.ZipFile) -> dict:
    meta: dict = {}
    if u1.SRC_PRUSA_MODEL not in zf.namelist():
        return meta
    blob = zf.read(u1.SRC_PRUSA_MODEL).decode("utf-8", "replace")
    for attrs, body in MODEL_OBJECT_RE.findall(blob):
        oid = _attr(attrs, "id")
        if oid is None:
            continue
        name = re.search(r'key="name"\s+value="([^"]*)"', body)
        extruder = re.search(r'<metadata type="object" key="extruder" value="(\d+)"', body)
        entry = ObjectMeta(
            id=str(oid),
            name=os.path.splitext(name.group(1))[0] if name else None,
            extruder=_int(extruder.group(1)) if extruder else None,
        )
        for _vol_attrs, vol_body in re.findall(r"<volume\b([^>]*)>(.*?)</volume>", body, re.S):
            vname = re.search(r'key="name"\s+value="([^"]*)"', vol_body)
            matrix = re.search(r'key="matrix"\s+value="([^"]*)"', vol_body)
            source = re.search(r'key="source_file"\s+value="([^"]*)"', vol_body)
            vext = re.search(r'key="extruder"\s+value="(\d+)"', vol_body)
            vtype = re.search(r'key="volume_type"\s+value="([^"]*)"', vol_body)
            entry.parts.append(PartMeta(
                id=str(len(entry.parts) + 1),
                name=vname.group(1) if vname else None,
                matrix=matrix.group(1) if matrix else None,
                source_file=source.group(1) if source else None,
                extruder=_int(vext.group(1)) if vext else None,
                subtype=vtype.group(1) if vtype else "ModelPart",
            ))
        entry.volumes = len(entry.parts)
        meta[str(oid)] = entry
    return meta


def _refuse_hidden_roles(project: Project) -> None:
    """A control volume is not printed geometry, and this writer cannot say so.

    Every part this tool writes is declared ``normal_part``.  A negative volume,
    a parameter modifier or a support blocker read from the source would therefore
    be *solidified* -- a hole filled in, a support blocker printed.  Refusing the
    project is the honest alternative until the roles can be carried through.
    """
    for meta in project.meta.values():
        for part in meta.parts:
            if is_hidden_role(part.subtype):
                raise u1.ConvertError(
                    f"{meta.name or 'an object'} has a {part.subtype or 'control'} "
                    "volume (a negative, modifier or support-blocker part). This tool "
                    "writes every part as printable geometry, so it would fill in or "
                    "print something the model meant to remove; it will not open this "
                    "project")


def _refuse_prusa_volume_ranges(project: Project) -> None:
    """PrusaSlicer describes volumes as triangle ranges inside one mesh.

    ``Slic3r_PE_model.config`` gives each volume a ``firstid``/``lastid`` pair that
    selects triangles of the object's mesh and a filament for them.  This reader
    works in whole meshes and does not yet split one by triangle range, so a
    multi-volume object would be exported with *every* volume on the object's own
    filament -- the overrides silently lost.  Refusing here means the page never
    offers an export that would print the wrong colours.
    """
    for meta in project.meta.values():
        if len(meta.parts) > 1:
            raise u1.ConvertError(
                f"{meta.name or 'an object'} is described by {len(meta.parts)} "
                "PrusaSlicer volumes; this tool reads whole meshes, so their "
                "triangle-range filaments would be lost. Open it in PrusaSlicer and "
                "save one volume, or split it into separate objects first")


def _read_previews(zf: zipfile.ZipFile, plate_ids: set) -> dict:
    names = set(zf.namelist())
    out: dict = {}
    fallback = None
    for candidate in ("Metadata/thumbnail.png", "Metadata/top_1.png"):
        if candidate in names:
            fallback = candidate
            break
    for pid in sorted(plate_ids):
        found = None
        for candidate in (f"Metadata/plate_{pid}.png", "Metadata/thumbnail.png",
                          "Metadata/top_1.png"):
            if candidate in names:
                found = candidate
                break
        if found is None and fallback:
            found = fallback
        if found:
            out[pid] = (found, zf.read(found))
    return out


def read_project(zf: zipfile.ZipFile) -> Project:
    """Read a 3MF's object/plate structure without decoding its meshes."""
    project = Project()
    names = set(zf.namelist())
    if u1.SRC_PRUSA_MODEL in names:
        project.kind = "prusa"
    elif u1.SRC_BBL_PROJECT in names:
        project.kind = "bambu"
    elif u1.MODEL_FILE in names:
        project.kind = "plain"
    else:
        raise u1.ConvertError("not a 3MF archive (3D/3dmodel.model is missing)")

    objects, order, items = _scan_main_model(zf, u1.MODEL_FILE)
    project.objects = objects
    project.object_order = order
    project.items = items

    if project.kind == "prusa":
        # Not u1._read_prusa: that one is the single-object legacy converter and
        # refuses anything else.  The palette is all this reader needs, and it has
        # to come from either Slic3r_PE.config or the Full Spectrum description.
        src = u1.read_prusa_palette(zf)
        project.meta = _read_prusa_model_settings(zf)
        _refuse_prusa_volume_ranges(project)
    elif project.kind == "bambu":
        src = u1._read_bambu(zf)
        project.meta, project.plates = _read_bambu_model_settings(zf)
    else:
        src = u1.Source()
        src.colors = ["#FFFFFF"]
        src.types = ["PLA"]
        src.palette_count = 1

    project.colors = list(src.colors)
    project.types = list(src.types)
    project.palette_source = src.palette_source or (
        "filament_colour" if project.kind == "bambu" else
        "defaults" if project.kind == "plain" else "")
    project.palette_count = src.palette_count
    project.source_settings = src.source_settings
    project.support = src.support
    project.layer_height = src.layer_height
    project.base_extruder = src.base_extruder or 1

    try:
        if zf.getinfo(u1.MODEL_FILE).file_size <= 2 * 1024 * 1024:
            doc = zf.read(u1.MODEL_FILE).decode("utf-8", "replace")
            m = re.search(r'<metadata name="Title">([^<]*)</metadata>', doc)
            if m and m.group(1).strip():
                project.title = m.group(1).strip()
    except KeyError:
        pass

    for oid in list(project.objects):
        obj = project.objects[oid]
        if not obj.components and not obj.has_mesh:
            del project.objects[oid]
    if not project.objects:
        raise u1.ConvertError("the project holds no objects this tool can read")

    _refuse_hidden_roles(project)

    if not project.plates:
        printable = [it.objectid for it in project.items
                     if it.printable and it.objectid in project.objects]
        project.plates = [Plate(id=1, name="Plate 1",
                                entries=[PlateEntry(object_id=oid)
                                         for oid in _unique(printable)])]

    project.previews = _read_previews(zf, {p.id for p in project.plates})
    return project


# --------------------------------------------------------------------------------------
# selection and measurement
# --------------------------------------------------------------------------------------

def _matrix(text: str | None, where: str = "a transform"):
    """Parse a transform, and refuse to guess when it cannot be read."""
    if not text:
        return [row[:] for row in u1.IDENTITY]
    try:
        return u1.matrix_from_text(text)
    except (u1.ConvertError, ValueError, TypeError) as exc:
        raise u1.ConvertError(f"{where} could not be read ({text!r}): {exc}") from exc


def _matrix_key(matrix) -> tuple:
    return tuple(round(value, 9) for row in matrix for value in row)


def match_parts(meta: ObjectMeta | None, component_ids: list) -> list:
    """Part metadata aligned with an object's components, id first.

    Bambu and Orca write each part's id as the object id of the mesh it wraps, so
    that is the reliable key and the order in the file is not trusted.  When two
    components point at the same mesh the ids cannot distinguish them, so the
    remaining parts are handed out in order -- which is what the slicer means.
    """
    if meta is None or not meta.parts:
        return [None] * len(component_ids)
    parts = list(meta.parts)
    taken: set = set()
    out: list = []
    for cid in component_ids:
        index = next((i for i, p in enumerate(parts)
                      if i not in taken and str(p.id) == str(cid)), None)
        if index is None:
            out.append(None)
        else:
            taken.add(index)
            out.append(parts[index])
    spare = [p for i, p in enumerate(parts) if i not in taken]
    for position, entry in enumerate(out):
        if entry is None and spare:
            out[position] = spare.pop(0)
    return out


def _item_transform_text(project: Project, object_id) -> str | None:
    items = project.items_for(object_id)
    return items[0].transform if items else None


def _item_matrix(project: Project, object_id):
    return _matrix(_item_transform_text(project, object_id))


def mesh_index(zf: zipfile.ZipFile, project: Project, member: str) -> MeshIndex:
    key = str(member).lstrip("/")
    cached = project.mesh_cache.get(key)
    if cached is None:
        cached = _scan_member_objects(zf, key)
        project.mesh_cache[key] = cached
    return cached


def inner_object(zf, project: Project, member: str, oid) -> InnerObject | None:
    return mesh_index(zf, project, member).get(oid)


def instance_chain(zf, project: Project, object_id, item_transform) -> list:
    """[(member, inner object id, world matrix, component index)] for one instance.

    Components may point at another object (*inline* resources -- how PrusaSlicer
    and the "Generic" Bambu exports store a part), and an inner object may be an
    assembly of further objects, so this walks the whole graph.  A repeated
    component is recognised by its *full* transform (a rotation counts), a cycle is
    refused rather than followed forever, and a transform that cannot be read is
    an error rather than a silent identity.

    The component index says which of the object's own components led to this
    mesh, so part metadata can be matched to it exactly.
    """
    out: list = []
    obj = project.objects.get(str(object_id))
    if obj is None:
        return out
    base = _matrix(item_transform, f"the placement of object {object_id}")
    stack: list = []
    if obj.has_mesh:
        out.append((project.inline_member, obj.id, base, None))
    for index, comp in enumerate(obj.components):
        stack.append((comp, base, (str(object_id),), index))

    seen = set()
    while stack:
        comp, parent, path, index = stack.pop()
        where = f"a part transform under object {object_id}"
        world = u1.matmul(_matrix(comp.transform, where), parent)
        if comp.path:
            member = comp.path.lstrip("/")
            inner = mesh_index(zf, project, member).get(comp.objectid)
            if inner is None:
                raise u1.ConvertError(
                    f"{member} has no object {comp.objectid}, which object {object_id} "
                    "points at; the export cannot be built from this file")
            node = f"{member}#{comp.objectid}"
            if node in path:
                raise u1.ConvertError(
                    f"the component graph is cyclic ({' -> '.join(path + (node,))}); "
                    "this file cannot be exported")
            key = (member, str(comp.objectid), _matrix_key(world))
            if key in seen:
                continue
            seen.add(key)
            if inner.triangles:
                out.append((member, str(comp.objectid), world, index))
            for child_path, child_id, child_tf in inner.components:
                stack.append((Component(path=child_path or member, objectid=str(child_id),
                                        transform=child_tf), world, path + (node,), index))
        else:
            target = project.objects.get(str(comp.objectid))
            if target is None:
                raise u1.ConvertError(
                    f"object {object_id} refers to an object {comp.objectid} that is not "
                    "in the model")
            node = f"object#{comp.objectid}"
            if node in path:
                raise u1.ConvertError(
                    f"the component graph is cyclic ({' -> '.join(path + (node,))})")
            if target.has_mesh:
                key = (project.inline_member, target.id, _matrix_key(world))
                if key not in seen:
                    seen.add(key)
                    out.append((project.inline_member, target.id, world, index))
            for child in target.components:
                stack.append((child, world, path + (node,), index))
    return out


def component_chain(zf, project: Project, object_id) -> list:
    """The chain for an object's first instance (what a single-object file has)."""
    return instance_chain(zf, project, object_id, _item_transform_text(project, object_id))


def object_used_extruders(zf, project: Project, object_id) -> set:
    """Source extruders one object needs.

    The materials its paint names, plus a base filament only where geometry is
    actually left to one: a part whose every facet is overridden does not need
    its own filament printed.
    """
    return {e for e in _object_report(zf, project, object_id)["used"] if e >= 1}


def eligible_objects(project: Project, plate_id=None) -> list:
    """Object ids on a plate that can be exported at all, in plate order.

    An object with no *printable* build item is left out: there is nowhere to put
    it, and inventing a placement would be worse than saying so.
    """
    plate = project.plate(plate_id) if plate_id is not None else None
    if plate is None and project.plates:
        plate = project.plates[0]
    out: list = []
    seen: set = set()
    if plate is not None:
        for entry in plate.entries:
            oid = entry.object_id
            if oid in seen or oid not in project.objects:
                continue
            if not project.printable_items_for(oid):
                continue
            seen.add(oid)
            out.append(oid)
        return out
    for item in project.items:
        if item.printable and item.objectid in project.objects \
                and item.objectid not in seen:
            seen.add(item.objectid)
            out.append(item.objectid)
    return out


def selection_instances(project: Project, selection: Selection) -> list:
    """[(object id, item transform)] in plate order, one entry per instance.

    A plate lists an object once per instance it carries, with the *instance id*
    the slicer gave it.  That id selects the matching build item, so choosing one
    object never drags in another plate's copies of it and a repeated instance is
    not multiplied by the number of build items.
    """
    out: list = []
    plate = project.plate(selection.plate_id) if selection.plate_id is not None else None
    wanted = set(selection.as_ids())
    if plate is not None:
        used: dict = {}
        for entry in plate.entries:
            oid = entry.object_id
            if oid not in wanted or oid not in project.objects:
                continue
            items = project.printable_items_for(oid)
            if not items:
                continue
            index = used.get(oid, 0)
            used[oid] = index + 1
            slot = index if entry.instance_id is None else _int(entry.instance_id, index)
            if slot is None or not 0 <= slot < len(items):
                project.warnings.append(
                    f"plate {plate.id} lists instance {entry.instance_id} of object {oid}, "
                    f"which is not among that object's {len(items)} printable build "
                    "item(s); that instance is left out of this export")
                continue
            out.append((oid, items[slot].transform))
        return out
    for item in project.items:
        if item.printable and item.objectid in wanted:
            out.append((item.objectid, item.transform))
    return out


def select(project: Project, plate_id=None, object_ids=None) -> Selection:
    """Default to the first plate and all of its objects; validate anything else.

    ``object_ids=None`` means "everything the plate can export"; an explicit empty
    list means "nothing", which is an error rather than a silent fallback to all.
    """
    if plate_id is not None:
        plate = project.plate(_int(plate_id, -1))
        if plate is None:
            raise u1.ConvertError(
                f"the project has no plate {plate_id}; it has "
                + ", ".join(str(p.id) for p in project.plates))
    else:
        plate = project.plates[0]
    known = eligible_objects(project, plate.id)
    if object_ids is None:
        chosen = _unique(known)
    else:
        wanted = [str(o).strip() for o in object_ids if str(o).strip()]
        if not wanted:
            raise u1.ConvertError(
                f"no objects were selected on plate {plate.id}; this plate can export "
                + ", ".join(known))
        unknown = [o for o in wanted if o not in project.objects]
        if unknown:
            raise u1.ConvertError(
                "unknown object id(s): " + ", ".join(unknown)
                + ". This plate holds " + ", ".join(known))
        outside = [o for o in wanted if o not in known]
        if outside:
            raise u1.ConvertError(
                "object(s) " + ", ".join(outside)
                + f" cannot be exported from plate {plate.id} (they are not on it, or they "
                "have no printable instance); one plate is exported at a time")
        chosen = _unique(wanted)
    if not chosen:
        raise u1.ConvertError(f"plate {plate.id} has no printable objects")
    return Selection(plate_id=plate.id, object_ids=chosen)


def measure(zf, project: Project, selection: Selection) -> dict:
    """World bounding box of the selection, plus its triangle and part counts."""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    triangles = 0
    parts = 0
    for object_id, item_transform in selection_instances(project, selection):
        for member, oid, matrix, _index in instance_chain(zf, project, object_id, item_transform):
            inner = inner_object(zf, project, member, oid)
            if inner is None or not inner.bounds:
                continue
            parts += 1
            triangles += inner.triangles
            blo, bhi = u1.world_aabb(matrix, inner.bounds[0], inner.bounds[1])
            for i in range(3):
                lo[i] = min(lo[i], blo[i])
                hi[i] = max(hi[i], bhi[i])
    if lo[0] == float("inf"):
        return {"lo": None, "hi": None, "triangles": triangles, "parts": parts, "size": None}
    return {
        "lo": tuple(lo), "hi": tuple(hi), "parts": parts, "triangles": triangles,
        "size": (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]),
    }


# --------------------------------------------------------------------------------------
# assessment
# --------------------------------------------------------------------------------------

def _object_report(zf, project: Project, object_id: str) -> dict:
    chain = component_chain(zf, project, object_id)
    detail: dict = {}
    split = 0
    support = 0
    triangles = 0
    parts = 0
    undecodable = 0
    painted = 0
    meta = project.meta.get(str(object_id))
    parts_meta = match_parts(meta, [str(c.objectid) for c in
                                    project.objects[str(object_id)].components])
    for member, inner_id, _matrix_, index in chain:
        inner = inner_object(zf, project, member, inner_id)
        if inner is None:
            continue
        parts += 1
        triangles += inner.triangles
        split += inner.split
        support += inner.support_painted
        undecodable += inner.undecodable
        painted += inner.painted_triangles()
        for state, count in inner.leaf_states.items():
            detail[state] = detail.get(state, 0) + count
        for state in inner.split_leaf_states:
            detail.setdefault(state, 0)
    used = {e for e in detail if e}
    # A base filament is only a colour the print needs where geometry is left to
    # it: partly painted parts, or parts with no paint at all.  A part whose every
    # facet is overridden contributes only the colours it actually paints.
    for member, inner_id, _matrix_, index in chain:
        inner = inner_object(zf, project, member, inner_id)
        if inner is None or not inner.uses_base():
            continue
        extruder = None
        part = parts_meta[index] if index is not None and index < len(parts_meta) else None
        if part is not None and part.extruder:
            extruder = part.extruder
        elif meta is not None and meta.extruder:
            extruder = meta.extruder
        used.add(extruder or project.base_extruder)
    used = {e for e in used if e >= 1}
    return {
        "id": str(object_id),
        "name": project.object_name_for(object_id),
        "parts": parts,
        "source_parts": len(meta.parts) if meta is not None else 0,
        "triangles": triangles,
        "painted": painted,
        "subdivided": split,
        "undecodable": undecodable,
        "supports_painted": support > 0,
        "used": used,
        "detail": detail,
    }


def analyse(zf: zipfile.ZipFile, project: Project, selection: Selection | None = None,
            plan: Plan | None = None) -> dict:
    """Everything the page needs in order to describe a selection honestly.

    Every object the plate can export is reported, each flagged with whether it
    is in the selection; the counts, colours and options describe the selection
    only.  The page needs the whole list because unticking an object must not make
    it disappear from the page.
    """
    selection = selection or select(project)
    plan = plan or Plan()
    instances = selection_instances(project, selection)
    eligible = eligible_objects(project, selection.plate_id)
    reports = {oid: _object_report(zf, project, oid) for oid in eligible}
    chosen = [oid for oid in selection.as_ids() if oid in reports]
    if not chosen:
        raise u1.ConvertError("none of the selected objects can be exported from that plate")

    used: set = set()
    painted_by_extruder: dict = {}
    painted_total = 0
    split_total = 0
    support_total = 0
    triangle_total = 0
    undecodable_total = 0
    part_total = 0
    for report in (reports[oid] for oid in chosen):
        used |= report["used"]
        painted_total += report["painted"]
        split_total += report["subdivided"]
        support_total += 1 if report["supports_painted"] else 0
        triangle_total += report["triangles"]
        undecodable_total += report["undecodable"]
        part_total += report["parts"]
        for state, count in report["detail"].items():
            painted_by_extruder[state] = painted_by_extruder.get(state, 0) + count

    used_sorted = sorted(used)
    source_colors = {e: project.color_for(e) for e in used_sorted}
    measurement = measure(zf, project, selection)
    mapping = dict(plan.mapping) if plan.mapping else \
        u1colour.suggest_mapping(source_colors, plan.colors())
    identity = {e: i + 1 for i, e in enumerate(used_sorted)}
    plate = project.plate(selection.plate_id)
    palette_size = max(project.palette_count, len(used_sorted))

    objects = []
    plate_triangles = 0
    for oid in eligible:
        report = reports[oid]
        plate_triangles += report["triangles"]
        entry = {k: v for k, v in report.items() if k not in ("used", "detail")}
        entry["instances"] = len([1 for o, _t in instances if o == report["id"]])
        entry["selected"] = report["id"] in chosen
        entry["colours"] = [
            {
                "extruder": e,
                "color": project.color_for(e),
                "type": project.type_for(e),
                "painted_triangles": report["detail"].get(e, 0),
            }
            for e in sorted(report["used"])
        ]
        objects.append(entry)

    groups = separate_prints(zf, project, selection)
    mixtures = (u1mix.plan_mixtures(source_colors, plan.filaments)
                if source_colors else None)
    spectrum = None
    if mixtures:
        spectrum = {
            "physical": [dict(f) for f in plan.filaments],
            "recipes": mixtures["recipes"],
            "rows": mixtures["rows"],
            "advice": mixtures["advice"],
            "coverage": mixtures["coverage"],
            "worst_solid_error": mixtures["worst_solid_error"],
            "uncalibrated": True,
            "max_recipes": u1spectrum.MAX_RECIPES,
            "suggested_mapping": u1mix.mapping_from_plan(mixtures),
        }
    options = assess_options(project, selection, used_sorted, groups,
                             undecodable_total, len(used_sorted) <= MAX_SLOTS,
                             spectrum)
    direct_possible = len(used_sorted) <= MAX_SLOTS and undecodable_total == 0
    return {
        "multipart": True,
        "kind": project.kind,
        "title": project.title,
        "plates": [
            {
                "id": p.id,
                "name": p.name,
                "objects": len([o for o in _unique(p.object_ids) if o in project.objects]),
                "instances": len([o for o in p.object_ids if o in project.objects]),
                "selected": p.id == selection.plate_id,
            }
            for p in project.plates
        ],
        "plate": ({"id": plate.id, "name": plate.name} if plate is not None else None),
        "selection": {"plate": selection.plate_id, "objects": selection.as_ids()},
        "objects": objects,
        "source": {
            "palette_size": project.palette_count,
            "palette_source": project.palette_source,
            "used": len(used_sorted),
            "slots": [
                {
                    "extruder": e,
                    "color": project.color_for(e),
                    "type": project.type_for(e),
                    "used": e in used,
                    "painted_triangles": painted_by_extruder.get(e, 0),
                }
                for e in range(1, palette_size + 1)
            ],
        },
        "counts": {
            "objects": len(chosen),
            "instances": len(instances),
            "parts": part_total,
            "triangles": triangle_total,
            "painted_triangles": painted_total,
            "subdivided_triangles": split_total,
            "undecodable_paint": undecodable_total,
            "plate_objects": len(eligible),
            "plate_triangles": plate_triangles,
        },
        "measurement": measurement,
        "fit": fit(measurement, plan),
        "options": options,
        "mapping": {
            "suggested": mapping,
            "identity": identity,
            "used": used_sorted,
            "comparison": u1colour.comparison(source_colors, mapping, plan.colors()),
            "direct_possible": direct_possible,
            "unknown_paint": undecodable_total,
        },
        "source_colors": source_colors,
        "separate": {"groups": groups, "prints": len(groups)},
        "spectrum": spectrum,
        "loaded": [dict(f) for f in plan.filaments],
        "warnings": (list(project.warnings)
                     + palette_warnings(project, used_sorted)
                     + selection_warnings(selection, used_sorted, split_total,
                                          undecodable_total, groups)),
    }


def fit(measurement: dict, plan: Plan) -> dict:
    cfg = u1.build_project_config(u1.load_base_template(), None, plan.colors(),
                                  plan.types(), u1.DEFAULT_FILAMENT,
                                  u1.DEFAULT_MACHINE, u1.DEFAULT_PROCESS)
    x0, x1, y0, y1 = u1.printable_bounds(cfg)
    bed_x, bed_y = x1 - x0, y1 - y0
    if measurement["size"] is None:
        return {"fits": None, "reason": "the selected geometry could not be measured",
                "bed": {"x": round(bed_x, 2), "y": round(bed_y, 2)}}
    size_x, size_y, size_z = measurement["size"]
    fits = size_x <= bed_x and size_y <= bed_y
    return {
        "fits": fits,
        "size": {"x": round(size_x, 2), "y": round(size_y, 2), "z": round(size_z, 2)},
        "bed": {"x": round(bed_x, 2), "y": round(bed_y, 2)},
        "reason": "" if fits else (
            f"the selection measures {size_x:.1f} x {size_y:.1f} mm, more than the U1's "
            f"{bed_x:.0f} x {bed_y:.0f} mm plate; it is still written centred, so expect a "
            "warning in the slicer"),
    }


def palette_warnings(project: Project, used: list) -> list:
    """Used paint ids the project's palette does not describe.

    A native project can name more colours in its paint than its palette array
    lists (an unsupported palette source, a truncated file, a hand-edited 3MF).
    Those ids are drawn white so the page is not blank, but the assessment has to
    say so instead of presenting white as if it were the colour the file meant.
    """
    missing = [int(e) for e in used if int(e) > len(project.colors)]
    if not missing:
        return []
    plural = "colours" if len(missing) > 1 else "colour"
    where = (f"in {project.palette_source}" if project.palette_source
             else "anywhere in the file")
    return [f"the paint uses {plural} {', '.join(str(m) for m in missing)} that the "
            f"palette does not list {where}; they are shown as white, so any mapping "
            "onto them cannot be trusted"]


def selection_warnings(selection: Selection, used: list, split_total: int,
                       undecodable: int, groups: list) -> list:
    out = []
    if len(used) > MAX_SLOTS:
        out.append(
            f"this selection uses {len(used)} source colours "
            f"({', '.join(str(u) for u in used)}) and the U1 has {MAX_SLOTS}. "
            "Export the groups as separate prints, or map the colours onto the loaded "
            "filaments.")
    if split_total:
        out.append(
            f"{split_total} triangles carry sub-divided paint. Those values are rewritten "
            "state by state, and the export stops rather than write a colour that would be "
            "wrong if any value cannot be decoded.")
    if undecodable:
        out.append(
            f"{undecodable} painted triangles carry a value this tool cannot decode; they are "
            "copied through unchanged, and a remap that would need to touch them is refused.")
    if len(groups) == 1 and len(used) > MAX_SLOTS:
        out.append("no split of these objects fits four colours on its own; simplify the "
                   "palette or print in more than one job")
    if selection.plate_id is None:
        out.append("this file has no plate information; every printable object is included")
    return out


def separate_prints(zf, project: Project, selection: Selection) -> list:
    """Group whole objects into prints that each fit four colours.

    Objects are never split into parts: a part is not a separate print unless the
    user assembles it afterwards, and that is not a call this tool makes for them.
    """
    groups: list = []
    for oid in selection.as_ids():
        used = object_used_extruders(zf, project, oid)
        for group in groups:
            if len(group["extruders"] | used) <= MAX_SLOTS:
                group["objects"].append(oid)
                group["extruders"] |= used
                break
        else:
            groups.append({"objects": [oid], "extruders": set(used)})
    out = []
    for group in groups:
        out.append({
            "objects": group["objects"],
            "ids": list(group["objects"]),
            "names": [project.object_name_for(o) for o in group["objects"]],
            "extruders": sorted(group["extruders"]),
            "colours": [
                {"extruder": e, "color": project.color_for(e)}
                for e in sorted(group["extruders"])
            ],
            "fits": len(group["extruders"]) <= MAX_SLOTS,
        })
    return out


def assess_options(project: Project, selection: Selection, used: list, groups: list,
                   unknown_paint: int = 0, fits_slots: bool = True,
                   spectrum: dict | None = None) -> list:
    """The honest menu: what is possible, what it costs, what is not available."""
    fits_direct = fits_slots and unknown_paint == 0
    split_ok = len(groups) > 1 and all(g["fits"] for g in groups)
    if unknown_paint and fits_slots:
        direct_detail = (
            f"{unknown_paint} painted triangles in this selection carry a value this tool "
            "cannot read, so the number of colours it needs is not confirmed. They are "
            "copied through unchanged; their colours cannot be renumbered.")
    elif fits_slots:
        direct_detail = (
            f"One print, one filament per colour: {len(used)} colours into slots 1-"
            f"{len(used)}, with the source colours carried over unchanged.")
    else:
        direct_detail = (
            f"This selection needs {len(used)} colours and the plate has {MAX_SLOTS}. "
            "Nothing is substituted for you.")
    recipes = list((spectrum or {}).get("recipes") or [])
    if spectrum is None:
        spectrum_detail = "There are no source colours to compare against the reels."
    elif recipes:
        spectrum_detail = (
            f"{len(recipes)} predicted mixture"
            f"{'' if len(recipes) == 1 else 's'} would place "
            f"{sum(1 for r in spectrum['rows'] if r.get('choice') == 'mixture')} of "
            f"{len(spectrum['rows'])} source colours on a blend the four reels cannot "
            "reach on their own. Tick the ones you want; the export writes them after "
            "your four reels and points each painted triangle at whichever is closest. "
            "The shades are predicted from the swatch values and are not calibrated, "
            "which is why the export waits for you to review them. "
            + (spectrum.get("advice") or ""))
    else:
        spectrum_detail = (spectrum.get("advice") or
                           "No mixture is worth offering with these reels.")
    return [
        {
            "id": "direct",
            "title": "Direct four-slot print" + ("" if fits_direct else " (not available)"),
            "feasible": fits_direct,
            "action": "export" if fits_direct else None,
            "detail": direct_detail,
        },
        {
            "id": "separate",
            "title": "Separate prints per object group",
            "feasible": split_ok,
            "action": "select-group" if split_ok else None,
            "prints": len(groups),
            "groups": [{"ids": g["ids"], "names": g["names"], "colours": g["colours"]}
                       for g in groups],
            "detail": (
                "Each object keeps its own colours: "
                + "; ".join(f"print {i + 1}: {', '.join(g['names'])} "
                            f"({len(g['extruders'])} colours)"
                            for i, g in enumerate(groups))
                + ". Objects are never split into parts, so any assembly stays your call."
                if split_ok else
                ("Only one group is possible with these objects; a single object that needs "
                 "more than four colours cannot be split by object."
                 if len(groups) <= 1 else
                 "At least one object needs more than four colours on its own.")),
        },
        {
            "id": "simplify",
            "title": "Simplify to the loaded filaments",
            "feasible": bool(used),
            "action": "export",
            "detail": (
                f"Map each of the {len(used)} source colours onto the four loaded filaments. "
                "The nearest match is only a suggestion from the swatch colours you enter, "
                "and every colour can be pointed somewhere else."),
        },
        {
            "id": "full-spectrum",
            "title": "Mix the loaded reels (Full Spectrum)",
            "feasible": bool(recipes),
            "action": "spectrum" if recipes else None,
            "detail": spectrum_detail,
            "recipes": recipes,
            "rows": (spectrum or {}).get("rows") or [],
            "advice": (spectrum or {}).get("advice") or "",
            "max_recipes": u1spectrum.MAX_RECIPES,
        },
    ]


# --------------------------------------------------------------------------------------
# plan validation
# --------------------------------------------------------------------------------------

def legacy_path_problem(zf, project: Project) -> str | None:
    """Why the single-object converter cannot handle this file, or None.

    The legacy path in u1convert is unchanged for the shape it was written for:
    one plate, one instance of one object built from one mesh.  Anything else --
    or a selection that needs more than four colours -- is handed to this module.
    """
    if len(project.plates) > 1:
        return f"the project has {len(project.plates)} plates"
    plate = project.plates[0]
    known = [oid for oid in _unique(plate.object_ids) if oid in project.objects]
    if len(known) != 1 or len(plate.object_ids) != 1:
        return f"plate {plate.id} holds {len(plate.object_ids)} objects"
    object_id = known[0]
    obj = project.objects[object_id]
    if len(project.items_for(object_id)) > 1:
        return f"object {object_id} is placed more than once"
    if len(obj.components) > 1:
        return f"object {object_id} is built from {len(obj.components)} parts"
    for comp in obj.components:
        if not comp.path:
            return "a part is stored inside the main model file"
        member = comp.path.lstrip("/")
        index = mesh_index(zf, project, member)
        if len(index.objects) != 1 or index.get(comp.objectid) is None:
            return f"{os.path.basename(member)} holds {len(index.objects)} objects"
    used = object_used_extruders(zf, project, object_id)
    if len(used) > MAX_SLOTS:
        return f"the model uses {len(used)} colours"
    return None


def plan_for(zf, project: Project, selection: Selection, slots=None, slot_types=None,
             mapping=None, approximate: bool = False,
             require_explicit: bool = True, intent: str | None = None) -> Plan:
    """Derive a plan from what the user supplied, and say which mode it implies.

    A *direct* plan keeps every source colour and its order: slots 1..N take the
    source colours, and no filament is replaced.  Anything the user changes --
    a different swatch, a mapping that merges or reorders -- makes it an
    *approximation*, which is the only mode allowed to substitute a colour.

    ``intent`` settles it when the caller already knows which export the user
    asked for: "direct" ignores any reel colours that came along for the ride, and
    "approximate" will not be mistaken for one.  Without it the intent is inferred
    (that is what the command line does).

    When the selection needs more colours than the plate has and the user has not
    named the loaded filaments, this asks rather than substituting quietly
    (``require_explicit`` is False when the caller is only reporting).
    """
    plan = Plan()
    used = sorted({e for oid in selection.as_ids()
                   for e in object_used_extruders(zf, project, oid)})
    identity = {e: i + 1 for i, e in enumerate(used)}

    def source_plan() -> Plan:
        if len(used) > MAX_SLOTS:
            raise u1.ConvertError(
                f"this selection needs {len(used)} source colours "
                f"({', '.join(str(u) for u in used)}) and the U1 has {MAX_SLOTS}; a "
                "direct export cannot keep them all. Export the groups as separate "
                "prints, or name the loaded filaments and map the colours onto them.")
        plan.mode = "direct"
        plan.mapping = dict(identity)
        plan.filaments = [dict(f) for f in DEFAULT_FILAMENTS]
        for i, extruder in enumerate(used):
            plan.filaments[i] = {"slot": i + 1, "color": project.color_for(extruder),
                                 "type": project.type_for(extruder)}
        return plan

    if intent == "direct":
        return source_plan()

    given_colors = [u1colour.norm(c) for c in (slots or [])]
    given_types = [str(t).upper() for t in (slot_types or [])]
    given_mapping = {int(k): int(v) for k, v in (mapping or {}).items()}
    direct_possible = len(used) <= MAX_SLOTS
    explicit = bool(given_colors or given_mapping or approximate) or intent == "approximate"

    if direct_possible and not explicit:
        return source_plan()

    if not direct_possible and not explicit and require_explicit:
        raise u1.ConvertError(
            f"this selection uses {len(used)} source colours "
            f"({', '.join(str(u) for u in used)}) and the U1 has {MAX_SLOTS}. "
            "Export the groups as separate prints, or name the four loaded filaments "
            "with --slots and let the colours be mapped onto them with --approximate. "
            "Run with --list-plates to see the options.")

    plan.mode = "approximate"
    if given_colors:
        plan.filaments = [
            {
                "slot": i + 1,
                "color": given_colors[i] if i < len(given_colors) else
                         u1colour.norm(DEFAULT_FILAMENTS[i]["color"]),
                "type": given_types[i] if i < len(given_types) else
                        DEFAULT_FILAMENTS[i]["type"],
            }
            for i in range(MAX_SLOTS)
        ]
    elif direct_possible:
        plan.filaments = [dict(f) for f in DEFAULT_FILAMENTS]
        for i, extruder in enumerate(used):
            plan.filaments[i] = {"slot": i + 1, "color": project.color_for(extruder),
                                 "type": project.type_for(extruder)}
    else:
        plan.filaments = [dict(f) for f in DEFAULT_FILAMENTS]

    plan.mapping = given_mapping or u1colour.suggest_mapping(
        {e: project.color_for(e) for e in used}, plan.colors())
    return plan


def validate_plan(zf, project: Project, selection: Selection, plan: Plan,
                  copies: int = 1, max_slot: int = MAX_SLOTS,
                  require_slots: int = MAX_SLOTS) -> list:
    errors: list = []
    used = sorted({e for oid in selection.as_ids()
                   for e in object_used_extruders(zf, project, oid)})
    colors = plan.colors()
    types = plan.types()
    mapping = dict(plan.mapping or {})
    if plan.mode not in ("direct", "approximate"):
        errors.append(f"unknown export mode {plan.mode!r}")
    if len(colors) != require_slots or len(types) != require_slots:
        errors.append(f"a plan needs exactly {require_slots} loaded filaments")
    for i, color in enumerate(colors, 1):
        if not u1colour.norm(color):
            errors.append(f"slot {i} has no usable colour ({color!r})")
    if copies > 1:
        errors.append("copies and fill-bed are not offered for a multi-object plate; the "
                      "source layout is kept as it is")
    for extruder in used:
        slot = mapping.get(extruder)
        if not isinstance(slot, int) or not 1 <= slot <= max_slot:
            errors.append(f"source colour {extruder} "
                          f"({project.color_for(extruder)}) is not assigned to a slot")
    if plan.mode == "direct":
        if len(used) > max_slot:
            errors.append(
                f"a direct export keeps every source colour and this selection has "
                f"{len(used)}; the U1 has {max_slot}")
        for i, extruder in enumerate(used, 1):
            if mapping.get(extruder) != i:
                errors.append(
                    f"a direct export keeps the source colours in order in slots 1-{len(used)}; "
                    f"colour {extruder} is going to slot {mapping.get(extruder)}")
                break
        for extruder in used:
            slot = mapping.get(extruder)
            if isinstance(slot, int) and 1 <= slot <= max_slot \
                    and u1colour.norm(colors[slot - 1]) != u1colour.norm(
                        project.color_for(extruder)):
                errors.append(
                    f"slot {slot} is {colors[slot - 1]} but source colour {extruder} is "
                    f"{project.color_for(extruder)}; use an approximation export to load a "
                    "different filament")
    return errors


# --------------------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------------------

MEMBER_HEADER = (u1.XML_HEADER
                 + '<model unit="millimeter" xml:lang="en-US" '
                   'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
                   'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
                   'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" '
                   'requiredextensions="p">\n'
                   ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n'
                   " <resources>\n")

MEMBER_FOOTER = " </resources>\n <build/>\n</model>\n"


def _member_output_name(project: Project, member: str, inline_ids) -> str:
    base = os.path.basename(member)
    if member == project.inline_member:
        ids = sorted(str(i) for i in inline_ids)
        suffix = "_".join(ids[:3]) if ids else "inline"
        base = f"object_{suffix}.model"
    return u1.OBJECTS_DIR + base


def _needed_inner(zf, project: Project, member: str, roots) -> list:
    """Inner object ids of one member needed to place ``roots``, transitively."""
    index = mesh_index(zf, project, member)
    seen = set()
    stack = [str(r) for r in roots]
    while stack:
        oid = stack.pop()
        if oid in seen:
            continue
        seen.add(oid)
        inner = index.get(oid)
        if inner is None:
            continue
        for path, child, _transform in inner.components:
            # a child with no path lives in this same member; one that names this
            # member is the same thing written explicitly
            if not path or path.lstrip("/") == member:
                stack.append(str(child))
    return [oid for oid in index.order if oid in seen]


def _rewrite_paint(line: str, mapping: dict, stats: dict, where: str,
                   paint_attr: str = "paint_color") -> str:
    active = {k: v for k, v in mapping.items() if k != v}

    def decides_its_own_state(text: str) -> bool:
        """True when this value must be rewritten, False when it can be copied.

        A value the codec cannot explain is fine to copy through untouched, but
        the moment a remap would have to look inside it the export stops: writing
        it back as something else would silently change a colour.
        """
        if not active:
            return False
        try:
            states = u1paint.walk_states(u1paint.decode(text))
        except u1paint.PaintError as exc:
            raise u1.ConvertError(
                f"a painted triangle in {where} carries a paint value this tool cannot "
                f"read ({exc}), and this export renumbers the colours; it stopped instead "
                "of writing a colour that would be wrong") from exc
        high = sorted({s for s in states if s > u1paint.SUPPORTED_STATE_MAX})
        if high:
            raise u1.ConvertError(
                f"a painted triangle in {where} uses filament id(s) "
                f"{', '.join(str(s) for s in high)}, above the "
                f"{u1paint.SUPPORTED_STATE_MAX} this tool writes; newer files encode "
                "ids that high differently, so this export stopped instead of "
                "renumbering them")
        return any(state and state in active for state in states)

    def replace(match):
        text = match.group(1)
        if text and decides_its_own_state(text):
            try:
                text = u1paint.remap_text(text, mapping)
            except u1paint.PaintError as exc:
                raise u1.ConvertError(
                    f"a painted triangle in {where} carries a paint value this tool cannot "
                    f"rewrite completely ({exc}); the export stopped instead of writing a "
                    "colour that would be wrong") from exc
        stats["painted"] = stats.get("painted", 0) + 1
        return '%s="%s"' % (paint_attr, text)

    return re.sub(r'(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"',
                  replace, line)


def _copy_member(zf: zipfile.ZipFile, member: str, out, keep: set, mapping: dict,
                 stats: dict, attrs: dict | None = None):
    """Stream one mesh-bearing member into the output, pruned to ``keep`` objects."""
    attrs = attrs or {"paint": "paint_color", "rewrites": SUPPORT_ATTRS}
    out.write(u1targets.member_header(attrs).encode("utf-8"))
    current = None
    skipping = False
    in_mesh = False
    kept = []
    with zf.open(member) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
            stripped = line.lstrip()
            if skipping:
                if stripped.startswith("</object>"):
                    skipping = False
                continue
            if stripped.startswith("<object"):
                oid = str(_attr(_tag_attrs(stripped), "id"))
                if oid not in keep:
                    skipping = "</object>" not in stripped
                    current = None
                    continue
                current = oid
                kept.append(oid)
                in_mesh = False
            elif stripped.startswith("</object>"):
                if current is not None:
                    out.write(line.encode("utf-8"))
                    current = None
                    in_mesh = False
                continue
            elif current is None:
                continue

            if stripped.startswith("<mesh"):
                in_mesh = True
            elif _is_triangle(stripped) and in_mesh:
                stats["triangles"][current] = stats["triangles"].get(current, 0) + 1
                if "mmu_segmentation" in line or "paint_color" in line:
                    line = _rewrite_paint(line, mapping, stats,
                                          f"{os.path.basename(member)} object {current}",
                                          attrs["paint"])
                for old, new in attrs["rewrites"]:
                    if old in line:
                        line = line.replace(old + "=", new + "=")
            out.write(line.encode("utf-8"))
    out.write(MEMBER_FOOTER.encode("utf-8"))
    stats.setdefault("objects", {})[member] = kept


def _unique_part_id(existing: list, wanted: str) -> str:
    if wanted not in existing:
        return wanted
    n = len(existing) + 1
    while str(n) in existing:
        n += 1
    return str(n)


def _has_support_paint(zf, project: Project, selection: Selection) -> bool:
    for oid in selection.as_ids():
        for member, inner_id, _matrix_, _index in component_chain(zf, project, oid):
            inner = inner_object(zf, project, member, inner_id)
            if inner is not None and inner.support_painted:
                return True
    return False


def is_whole_plate(project: Project, selection: Selection) -> bool:
    plate = project.plate(selection.plate_id)
    if plate is None:
        return False
    known = {o for o in plate.object_ids if o in project.objects}
    return known == set(selection.as_ids())


def plate_offset(measurement: dict, cfg: dict):
    """One rigid translation that centres the selection on the U1 bed, Z=0."""
    x0, x1, y0, y1 = u1.printable_bounds(cfg)
    offset = [row[:] for row in u1.IDENTITY]
    if not measurement.get("lo"):
        return offset
    lo, hi = measurement["lo"], measurement["hi"]
    offset[3][0] = (x0 + x1) / 2.0 - (lo[0] + hi[0]) / 2.0
    offset[3][1] = (y0 + y1) / 2.0 - (lo[1] + hi[1]) / 2.0
    offset[3][2] = -lo[2] if abs(lo[2]) > 0.01 else 0.0
    return offset


def export(zf: zipfile.ZipFile, project: Project, selection: Selection, plan: Plan,
           out_path: str, *, profile_root: str | None = None,
           machine: str = u1.DEFAULT_MACHINE, process: str = u1.DEFAULT_PROCESS,
           filament_profile: str | None = None, supports: str = "auto",
           carry: bool = True, title: str | None = None, copies: int = 1,
           spectrum: dict | None = None, target: str = "snapmaker") -> dict:
    """Write the selected plate and objects as a Snapmaker U1 project."""
    target = u1targets.normalise(target)
    attrs = u1targets.attrs_for(target)
    recipes = list((spectrum or {}).get("recipes") or [])
    try:
        u1spectrum.check(MAX_SLOTS, recipes)
        u1spectrum.check_types(plan.types(), recipes)
        if recipes:
            plan.mapping = u1spectrum.mapping_with_recipes(plan.mapping, MAX_SLOTS)
    except u1spectrum.SpectrumError as exc:
        raise u1.ConvertError(str(exc)) from exc
    errors = validate_plan(
        zf, project, selection, plan, copies=copies,
        max_slot=MAX_SLOTS + len(recipes), require_slots=MAX_SLOTS)
    if errors:
        raise u1.ConvertError("; ".join(errors))

    profiles = u1.Profiles(profile_root) if profile_root else None
    filament_profile = filament_profile or u1.DEFAULT_FILAMENT
    physical_colors = plan.colors()
    physical_types = plan.types()
    colors = list(physical_colors)
    types = list(physical_types)
    if target == "snapmaker":
        cfg = u1.build_project_config(u1.load_base_template(), profiles, colors, types,
                                      filament_profile, machine, process)
        if recipes:
            cfg = u1spectrum.apply(cfg, physical_colors, physical_types, recipes,
                                   filament_profile)
        carried = u1.carry_print_settings(cfg, project.source_settings, carry)
        support_note = u1.apply_support(
            cfg, project.support, supports,
            painted=_has_support_paint(zf, project, selection))
    else:
        # A portable colour project: geometry, parts, palette and recipes, and no
        # U1 printer, process or start/end G-code at all.
        cfg = u1targets.config(target, physical_colors, physical_types, recipes,
                               filament_profile)
        carried, support_note = [], ("not written: a portable project carries no "
                                    "printer or process settings")
    if recipes and target == "snapmaker":
        problems = u1spectrum.validate(cfg, MAX_SLOTS, recipes)
        if problems:
            raise u1.ConvertError("the Full Spectrum settings are not self-consistent: "
                                  + "; ".join(problems[:3]))

    instances = selection_instances(project, selection)
    measurement = measure(zf, project, selection)
    offset = plate_offset(measurement, cfg)
    mapping = dict(plan.mapping)
    used_source = sorted({e for oid in selection.as_ids()
                          for e in object_used_extruders(zf, project, oid)})
    remapped: dict = {e: mapping[e] for e in used_source if e in mapping}

    member_roots: dict = {}
    inline_ids: set = set()
    graph = []
    for object_id, item_transform in instances:
        obj = project.objects[str(object_id)]
        base = _matrix(item_transform, f"the placement of object {object_id}")
        components = []
        for comp in obj.components:
            world = u1.matmul(_matrix(comp.transform,
                                      f"a part transform under object {object_id}"), base)
            if comp.path:
                member = comp.path.lstrip("/")
                member_roots.setdefault(member, set()).add(str(comp.objectid))
                components.append({"member": member, "objectid": str(comp.objectid),
                                   "matrix": world})
            else:
                inner_target = project.objects.get(str(comp.objectid))
                if inner_target is None or not inner_target.has_mesh:
                    continue
                inline_ids.add(str(inner_target.id))
                member_roots.setdefault(project.inline_member, set()).add(
                    str(inner_target.id))
                components.append({"member": project.inline_member,
                                   "objectid": str(inner_target.id), "matrix": world})
        if obj.has_mesh:
            inline_ids.add(str(obj.id))
            member_roots.setdefault(project.inline_member, set()).add(str(obj.id))
            components.append({"member": project.inline_member, "objectid": str(obj.id),
                               "matrix": base})
        meta = project.meta.get(str(object_id))
        graph.append({
            "source": str(object_id),
            "components": components,
            "parts_meta": match_parts(meta, [str(c.objectid) for c in obj.components]),
        })

    # Follow references that cross from one mesh member into another, so a nested
    # assembly is copied whole rather than left pointing at a file we did not write.
    queue = [(member, set(roots)) for member, roots in sorted(member_roots.items())]
    processed: set = set()
    while queue:
        member, roots = queue.pop(0)
        index = mesh_index(zf, project, member)
        for oid in _needed_inner(zf, project, member, roots):
            inner = index.get(oid)
            if inner is None:
                continue
            for path, child, _transform in inner.components:
                if not path:
                    continue
                child_member = path.lstrip("/")
                if child_member == member:
                    continue
                key = (child_member, str(child))
                if key in processed:
                    continue
                processed.add(key)
                member_roots.setdefault(child_member, set()).add(str(child))
                queue.append((child_member, {str(child)}))

    stats = {"triangles": {}, "objects": {}, "painted": 0}
    member_buffers: dict = {}
    written: dict = {}
    source_of_name: dict = {}
    for member in sorted(member_roots):
        keep = _needed_inner(zf, project, member, member_roots[member])
        out_name = _member_output_name(project, member,
                                       inline_ids if member == project.inline_member else set())
        other = source_of_name.get(out_name)
        if other is not None and other != member:
            raise u1.ConvertError(
                f"{member} and {other} would both be written as {out_name}, and a nested "
                "part inside one of them refers to that path; this structure cannot be "
                "exported faithfully")
        source_of_name[out_name] = member
        buf = io.BytesIO()
        _copy_member(zf, member, buf, set(keep), mapping, stats, attrs)
        member_buffers[out_name] = buf.getvalue()
        written[member] = (out_name, keep)

    object_xml = []
    settings_entries = []
    for index, entry in enumerate(graph):
        out_id = index + 1
        meta = project.meta.get(entry["source"])
        name = (meta.name if meta is not None and meta.name
                else project.object_name_for(entry["source"]))
        component_xml = []
        part_xml = []
        used_ids: list = []
        for comp_index, comp in enumerate(entry["components"]):
            member = comp["member"]
            out_name, keep = written[member]
            component_xml.append(
                '    <component p:path="/%s" objectid="%s" p:UUID="%s" transform="%s"/>'
                % (u1.esc(out_name), u1.esc(comp["objectid"]), u1.new_uuid(),
                   u1.transform_3mf_text(comp["matrix"])))
            # Part metadata is matched by its id, which is the component's inner
            # object id in every file this tool has seen; order is not assumed.
            source_part = None
            if meta is not None and entry["parts_meta"]:
                source_part = (entry["parts_meta"][comp_index]
                               if comp_index < len(entry["parts_meta"]) else None)
            if source_part is not None and source_part.extruder:
                source_extruder = source_part.extruder
            elif meta is not None and meta.extruder:
                source_extruder = meta.extruder
            else:
                source_extruder = project.base_extruder
            slot = mapping.get(source_extruder, 1)
            part_id = _unique_part_id(used_ids, str(comp["objectid"]))
            used_ids.append(part_id)
            part_name = (source_part.name if source_part is not None and source_part.name
                         else name)
            entry.setdefault("inline_parts", []).append({
                "member": member, "objectid": str(comp["objectid"]),
                "matrix": comp["matrix"], "name": part_name, "extruder": slot,
            })
            part_xml.append(
                '    <part id="%s" subtype="normal_part">\n'
                '      <metadata key="name" value="%s"/>\n'
                '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n'
                % (part_id, u1.esc(part_name))
                + ('      <metadata key="source_file" value="%s"/>\n'
                   % u1.esc(source_part.source_file)
                   if source_part is not None and source_part.source_file else "")
                + '      <metadata key="extruder" value="%s"/>\n' % slot
                + "    </part>\n")
        object_xml.append(
            '  <object id="%d" p:UUID="%s" type="model">\n   <components>\n%s\n'
            '   </components>\n  </object>\n'
            % (out_id, u1.new_uuid(), "\n".join(component_xml)))
        default_extruder = (meta.extruder if meta is not None and meta.extruder
                            else project.base_extruder)
        settings_entries.append(
            '  <object id="%d">\n'
            '    <metadata key="name" value="%s"/>\n'
            '    <metadata key="extruder" value="%s"/>\n%s  </object>\n'
            % (out_id, u1.esc(name), mapping.get(default_extruder, 1), "".join(part_xml)))

    # PrusaSlicer resolves parts inside the model file, so its export is one
    # inlined model rather than a set of member files it may not follow.
    inlined = None
    if target == "prusa":
        for entry in graph:
            entry["offset"] = offset
            # The inline builder wants each part's own name and slot with it.
            entry["components"] = entry.get("inline_parts") or entry["components"]
        try:
            inlined = u1targets.inline_members(graph, written, member_buffers)
        except u1targets.TargetError as exc:
            raise u1.ConvertError(str(exc)) from exc
        item_xml = inlined["items"]
    else:
        item_xml = "".join(
            '  <item objectid="%d" p:UUID="%s" transform="%s" printable="1"/>\n'
            % (index + 1, u1.new_uuid(), u1.transform_3mf_text(offset))
            for index in range(len(graph)))

    # The name the slicer shows as the authoring application. A Full Spectrum
    # project announces the studio version it was written for, so the target
    # build recognises the document instead of offering the geometry-import
    # dialog; the direct export keeps the name the appliance expects.
    application = (u1spectrum.APPLICATION if recipes and target == "snapmaker"
                   else u1targets.APPLICATION[target])
    model_xml = (
        u1.XML_HEADER
        + '<model unit="millimeter" xml:lang="en-US" '
        + u1targets.model_namespaces(target)
        + ('requiredextensions="p">\n' if target != "prusa" else ">\n")
          + ' <metadata name="Application">%s</metadata>\n' % u1.esc(application)
          + ' <metadata name="Title">%s</metadata>\n'
            % u1.esc(title or project.title or "U1 project")
          + ("" if target == "prusa"
             else ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n')
        + " <resources>\n"
        + (inlined["resources"] if inlined is not None else "".join(object_xml))
        + " </resources>\n"
        + (' <build p:UUID="%s">\n' % u1.new_uuid() if target != "prusa"
           else " <build>\n")
        + item_xml + " </build>\n</model>\n")

    rels = [u1.XML_HEADER,
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n']
    member_out = [] if inlined is not None else sorted(member_buffers)
    for i, out_name in enumerate(member_out, start=1):
        rels.append(' <Relationship Target="/%s" Id="rel-%d" '
                    'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
                    % (u1.esc(out_name), i))
    rels.append("</Relationships>\n")

    extra = u1targets.extra_members(
        target, physical_colors, physical_types, recipes,
        inlined["objects"] if inlined is not None else [])
    if target == "snapmaker":
        overrides = u1.different_settings(cfg, profiles, machine, process, len(colors))
        cfg["different_settings_to_system"] = overrides
    else:
        overrides = []
    if target != "snapmaker":
        problems = u1targets.validate(target, cfg, MAX_SLOTS, recipes, extra)
        if problems:
            raise u1.ConvertError(f"the {target} project is not self-consistent: "
                                  + "; ".join(problems[:3]))

    directory = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(directory, exist_ok=True)
    tmp_path = out_path + ".partial"
    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zout:
            zout.writestr("[Content_Types].xml", u1.content_types_xml())
            zout.writestr("_rels/.rels", u1.root_rels_xml())
            zout.writestr(u1.MODEL_RELS, "".join(rels))
            if target != "prusa":
                # Orca and Bambu projects carry the plate/slice metadata and the
                # part structure; a PrusaSlicer project must not.
                zout.writestr("Metadata/slice_info.config", u1.slice_info_xml())
                zout.writestr(u1.SRC_BBL_MODEL,
                              u1.XML_HEADER + "<config>\n"
                              + "".join(settings_entries) + "</config>\n")
                zout.writestr(u1.SRC_BBL_PROJECT,
                              json.dumps(cfg, indent=4, ensure_ascii=False))
            preview = project.previews.get(selection.plate_id)
            if preview and is_whole_plate(project, selection):
                zout.writestr("Metadata/thumbnail.png", preview[1])
                zout.writestr("Metadata/plate_1.png", preview[1])
            for out_name in member_out:
                zout.writestr(out_name, member_buffers[out_name])
            for extra_name, extra_text in extra.items():
                zout.writestr(extra_name, extra_text)
            zout.writestr(u1.MODEL_FILE, model_xml)
        # Nothing is published until the archive has been read back and checked
        # against the source it came from: a failed invariant must not leave a
        # plausible-looking file where the export was meant to be.
        report = verify_export(tmp_path, zf, project, selection, plan, offset=offset,
                               member_pairs={member: out_name
                                             for member, (out_name, _keep) in written.items()},
                               max_state=MAX_SLOTS + len(recipes), target=target)
        if report["problems"]:
            raise u1.ConvertError(
                "the export did not match the source it was built from, so it was not "
                "written: " + "; ".join(report["problems"][:3]))
        os.replace(tmp_path, out_path)
    except BaseException:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise

    return {
        "output": out_path,
        "mode": plan.mode,
        "colors": colors,
        "types": types,
        "mapping": {str(k): v for k, v in sorted(remapped.items())},
        "objects": [entry["source"] for entry in graph],
        "instances": len(graph),
        "members": sorted(member_buffers),
        "offset": [round(offset[3][i], 4) for i in range(3)],
        "carried": carried,
        "supports": cfg.get("enable_support"),
        "support_note": support_note,
        "overrides": len([k for k in (overrides[0] if overrides else "").split(";") if k]),
        "mesh_stats": stats,
        "checks": report,
        "spectrum": ({"recipes": recipes,
                      "predicted": u1spectrum.palette(physical_colors, recipes)}
                     if recipes else None),
        "size": None if measurement["size"] is None else
                [round(v, 2) for v in measurement["size"]],
    }


# --------------------------------------------------------------------------------------
# verification
# --------------------------------------------------------------------------------------

def _paint_totals(zf, project: Project, selection: Selection):
    """(triangles, painted triangles per state) for every *instance* selected."""
    triangles = 0
    paint: dict = {}
    for object_id, item_transform in selection_instances(project, selection):
        for member, oid, _matrix_, _index in instance_chain(zf, project, object_id, item_transform):
            inner = inner_object(zf, project, member, oid)
            if inner is None:
                continue
            triangles += inner.triangles
            for state, count in inner.leaf_states.items():
                paint[state] = paint.get(state, 0) + count
    return triangles, paint


FACET_ATTRS = (
    ("paint", re.compile(r'(?:slic3rpe:)?(?:mmu_segmentation|paint_color)="([0-9A-Fa-f]*)"')),
    ("supports", re.compile(r'(?:slic3rpe:)?(?:custom_supports|paint_supports)="([0-9A-Fa-f]*)"')),
    ("seam", re.compile(r'(?:slic3rpe:)?(?:custom_seam|paint_seam)="([0-9A-Fa-f]*)"')),
)


def _facet_rows(handle):
    """Yield (inner object id, facet index, geometry text, {attribute: value})."""
    object_re = re.compile(r"<object\b([^>]*)>")
    triangle_re = re.compile(r"<triangle\b([^>]*?)/?>")
    current = None
    index = 0
    for line in io.TextIOWrapper(handle, encoding="utf-8", errors="replace"):
        stripped = line.lstrip()
        if stripped.startswith("<object"):
            match = object_re.search(stripped)
            oid = re.search(r'id="([^"]*)"', match.group(1)) if match else None
            current = oid.group(1) if oid else None
            index = 0
            continue
        if stripped.startswith("<triangle") and not stripped.startswith("<triangles"):
            match = triangle_re.search(stripped)
            if match is None:
                continue
            attrs = match.group(1)
            values = {}
            for key, pattern in FACET_ATTRS:
                found = pattern.search(attrs)
                values[key] = found.group(1) if found else None
            geometry = re.sub(
                r'(?:slic3rpe:)?(?:mmu_segmentation|paint_color|custom_supports|'
                r'paint_supports|custom_seam|paint_seam|fuzzy_skin|paint_fuzzy_skin)="[^"]*"',
                "", attrs)
            yield current, index, geometry.strip(), values
            index += 1


def object_ids_of(handle) -> set:
    """The inner object ids declared by a mesh member."""
    pattern = re.compile(r"<object\b([^>]*)>")
    found: set = set()
    for line in io.TextIOWrapper(handle, encoding="utf-8", errors="replace"):
        stripped = line.lstrip()
        if not stripped.startswith("<object"):
            continue
        match = pattern.search(stripped)
        if match is None:
            continue
        oid = re.search(r'id="([^"]*)"', match.group(1))
        if oid:
            found.add(oid.group(1))
    return found


def _compare_facets(source_handle, output_handle, mapping: dict, keep=None,
                    limit: int = 6) -> list:
    """Compare two mesh members facet by facet, semantics and all.

    Geometry attributes must be identical, each painted facet's topology must
    survive with its materials mapped, and support/seam painting must be carried
    over unchanged.  This is a per-triangle check, not a total, so a single
    corrupted value cannot hide behind a matching sum.
    """
    problems: list = []
    source = _facet_rows(source_handle)
    output = _facet_rows(output_handle)
    while True:
        try:
            s_object, s_index, s_geometry, s_values = next(source)
            while keep is not None and s_object not in keep:
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
            problems.append("the output has a different number of facets")
            break
        if s_object != o_object or s_index != o_index:
            problems.append(f"facet order changed: {s_object}#{s_index} -> "
                            f"{o_object}#{o_index}")
            break
        if s_geometry != o_geometry:
            problems.append(f"object {s_object} facet {s_index} changed geometry")
        if s_values["paint"] and o_values["paint"]:
            try:
                source_node = u1paint.decode(s_values["paint"])
                output_node = u1paint.decode(o_values["paint"])
            except u1paint.PaintError as exc:
                # A value this tool cannot read must be copied through untouched,
                # which is the only thing that can be promised about it.
                if s_values["paint"] != o_values["paint"]:
                    problems.append(f"object {s_object} facet {s_index} carries a paint value "
                                    f"that cannot be read ({exc}) and it was changed")
            else:
                if u1paint.topology(source_node) != u1paint.topology(output_node):
                    problems.append(f"object {s_object} facet {s_index} paint topology changed")
                expected = [0 if s == 0 else mapping.get(s, s)
                            for s in u1paint.walk_states(source_node)]
                if expected != u1paint.walk_states(output_node):
                    problems.append(f"object {s_object} facet {s_index} materials changed: "
                                    f"{expected} -> {u1paint.walk_states(output_node)}")
        elif bool(s_values["paint"]) != bool(o_values["paint"]):
            problems.append(f"object {s_object} facet {s_index} lost or gained paint")
        for key in ("supports", "seam"):
            if s_values[key] != o_values[key]:
                problems.append(f"object {s_object} facet {s_index} {key} painting changed")
        if len(problems) >= limit:
            break
    return problems


def _instance_rows(zf, project: Project, selection: Selection, offset=None) -> list:
    """[(inner object id, world matrix)] per instance, in export order."""
    rows: list = []
    for object_id, item_transform in selection_instances(project, selection):
        for member, inner_id, matrix, _index in instance_chain(zf, project, object_id, item_transform):
            world = u1.matmul(matrix, offset) if offset is not None else matrix
            rows.append((str(inner_id), world))
    return rows


def _matrix_close(a, b, tolerance: float = 1e-3) -> bool:
    return all(abs(a[i][j] - b[i][j]) <= tolerance for i in range(4) for j in range(4))


def members_of(zf: zipfile.ZipFile) -> list:
    """The mesh members a main model's components point at."""
    doc = zf.read(u1.MODEL_FILE).decode("utf-8", "replace")
    return sorted({_attr(_tag_attrs(line), "p:path").lstrip("/")
                   for line in doc.splitlines()
                   if line.lstrip().startswith("<component")
                   and _attr(_tag_attrs(line), "p:path")})


def verify_export(path: str, zf_source: zipfile.ZipFile, project: Project,
                  selection: Selection, plan: Plan, offset=None,
                  member_pairs: dict | None = None,
                  max_state: int = MAX_SLOTS, target: str = "snapmaker") -> dict:
    """Re-read a written project and check the invariants that matter.

    This reads the archive the tool actually produced, not the helpers that made
    it: the object graph resolves, every facet matches the source it came from
    (geometry, paint topology, mapped materials, support and seam painting), the
    placements are the source's plus the plate offset, and no paint state points
    outside the filament ids the plan was allowed to write (the four reels, plus
    any virtual Full Spectrum ids the export declared).
    """
    problems: list = []
    with zipfile.ZipFile(path) as zout:
        names = set(zout.namelist())
        if u1.MODEL_FILE not in names:
            problems.append("the output has no 3D/3dmodel.model")
            return {"problems": problems, "ok": False}
        objects, _order, items = _scan_main_model(zout, u1.MODEL_FILE)
        out_members = members_of(zout)
        rels = ""
        if u1.MODEL_RELS in names:
            rels = zout.read(u1.MODEL_RELS).decode("utf-8", "replace")
        for member in out_members:
            if member not in names:
                problems.append(f"the model references {member}, which is not in the archive")
                continue
            if member not in rels:
                problems.append(f"{member} is referenced but has no relationship entry")

        expected_triangles, expected_paint_raw = _paint_totals(zf_source, project, selection)
        expected_paint: dict = {}
        for state, count in expected_paint_raw.items():
            slot = 0 if state == 0 else dict(plan.mapping).get(state, state)
            expected_paint[slot] = expected_paint.get(slot, 0) + count

        if target == "prusa":
            # A PrusaSlicer project keeps every mesh in the model file, so the
            # checks are about the file itself rather than about member pairs.
            found_triangles = 0
            found_paint: dict = {}
            index = _scan_member_objects(zout, u1.MODEL_FILE)
            for oid in index.order:
                inner = index.get(oid)
                if inner is None or not inner.triangles:
                    continue
                found_triangles += inner.triangles
                for state, count in inner.leaf_states.items():
                    found_paint[state] = found_paint.get(state, 0) + count
            text = zout.read(u1.MODEL_FILE).decode("utf-8", "replace")
            if "paint_color=" in text:
                problems.append("the paint attribute is still the Orca spelling")
            if "requiredextensions" in text:
                problems.append("the model requires an extension PrusaSlicer may not "
                                "declare")
            if re.search(r'\sp:(?:path|UUID)="', text):
                problems.append("the model still uses production-extension attributes")
            if any(name.startswith(u1.OBJECTS_DIR) for name in names):
                problems.append("external mesh members were written for PrusaSlicer")
            if found_triangles != expected_triangles:
                problems.append(f"the model holds {found_triangles} triangles, the "
                                f"source selection has {expected_triangles}")
            if found_paint != expected_paint:
                problems.append(f"paint states are {sorted(found_paint.items())}, "
                                f"expected {sorted(expected_paint.items())}")
            return {
                "ok": not problems, "objects": len(objects), "instances": len(items),
                "members": [], "triangles": found_triangles,
                "expected_triangles": expected_triangles, "paint": found_paint,
                "expected_paint": expected_paint, "problems": problems,
            }
        exported_instances = len(selection_instances(project, selection))
        if len(items) != exported_instances:
            problems.append(f"the output has {len(items)} build items, expected "
                            f"{exported_instances}")
        if len(objects) != exported_instances:
            problems.append(f"the output declares {len(objects)} objects, expected "
                            f"{exported_instances}")

        # Walk the output the same way the source is walked: through its own
        # object graph, one instance at a time.
        out_project = read_project(zout)
        out_selection = select(out_project)
        found_triangles, found_paint = _paint_totals(zout, out_project, out_selection)

        # facet by facet, against the source member each one came from
        pairs = dict(member_pairs or {})
        if not pairs:
            source_members = [n for n in zf_source.namelist()
                              if n.startswith(u1.OBJECTS_DIR) and n.endswith(".model")]
            for out_member in out_members:
                base = os.path.basename(out_member)
                match = next((s for s in source_members
                              if os.path.basename(s) == base), None)
                pairs[match or project.inline_member] = out_member
        for source_member, out_member in sorted(pairs.items()):
            if source_member not in set(zf_source.namelist()):
                problems.append(f"the source member {source_member} is missing")
                continue
            if out_member not in names:
                problems.append(f"the output member {out_member} is missing")
                continue
            with zout.open(out_member) as oh:
                keep = object_ids_of(oh)
            with zf_source.open(source_member) as sh, zout.open(out_member) as oh:
                problems.extend(_compare_facets(sh, oh, dict(plan.mapping), keep=keep))

        # the placement of every part, source plus the plate offset
        if offset is None:
            offset = plate_offset(measure(zf_source, project, selection),
                                  u1.build_project_config(u1.load_base_template(), None,
                                                          plan.colors(), plan.types(),
                                                          u1.DEFAULT_FILAMENT,
                                                          u1.DEFAULT_MACHINE,
                                                          u1.DEFAULT_PROCESS))
        expected_rows = _instance_rows(zf_source, project, selection, offset)
        found_rows = _instance_rows(zout, out_project, out_selection)
        if len(expected_rows) != len(found_rows):
            problems.append(f"the output places {len(found_rows)} parts, expected "
                            f"{len(expected_rows)}")
        else:
            for (inner_id, expected), (found_id, found) in zip(expected_rows, found_rows):
                if inner_id != found_id:
                    problems.append(f"part {inner_id} was written as {found_id}")
                elif not _matrix_close(expected, found):
                    problems.append(f"the placement of part {inner_id} does not match the "
                                    "source plus the plate offset")
        states_out_of_range: list = []
        leftover_attrs: list = []
        for member in out_members:
            if member not in names:
                continue
            with zout.open(member) as raw:
                for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace"):
                    if "mmu_segmentation" in line:
                        leftover_attrs.append(member)
                        break
                    if "slic3rpe:custom_supports" in line or "slic3rpe:custom_seam" in line:
                        leftover_attrs.append(member)
                        break
        for state in found_paint:
            if state < 0 or state > max_state:
                states_out_of_range.append(state)

        if found_triangles != expected_triangles:
            problems.append(f"the output holds {found_triangles} triangles, the source "
                            f"selection has {expected_triangles}")
        if found_paint != expected_paint:
            problems.append(f"paint states after remapping are {sorted(found_paint.items())}, "
                            f"expected {sorted(expected_paint.items())}")
        if states_out_of_range:
            problems.append(f"{len(states_out_of_range)} paint states are outside the "
                            f"{max_state} filament ids this export declared, e.g. "
                            f"{states_out_of_range[:3]}")
        if leftover_attrs:
            problems.append(f"{len(set(leftover_attrs))} mesh file(s) still carry Prusa "
                            f"attribute names, e.g. {sorted(set(leftover_attrs))[:2]}")

    return {
        "ok": not problems,
        "objects": len(objects),
        "instances": len(items),
        "members": out_members,
        "triangles": found_triangles,
        "expected_triangles": expected_triangles,
        "paint": found_paint,
        "expected_paint": expected_paint,
        "problems": problems,
    }
