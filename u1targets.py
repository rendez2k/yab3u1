#!/usr/bin/env python3
"""The three project targets this tool can write: Snapmaker, Bambu, PrusaSlicer.

The U1 tool has four physical slots.  Every target gets those four reels in the
same order; the recipes you reviewed become *virtual* filaments after them, and
each target describes them in its own native way:

* **Snapmaker Orca** -- `mixed_filament_definitions` rows, physical arrays left at
  four (see :mod:`u1spectrum`).  This is the one the user has opened successfully.
* **Bambu Studio** -- the palette arrays grow to physical + virtual and carry
  `filament_is_mixed` / `filament_mixed_components` /
  `filament_mixed_sublayer_ratios` / `filament_multi_colour`, which is Bambu's own
  mixed-filament schema.
* **PrusaSlicer** -- `Metadata/Prusa_Slicer_full_spectrum.json` with the four
  physical extruders and the virtual recipes, paint in `slic3rpe:mmu_segmentation`
  and the model/part structure in `Metadata/Slic3r_PE_model.config`.

**Foreign targets are portable colour projects.**  A Bambu or Prusa file must not
carry the U1's printer, process, start or end G-code: the user opens it with their
own profile.  So for those targets the machine half of the base profile is
dropped and only the geometry, the part structure, the palette and the recipes
are written.  Nothing here claims a particular active profile will accept the
file; the model metadata names the application it was written for, and the
instructions say to open it as a project.

Runtime validation in Bambu Studio 2.7 or PrusaSlicer 2.9.6 has **not** been
performed: installing or launching those slicers is out of scope.  The schemas
below follow the published format notes; the checks that can be made offline are
made in :func:`validate`.
"""

from __future__ import annotations

import json
import re

import u1colour
import u1spectrum

TARGETS = ("snapmaker", "bambu", "prusa")

LABELS = {
    "snapmaker": "Snapmaker Orca (U1 · native Full Spectrum)",
    "bambu": "Bambu Studio (colour + native mixed filaments)",
    "prusa": "PrusaSlicer (colour + native Full Spectrum)",
}

# The application the written project announces.  Snapmaker's is the value the
# installed 2.4.0 build accepts for a Full Spectrum document; Prusa's is the
# version in the phase brief; Bambu's is the build string its own projects carry.
APPLICATION = {
    "snapmaker": "Snapmaker Orca",
    # The build the documented mixed-filament schema ships in; do not bump it to a
    # newer version than the format notes describe.
    "bambu": "BambuStudio-02.07.01.62",
    "prusa": "PrusaSlicer-2.9.6",
}

# Paint and support attributes differ per family: Orca/Bambu read `paint_color`,
# PrusaSlicer reads `slic3rpe:mmu_segmentation`.
PAINT_ATTR = {
    "snapmaker": "paint_color",
    "bambu": "paint_color",
    "prusa": "slic3rpe:mmu_segmentation",
}
SUPPORT_ATTR = {
    "snapmaker": "paint_supports",
    "bambu": "paint_supports",
    "prusa": "slic3rpe:custom_supports",
}
SEAM_ATTR = {
    "snapmaker": "paint_seam",
    "bambu": "paint_seam",
    "prusa": "slic3rpe:custom_seam",
}

PRUSA_MODEL_CONFIG = "Metadata/Slic3r_PE_model.config"
PRUSA_SPECTRUM_JSON = "Metadata/Prusa_Slicer_full_spectrum.json"

OBJECT_RE = None      # compiled lazily so the module stays import-light
COMPONENT_RE = None


def _regexes():
    global OBJECT_RE, COMPONENT_RE
    if OBJECT_RE is None:
        import re
        OBJECT_RE = re.compile(r"<object\b[^>]*>.*?</object>", re.S)
        COMPONENT_RE = re.compile(r"<component\b[^>]*/>")
    return OBJECT_RE, COMPONENT_RE


def inline_members(graph: list, written: dict, member_buffers: dict,
                   parts_meta_of=None) -> dict:
    """Flatten every mesh into one model file, the way PrusaSlicer stores them.

    PrusaSlicer resolves parts inside the model file itself.  Rather than hand it
    external member files it may not follow, the objects are copied into the main
    model with fresh ids: ``<component objectid=...>`` only, no ``p:path``.

    Returns ``{"resources": xml, "items": xml, "objects": [...]}`` where
    ``objects`` is the structure :func:`prusa_model_config` writes out.
    """
    obj_re, comp_re = _regexes()
    if any(len(entry.get("components") or []) > 1 for entry in graph):
        raise TargetError(
            "PrusaSlicer describes volumes by triangle range, and this tool only "
            "knows that range for a one-volume object; export this selection to "
            "Snapmaker Orca or Bambu Studio instead, or save it from your slicer as "
            "a single-volume file first")
    new_id = [0]

    def next_id() -> int:
        new_id[0] += 1
        return new_id[0]

    blocks: dict = {}          # (member, source oid) -> xml block
    id_of: dict = {}           # (member, source oid) -> new id
    for member, (out_name, keep) in written.items():
        text = member_buffers.get(out_name, b"").decode("utf-8", "replace")
        for block in obj_re.findall(text):
            head = block[:block.find(">") + 1]
            import re as _re
            m = _re.search(r'\bid="([^"]+)"', head)
            if m is None:
                continue
            source_id = m.group(1)
            if source_id not in keep:
                continue
            id_of[(member, source_id)] = next_id()
            blocks[(member, source_id)] = block

    resources: list = []          # roots only: the part meshes are inlined into them
    objects: list = []            # metadata for exactly those roots, no ghosts
    for (member, source_id), block in blocks.items():
        head = block[:block.find(">") + 1]
        body_start = block.find(">") + 1

        def rewrite(match):
            tag = match.group(0)
            inner = _attr(tag, "objectid")
            target_member = _attr(tag, "p:path")
            target_member = (target_member.lstrip("/") if target_member else member)
            mapped = id_of.get((target_member, inner))
            transform = _attr(tag, "transform")
            if mapped is None:
                raise TargetError(
                    f"object {source_id} in {member} refers to {target_member} "
                    f"object {inner}, which is not part of this export")
            return ('<component objectid="%d"%s/>'
                    % (mapped, ' transform="%s"' % transform if transform else ""))

        body = comp_re.sub(rewrite, block[body_start:])
        head = head.replace('id="%s"' % source_id, 'id="%d"' % id_of[(member, source_id)], 1)
        import re as _re
        head = _re.sub(r'\s+p:UUID="[^"]*"', "", head)
        block = head + body
        # No metadata entry here: these inner objects are inlined into the roots
        # below, so listing them would describe resources the model never writes.

    root_ids = []
    for entry in graph:
        root = next_id()
        # A list, not a dict keyed by source: the same object placed twice is two
        # build items, and a dict would collapse them into one.
        root_ids.append(root)
        parts = []
        mesh = None
        triangles = 0
        for comp in entry["components"]:
            key = (comp["member"], str(comp["objectid"]))
            if key not in blocks:
                raise TargetError(
                    f"object {entry['source']} uses a part that is not in this export")
            body = blocks[key]
            found = re.search(r"<mesh\b[\s\S]*?</mesh>", body)
            if found is None:
                raise TargetError(
                    f"{comp['member']} object {comp['objectid']} has no mesh to write")
            mesh = found.group(0)
            # `<triangle\b`, not `"<triangle"`: the latter also counts the
            # `<triangles>` container, which put lastid one past the end.
            triangles = len(re.findall(r"<triangle\b", mesh))
            parts.append({"id": str(root),
                          "name": comp.get("name") or "",
                          "extruder": comp.get("extruder", 1),
                          "firstid": 0,
                          "lastid": max(0, triangles - 1)})
        resources.append('  <object id="%d" type="model">\n%s\n  </object>\n'
                         % (root, mesh))
        objects.append({"objectid": str(root), "name": entry.get("name") or "",
                        "parts": parts})

    def placement(entry) -> str:
        matrix = (entry["components"][0]["matrix"] if entry.get("components")
                  else IDENTITY)
        offset = entry.get("offset")
        # The other targets place a part by its own transform *and* the plate
        # offset; the inlined item carries both, or the object prints uncentred.
        if offset is not None:
            matrix = _matmul(matrix, offset)
        return _matrix_text(matrix)

    items = "".join(
        '  <item objectid="%d" transform="%s" printable="1"/>\n'
        % (root, placement(entry))
        for entry, root in zip(graph, root_ids))
    return {"resources": "".join(resources), "items": items, "objects": objects}


IDENTITY = ((1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0))


def _matmul(a, b) -> list:
    """A then B, in this codebase's row-major 4x4 convention (see u1convert.apply)."""
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)]
            for i in range(4)]


def _matrix_text(matrix) -> str:
    """A 4x4 (row-major, translation in row 3) as the 4x3 form 3MF expects."""
    values = (matrix[0][0], matrix[0][1], matrix[0][2],
              matrix[1][0], matrix[1][1], matrix[1][2],
              matrix[2][0], matrix[2][1], matrix[2][2],
              matrix[3][0], matrix[3][1], matrix[3][2])
    return " ".join("%.9g" % v for v in values)


def _attr(text: str, name: str):
    import re
    m = re.search(r'\b%s="([^"]*)"' % re.escape(name), text)
    return m.group(1) if m else None

# Keys that make a project machine-specific.  None of them may survive into a
# foreign target: they are the U1's printer, process and G-code.
MACHINE_KEYS = (
    "printer_settings_id", "printer_model", "printer_variant", "print_settings_id",
    "print_compatible_printers", "printer_structure", "printer_technology",
    "printable_area", "printable_height", "nozzle_type", "nozzle_volume",
    "machine_start_gcode", "machine_end_gcode", "layer_change_gcode",
    "time_lapse_gcode", "pause_gcode", "change_filament_gcode",
    "before_layer_change_gcode", "printing_by_object_gcode",
    "filament_start_gcode", "filament_end_gcode",
)


class TargetError(ValueError):
    """The requested target or recipe set cannot be written."""


def normalise(target: str | None) -> str:
    name = (target or "snapmaker").strip().lower()
    aliases = {"snapmaker orca": "snapmaker", "orca": "snapmaker", "u1": "snapmaker",
               "bambu studio": "bambu", "bambu studio 2.7": "bambu",
               "prusaslicer": "prusa", "prusa slicer": "prusa", "prusa": "prusa"}
    name = aliases.get(name, name)
    if name not in TARGETS:
        raise TargetError(
            f"unknown target {target!r}; choose one of {', '.join(TARGETS)}")
    return name


def attrs_for(target: str) -> dict:
    """How one target spells the paint, support and seam attributes."""
    target = normalise(target)
    return {
        "paint": PAINT_ATTR[target],
        "rewrites": (
            ("slic3rpe:custom_supports", SUPPORT_ATTR[target]),
            ("paint_supports", SUPPORT_ATTR[target]),
            ("slic3rpe:custom_seam", SEAM_ATTR[target]),
            ("paint_seam", SEAM_ATTR[target]),
            ("slic3rpe:fuzzy_skin", "slic3rpe:fuzzy_skin"
             if target == "prusa" else "paint_fuzzy_skin"),
            ("paint_fuzzy_skin", "slic3rpe:fuzzy_skin"
             if target == "prusa" else "paint_fuzzy_skin"),
        ),
    }


def model_namespaces(target: str) -> str:
    """The xmlns declarations a target's model files need."""
    core = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
    if normalise(target) == "prusa":
        # No BambuStudio or production extension: a PrusaSlicer project carries the
        # mesh in the object and names nothing it does not use.
        return core + 'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" '
    return (core
            + 'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
            + 'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ')


def member_header(attrs: dict, require_p: bool = True) -> str:
    """The header for one mesh-bearing member file, in the target's spelling."""
    target = "prusa" if str(attrs.get("paint", "")).startswith("slic3rpe:") else "bambu"
    namespaces = ('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
                  'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
                  'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ')
    if target == "prusa":
        namespaces += 'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" '
    required = 'requiredextensions="p"' if require_p and target != "prusa" else ""
    metadata = ("" if target == "prusa"
                else ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<model unit="millimeter" xml:lang="en-US" %s%s>\n%s'
            " <resources>\n" % (namespaces, required, metadata))


def physical_limit(target: str) -> int:
    """How many physical slots the target machine has (the U1: four)."""
    return u1spectrum.MAX_VISIBLE - u1spectrum.MAX_RECIPES


def palette(physical_colors: list, physical_types: list, recipes: list) -> dict:
    """The four reels plus the predicted colour of every reviewed recipe."""
    physical = [u1colour.norm(c) or "#FFFFFF" for c in physical_colors]
    virtual = []
    for index, recipe in enumerate(recipes):
        virtual.append({
            "id": u1spectrum.virtual_id(len(physical), index),
            "color": u1spectrum.palette(physical, [recipe])[0],
            "a": recipe["a"],
            "b": recipe["b"],
            "percent": recipe["percent"],
            "type": (physical_types[recipe["a"] - 1] if
                     recipe["a"] - 1 < len(physical_types) else "PLA"),
        })
    return {"physical": physical, "virtual": virtual}


def config(target: str, physical_colors: list, physical_types: list, recipes: list,
           filament_profile: str | None = None,
           base: dict | None = None) -> dict:
    """The project settings a target needs, built from scratch for foreign targets."""
    target = normalise(target)
    u1spectrum.check(len(physical_colors), recipes)
    u1spectrum.check_types(physical_types, recipes)
    table = palette(physical_colors, physical_types, recipes)
    colours = table["physical"] + [v["color"] for v in table["virtual"]]
    types = [t or "PLA" for t in physical_types] + [v["type"] for v in table["virtual"]]
    total = len(colours)

    if target == "snapmaker":
        # The verified path: the U1 profile with the mixture rows added.
        cfg = dict(base or {})
        return u1spectrum.apply(cfg, table["physical"], physical_types, recipes,
                                filament_profile)

    cfg: dict = {
        "from": "project",
        "version": "2.7.0.62",
        "filament_colour": [c + "FF" for c in colours],
        "extruder_colour": list(colours),
        "default_filament_colour": list(colours),
        "filament_type": types,
        # The U1's filament profile name does not exist in another slicer, so a
        # portable project names the generic profile for each material it carries:
        # a PETG or ABS project must not be relabelled as PLA.
        "filament_settings_id": [f"Generic {t}" for t in types],
        "filament_ids": [""] * total,
    }
    if recipes:
        cfg.update({
            "filament_is_mixed": ["0"] * len(table["physical"]) + ["1"] * len(recipes),
            "filament_mixed_components": [""] * len(table["physical"]) + [
                f"{r['a']},{r['b']}" for r in recipes],
            "filament_mixed_sublayer_ratios": [""] * len(table["physical"]) + [
                f"{round(1 - r['percent'] / 100.0, 3)},{round(r['percent'] / 100.0, 3)}"
                for r in recipes],
            "filament_multi_colour": list(colours),
            "filament_mixed_gradient": ["0"] * total,
            "filament_mixed_gradient_per_part": ["0"] * total,
            "filament_mixed_gradient_range": [""] * total,
            "filament_mixed_gradient_curve": [""] * total,
        })
    return cfg


def extra_members(target: str, physical_colors: list, physical_types: list,
                  recipes: list, graph: list) -> dict:
    """Archive members that only one target needs, as {name: text}."""
    target = normalise(target)
    out: dict = {}
    if target != "prusa":
        return out
    table = palette(physical_colors, physical_types, recipes)
    out[PRUSA_SPECTRUM_JSON] = json.dumps({
        "version": 1,
        "physical_extruders": [
            {"id": index + 1, "color": colour, "kind": "physical",
             "type": physical_types[index] if index < len(physical_types) else "PLA"}
            for index, colour in enumerate(table["physical"])
        ],
        "virtual_extruders": [
            {
                "id": v["id"], "color": v["color"], "kind": "fullspectrum",
                "components": [
                    {"extruder": v["a"], "ratio": round(1 - v["percent"] / 100.0, 3)},
                    {"extruder": v["b"], "ratio": round(v["percent"] / 100.0, 3)},
                ],
            }
            for v in table["virtual"]
        ],
    }, indent=2)
    out[PRUSA_MODEL_CONFIG] = prusa_model_config(graph)
    return out


def prusa_model_config(graph: list) -> str:
    """`Metadata/Slic3r_PE_model.config`: the object/part structure PrusaSlicer reads.

    ``graph`` is the exporter's own object list: each entry has ``objectid``,
    ``name`` and ``parts`` (id, name, extruder).
    """
    lines = [XML_HEADER]
    lines.append("<config>\n")
    for entry in graph:
        lines.append(' <object id="%s">\n' % entry["objectid"])
        lines.append('  <metadata key="name" value="%s"/>\n'
                     % _xml(entry.get("name") or "object"))
        for part in entry.get("parts", []):
            lines.append('  <volume firstid="%s" lastid="%s">\n'
                         % (part.get("firstid", 0), part.get("lastid", 0)))
            lines.append('   <metadata key="name" value="%s"/>\n'
                         % _xml(part.get("name") or "part"))
            lines.append('   <metadata key="volume_type" value="ModelPart"/>\n')
            lines.append('   <metadata key="extruder" value="%s"/>\n'
                         % part.get("extruder", 1))
            lines.append("  </volume>\n")
        lines.append(" </object>\n")
    lines.append("</config>\n")
    return "".join(lines)


XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'


def _xml(text: str) -> str:
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def strip_machine_keys(cfg: dict) -> list:
    """Remove every machine-specific key; return what was removed."""
    removed = [key for key in MACHINE_KEYS if key in cfg]
    for key in removed:
        cfg.pop(key, None)
    cfg["from"] = "project"
    return removed


def validate(target: str, cfg: dict, physical: int, recipes: list,
             members: dict | None = None) -> list:
    """Offline checks for one target's written settings."""
    problems: list = []
    try:
        target = normalise(target)
    except TargetError as exc:
        return [str(exc)]
    total = physical + len(recipes)
    try:
        u1spectrum.check(physical, recipes)
    except u1spectrum.SpectrumError as exc:
        return [str(exc)]

    if target == "snapmaker":
        problems.extend(u1spectrum.validate(cfg, physical, recipes))
        return problems

    # Foreign targets: a portable colour project with the palette in the target's
    # own shape, and no trace of the U1 machine.
    leaked = [key for key in MACHINE_KEYS if key in cfg]
    if leaked:
        problems.append("machine settings leaked into a portable project: "
                        + ", ".join(sorted(leaked)[:4]))
    for key in ("filament_colour", "filament_type"):
        value = cfg.get(key)
        if not isinstance(value, list) or len(value) != total:
            problems.append(f"{key} has "
                            f"{len(value) if isinstance(value, list) else 0} entries, "
                            f"expected {total}")
    for key in ("filament_colour", "filament_type"):
        for index, item in enumerate(cfg.get(key) or []):
            if not str(item).strip():
                problems.append(f"{key}[{index}] is empty")
    # A portable colour project names colours, not hardware: Bambu Studio's own
    # GUI check rejects a nozzle list longer than one when no extruder type is
    # given, so a nozzle diameter inferred from the palette is a defect.
    if "nozzle_diameter" in cfg:
        problems.append("nozzle_diameter is a printer setting and must not be "
                        "inferred from the colour palette")
    if recipes:
        mixed = cfg.get("filament_is_mixed")
        if not isinstance(mixed, list) or len(mixed) != total:
            problems.append("filament_is_mixed does not cover the palette")
        elif mixed[:physical] != ["0"] * physical or \
                mixed[physical:] != ["1"] * len(recipes):
            problems.append("the physical reels and the recipes are not marked "
                            "consistently in filament_is_mixed")
        if not cfg.get("filament_multi_colour"):
            problems.append("filament_multi_colour is missing")
    else:
        for key in ("filament_is_mixed", "filament_multi_colour"):
            if key in cfg:
                problems.append(f"{key} was written with no recipes to describe")
    for key in ("machine_start_gcode", "machine_end_gcode", "filament_start_gcode",
                "filament_end_gcode"):
        value = cfg.get(key)
        if isinstance(value, list) and any(str(v).strip() for v in value):
            problems.append(f"{key} carries G-code into a foreign target")
        elif isinstance(value, str) and value.strip():
            problems.append(f"{key} carries G-code into a foreign target")
    if target == "prusa":
        members = members or {}
        if PRUSA_SPECTRUM_JSON not in members:
            problems.append("the Prusa Full Spectrum description is missing")
        else:
            try:
                data = json.loads(members[PRUSA_SPECTRUM_JSON])
            except ValueError as exc:
                problems.append(f"the Prusa Full Spectrum description is not JSON ({exc})")
                data = None
            if isinstance(data, dict):
                physical_entries = data.get("physical_extruders") or []
                if len(physical_entries) != physical:
                    problems.append("physical_extruders does not list every reel")
                for entry in physical_entries:
                    if "color" not in entry:
                        problems.append("a physical extruder has no 'color' field")
                    if "colour" in entry:
                        problems.append("a physical extruder still uses 'colour'")
                ids = [v.get("id") for v in data.get("virtual_extruders") or []]
                expect = [u1spectrum.virtual_id(physical, i) for i in range(len(recipes))]
                if ids != expect:
                    problems.append(f"virtual_extruders ids are {ids}, expected {expect}")
                for entry in data.get("virtual_extruders") or []:
                    if entry.get("kind") != "fullspectrum":
                        problems.append("a virtual extruder is not marked "
                                        "kind=fullspectrum")
                    if "color" not in entry:
                        problems.append("a virtual extruder has no 'color' field")
                    ratios = [c.get("ratio") for c in entry.get("components") or []]
                    if len(ratios) != 2 or abs(sum(ratios) - 1.0) > 0.01:
                        problems.append(f"a virtual extruder's ratios are {ratios}, "
                                        "which do not sum to 1")
        for banned in ("Metadata/Slic3r_PE.config", "Metadata/model_settings.config",
                       "Metadata/slice_info.config", "Metadata/project_settings.config"):
            if banned in members:
                problems.append(f"{banned} is a Bambu/Orca file and must not be in a "
                                "PrusaSlicer project")
        if PRUSA_MODEL_CONFIG not in members:
            problems.append("the Prusa model structure is missing")
    return problems
