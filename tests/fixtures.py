"""Small synthetic 3MF projects.

These build the structures the real files use -- shared mesh members holding
several inner objects, per-part colours, inline (path-less) component resources,
sub-divided paint -- without any real model geometry, so the tests stay small and
nothing copyrighted is copied into the repository.
"""

from __future__ import annotations

import json
import os
import zipfile

XML = '<?xml version="1.0" encoding="UTF-8"?>\n'

TRIANGLES = (
    '<triangle v1="0" v2="1" v3="2"/>\n'
    '<triangle v1="0" v2="2" v3="3"/>\n'
)
VERTICES = (
    '<vertex x="0" y="0" z="0"/>\n'
    '<vertex x="10" y="0" z="0"/>\n'
    '<vertex x="10" y="10" z="0"/>\n'
    '<vertex x="0" y="10" z="0"/>\n'
)


def inner_mesh_object(oid: str, paint: tuple | None = None, translate=(0, 0, 0)) -> str:
    """One <object> holding a four-vertex, two-triangle mesh.

    ``paint`` is a tuple of two attribute values (whole-triangle or sub-divided),
    written as ``paint_color`` the way Bambu/Orca store them.
    """
    body = ["   <mesh>\n    <vertices>\n"]
    for line in VERTICES.splitlines(True):
        if translate != (0, 0, 0):
            x, y, z = (float(v) for v in
                       (line.split('x="')[1].split('"')[0], line.split('y="')[1].split('"')[0],
                        line.split('z="')[1].split('"')[0]))
            line = ('     <vertex x="%g" y="%g" z="%g"/>\n'
                    % (x + translate[0], y + translate[1], z + translate[2]))
        body.append(line)
    body.append("    </vertices>\n    <triangles>\n")
    for i, line in enumerate(TRIANGLES.splitlines(True)):
        if paint and paint[i]:
            line = line.replace("/>", ' paint_color="%s"/>' % paint[i])
        body.append("     " + line.strip() + "\n")
    body.append("    </triangles>\n   </mesh>\n")
    return '  <object id="%s" type="model">\n%s  </object>\n' % (oid, "".join(body))


def component(objectid: str, path: str | None = None, translate=(0, 0, 0), uuid_tag="0") -> str:
    path_attr = ' p:path="%s"' % path if path else ""
    tf = "1 0 0 0 1 0 0 0 1 %g %g %g" % translate
    return ('   <component%s objectid="%s" p:UUID="00000000-0000-4000-8000-%012d" '
            'transform="%s"/>\n' % (path_attr, objectid, int(uuid_tag), tf))


def mesh_member(objects: list) -> bytes:
    """A 3D/Objects/*.model file holding several inner objects."""
    return (XML
            + '<model unit="millimeter" xml:lang="en-US" '
              'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
              'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" '
              'requiredextensions="p">\n'
              ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n'
              " <resources>\n" + "".join(objects) + " </resources>\n"
              " <build/>\n</model>\n").encode("utf-8")


def main_model(objects: list, items: list) -> bytes:
    return (XML
            + '<model unit="millimeter" xml:lang="en-US" '
              'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
              'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
              'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" '
              'requiredextensions="p">\n'
              ' <metadata name="Application">BambuStudio-02.08.03.66</metadata>\n'
              ' <metadata name="Title">synthetic project</metadata>\n'
              " <resources>\n" + "".join(objects) + " </resources>\n"
              ' <build p:UUID="00000000-0000-4000-8000-00000000ffff">\n'
            + "".join(items) + " </build>\n</model>\n").encode("utf-8")


def build_item(objectid: str, translate=(0, 0, 0), rotate=None) -> str:
    if rotate:
        tf = "%g %g %g %g %g %g %g %g %g %g %g %g" % (rotate + translate)
    else:
        tf = "1 0 0 0 1 0 0 0 1 %g %g %g" % translate
    return ('  <item objectid="%s" p:UUID="00000000-0000-4000-8000-00000000%04d" '
            'transform="%s" printable="1"/>\n' % (objectid, int(objectid), tf))


def model_settings(objects: list, plates: list) -> bytes:
    """``objects`` and ``plates`` in the shape Bambu/Orca write."""
    body = []
    for entry in objects:
        parts = []
        for part in entry.get("parts", []):
            meta = ['      <metadata key="name" value="%s"/>\n' % part.get("name", "part")]
            meta.append('      <metadata key="matrix" value="%s"/>\n'
                        % part.get("matrix", "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"))
            if part.get("source_file"):
                meta.append('      <metadata key="source_file" value="%s"/>\n'
                            % part["source_file"])
            if part.get("extruder"):
                meta.append('      <metadata key="extruder" value="%s"/>\n' % part["extruder"])
            parts.append('    <part id="%s" subtype="%s">\n%s    </part>\n'
                         % (part["id"], part.get("subtype", "normal_part"),
                            "".join(meta)))
        body.append('  <object id="%s">\n'
                    '    <metadata key="name" value="%s"/>\n'
                    '    <metadata key="extruder" value="%s"/>\n%s  </object>\n'
                    % (entry["id"], entry.get("name", "object"),
                       entry.get("extruder", 1), "".join(parts)))
    for plate in plates:
        seen = {}
        rows = []
        for oid in plate["objects"]:
            index = seen.get(oid, 0)
            seen[oid] = index + 1
            rows.append(
                "   <model_instance>\n"
                '    <metadata key="object_id" value="%s"/>\n'
                '    <metadata key="instance_id" value="%d"/>\n'
                '    <metadata key="identify_id" value="%d"/>\n'
                "   </model_instance>\n" % (oid, index, 100 + index))
        instances = "".join(rows)
        body.append('  <plate>\n'
                    '   <metadata key="plater_id" value="%s"/>\n'
                    '   <metadata key="plater_name" value="%s"/>\n'
                    '   <metadata key="locked" value="false"/>\n%s  </plate>\n'
                    % (plate["id"], plate.get("name", "Plate %s" % plate["id"]), instances))
    return (XML + "<config>\n" + "".join(body) + "</config>\n").encode("utf-8")


def project_settings(colors: list, types: list | None = None, extra: dict | None = None) -> bytes:
    cfg = {
        "filament_colour": colors,
        "filament_type": types or ["PLA"] * len(colors),
        "filament_settings_id": ["Bambu PLA Basic @BBL A1"] * len(colors),
        "extruder_colour": ["#018001"],
        "printer_settings_id": "Bambu Lab A1 0.4 nozzle",
        "print_settings_id": "0.20mm Standard @BBL A1",
        "layer_height": "0.2",
        "wall_loops": "2",
        "enable_support": "0",
    }
    cfg.update(extra or {})
    return json.dumps(cfg, indent=2).encode("utf-8")


def write_project(path: str, main: bytes, members: dict, settings: bytes,
                  meta: bytes, rels: list | None = None) -> str:
    """Assemble a Bambu-shaped project archive on disk."""
    rels = rels if rels is not None else sorted(members)
    rel_body = "".join(
        ' <Relationship Target="/%s" Id="rel-%d" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
        % (name, i + 1) for i, name in enumerate(rels))
    content_types = (XML
                     + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
                       ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
                       ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
                       ' <Default Extension="png" ContentType="image/png"/>\n'
                       "</Types>\n")
    root_rels = (XML
                 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
                   ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" '
                   'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
                   "</Relationships>\n")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("3D/_rels/3dmodel.model.rels",
                    XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
                    + rel_body + "</Relationships>\n")
        zf.writestr("Metadata/slice_info.config",
                    XML + '<config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header></config>\n')
        zf.writestr("Metadata/project_settings.config", settings)
        zf.writestr("Metadata/model_settings.config", meta)
        zf.writestr("3D/3dmodel.model", main)
        for name, data in members.items():
            zf.writestr(name, data)
    return path


def two_plate_project(path: str, five_colours: bool = False) -> str:
    """The workhorse fixture.

    * ``object_shared.model`` holds two inner meshes, one of them painted, plus an
      unused third object so pruning has something to prove;
    * object 10 is built from both meshes (per-part extruders 3 and 1) and is used
      by plate 1 only;
    * object 11 stores its mesh *inline* in the main model, through a path-less
      component, and appears on both plates;
    * plate 1 holds 10 + 11, plate 2 holds 11 twice (with *two* build items, the
      way a slicer saves two instances), so instance handling and plate isolation
      are both exercised;
    * ``five_colours`` adds a third part to object 10 with its own extruder, which
      is what makes a plate need more colours than the machine has.
    """
    shared = mesh_member([
        inner_mesh_object("1", paint=("8", "8")),
        inner_mesh_object("2", translate=(20, 0, 0)),
        inner_mesh_object("3", translate=(40, 0, 0)),      # the third part, when asked for
    ])
    object_ten_components = (
        component("1", "/3D/Objects/object_shared.model", (0, 0, 0), "1")
        + component("2", "/3D/Objects/object_shared.model", (0, 0, 5), "2")
        + (component("3", "/3D/Objects/object_shared.model", (0, 0, 10), "3")
           if five_colours else ""))
    main = main_model(
        objects=[
            '  <object id="10" type="model">\n   <components>\n'
            + object_ten_components
            + "   </components>\n  </object>\n",
            '  <object id="11" type="model">\n   <components>\n'
            + component("12", None, (60, 0, 0), "3")
            + "   </components>\n  </object>\n",
            inner_mesh_object("12", paint=("0C", None), translate=(60, 0, 0)),
        ],
        items=[build_item("10", (100, 100, 0)),
               build_item("11", (150, 100, 0)),
               build_item("11", (150, 160, 0))])
    parts = [{"id": "1", "name": "shell", "extruder": 3, "source_file": "shell.step"},
             {"id": "2", "name": "trim", "source_file": "trim.step"}]
    if five_colours:
        parts.append({"id": "3", "name": "eye", "extruder": 5, "source_file": "eye.step"})
    meta = model_settings(
        objects=[{"id": "10", "name": "Alpha", "extruder": 1, "parts": parts},
                 {"id": "11", "name": "Beta", "extruder": 4, "parts": [
                     {"id": "1", "name": "Beta", "extruder": 4}]}],
        plates=[{"id": 1, "name": "Multicolour", "objects": ["10", "11"]},
                {"id": 2, "name": "Spares", "objects": ["11", "11"]}])
    settings = project_settings(
        ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00"])
    return write_project(path, main, {"3D/Objects/object_shared.model": shared},
                         settings, meta)


def bogus_paint_project(path: str) -> str:
    """A project whose paint cannot be decoded (a split cut off mid-stream)."""
    main = main_model(
        objects=[inner_mesh_object("1", paint=("1", "4444444444444444444444444444444444"))],
        items=[build_item("1", (100, 100, 0))])
    meta = model_settings(objects=[{"id": "1", "name": "Odd"}], plates=[
        {"id": 1, "name": "Plate", "objects": ["1"]}])
    return write_project(path, main, {}, project_settings(["#FFFFFF", "#000000"]), meta)


def wide_quad_project(path: str, quads: int = 4) -> str:
    """One object whose `quads` two-triangle tiles run left to right along X.

    A preview that keeps the *first* triangles of a big model shows one corner of
    it; one that samples evenly shows the whole span.  With `quads` tiles at 20 mm
    each, sampling keeps tiles from both ends of the row.
    """
    vertices = []
    triangles = []
    for quad in range(quads):
        base = len(vertices)
        x = quad * 20.0
        vertices += [f'     <vertex x="{x}" y="0" z="0"/>\n',
                     f'     <vertex x="{x + 20}" y="0" z="0"/>\n',
                     f'     <vertex x="{x + 20}" y="10" z="0"/>\n',
                     f'     <vertex x="{x}" y="10" z="0"/>\n']
        triangles += [f'      <triangle v1="{base}" v2="{base + 1}" '
                      f'v3="{base + 2}"/>\n',
                      f'      <triangle v1="{base}" v2="{base + 2}" '
                      f'v3="{base + 3}"/>\n']
    mesh = ('  <object id="1" type="model">\n   <mesh>\n    <vertices>\n'
            + "".join(vertices) + "    </vertices>\n    <triangles>\n"
            + "".join(triangles) + "    </triangles>\n   </mesh>\n  </object>\n")
    main = main_model(objects=[mesh], items=[build_item("1", (0, 0, 0))])
    meta = model_settings(objects=[{"id": "1", "name": "Wide"}], plates=[
        {"id": 1, "name": "Plate", "objects": ["1"]}])
    return write_project(path, main, {}, project_settings(["#FFFFFF", "#000000"]), meta)


def out_of_palette_paint_project(path: str) -> str:
    """A decodable paint value that names a colour the palette never describes.

    ``6C`` is leaf state 9; the palette below lists two colours.  Carrying the
    value through unchanged (or drawing it white) hides the mismatch.
    """
    main = main_model(
        objects=[inner_mesh_object("1", paint=("6C", "6C"))],
        items=[build_item("1", (0, 0, 0))])
    meta = model_settings(
        objects=[{"id": "1", "name": "Unknown", "extruder": 1,
                  "parts": [{"id": "1", "name": "body", "extruder": 1}]}],
        plates=[{"id": 1, "name": "Plate", "objects": ["1"]}])
    return write_project(path, main, {}, project_settings(["#FFFFFF", "#000000"]), meta)


def hidden_role_project(path: str, subtype: str = "negative_part") -> str:
    """One object with a normal part and a control volume (a hole or a blocker)."""
    member = mesh_member([
        inner_mesh_object("1", paint=("1C", "2C")),
        inner_mesh_object("2", translate=(20, 0, 0)),
    ])
    main = main_model(
        objects=['  <object id="10" type="model">\n   <components>\n'
                 + component("1", "/3D/Objects/object_both.model", (0, 0, 0), "1")
                 + component("2", "/3D/Objects/object_both.model", (0, 0, 0), "2")
                 + "   </components>\n  </object>\n"],
        items=[build_item("10", (100, 100, 0))])
    meta = model_settings(
        objects=[{"id": "10", "name": "WithControl", "extruder": 1,
                  "parts": [{"id": "1", "name": "body", "extruder": 1},
                            {"id": "2", "name": "cavity", "extruder": 1,
                             "subtype": subtype}]}],
        plates=[{"id": 1, "name": "Plate", "objects": ["10"]}])
    return write_project(path, main, {"3D/Objects/object_both.model": member},
                         project_settings(["#FFFFFF", "#000000"]), meta)


def single_object_project(path: str, paint=("1C", "2C"), colors=None) -> str:
    """The shape the single-object converter was written for: one plate, one
    object, one component, one mesh, painted whole triangles."""
    member = mesh_member([inner_mesh_object("1", paint=paint)])
    main = main_model(
        objects=['  <object id="10" type="model">\n   <components>\n'
                 + component("1", "/3D/Objects/object_only.model", (0, 0, 0), "1")
                 + "   </components>\n  </object>\n"],
        items=[build_item("10", (120, 120, 0))])
    meta = model_settings(
        objects=[{"id": "10", "name": "Solo", "extruder": 1,
                  "parts": [{"id": "1", "name": "Solo", "source_file": "solo.stl"}]}],
        plates=[{"id": 1, "name": "Only", "objects": ["10"]}])
    settings = project_settings(colors or ["#FFFFFF", "#000000", "#FF0000", "#00FF00",
                                           "#0000FF", "#FFFF00"])
    return write_project(path, main, {"3D/Objects/object_only.model": member},
                         settings, meta)


def _prefixed(project, meta_objects, name="obj.3mf"):
    """Write a simple one-object project with the given member and metadata."""
    return write_project(project, meta_objects["main"], meta_objects["members"],
                         project_settings(meta_objects.get("colors", ["#FFFFFF", "#000000"])),
                         model_settings(objects=meta_objects["objects"],
                                        plates=meta_objects.get("plates", [
                                            {"id": 1, "name": "Plate", "objects": ["1"]}])))


def rotated_duplicates_project(path: str) -> str:
    """Two components of one object: same translation, different rotation."""
    member = mesh_member([inner_mesh_object("1")])
    # second copy rotated 90 degrees about Z, same translation
    rotated = "0 1 0 -1 0 0 0 0 1 %g %g %g" % (0, 0, 0)
    main = main_model(
        objects=['  <object id="1" type="model">\n   <components>\n'
                 + component("1", "/3D/Objects/object_pair.model", (0, 0, 0), "1")
                 + '   <component p:path="/3D/Objects/object_pair.model" objectid="1" '
                   'transform="%s"/>\n' % rotated
                 + "   </components>\n  </object>\n"],
        items=[build_item("1", (100, 100, 0))])
    return _prefixed(path, {"main": main,
                            "members": {"3D/Objects/object_pair.model": member},
                            "objects": [{"id": "1", "name": "Pair", "extruder": 1,
                                         "parts": [{"id": "1", "extruder": 1},
                                                   {"id": "1", "extruder": 2}]}]})


def rotated_preview_project(path: str) -> str:
    """One inlined mesh placed with a rotation *and* a translation.

    A preview that transposes the placement matrix still agrees with a
    translation-only placement, so the item is turned as well.  ``+90`` degrees
    about Z then ``+ (100, 100, 30)`` is the matrix::

        0  1  0  0
       -1  0  0  0
        0  0  1  0
      100 100 30  1

    which sends the fixture's four vertices to (100,100,30), (100,110,30),
    (90,110,30) and (90,100,30).  The transposed reading would answer
    (100,100,30), (90,100,30), (90,90,30), (100,90,30) instead.
    """
    main = main_model(
        objects=[inner_mesh_object("1", paint=("1C", "2C"))],
        items=[build_item("1", (100, 100, 30), rotate=(0, 1, 0, -1, 0, 0, 0, 0, 1))])
    return _prefixed(path, {"main": main, "members": {},
                            "objects": [{"id": "1", "name": "Turned", "extruder": 1,
                                         "parts": [{"id": "1", "extruder": 1}]}]})


def nested_project(path: str, cycle: bool = False, missing: bool = False,
                   cross_member: bool = False) -> str:
    """A member whose inner objects are an assembly, optionally broken."""
    if missing:
        holder = ('  <object id="2" type="model">\n   <components>\n'
                  + component("99", "/3D/Objects/object_assembly.model", (0, 0, 0), "2")
                  + "   </components>\n  </object>\n")
    elif cycle:
        holder = ('  <object id="2" type="model">\n   <components>\n'
                  + component("3", "/3D/Objects/object_assembly.model", (0, 0, 0), "2")
                  + "   </components>\n  </object>\n"
                  + '  <object id="3" type="model">\n   <components>\n'
                  + component("2", "/3D/Objects/object_assembly.model", (0, 0, 0), "3")
                  + "   </components>\n  </object>\n")
    elif cross_member:
        holder = ('  <object id="2" type="model">\n   <components>\n'
                  + component("1", "/3D/Objects/object_extra.model", (0, 0, 0), "2")
                  + "   </components>\n  </object>\n")
    else:
        holder = ('  <object id="2" type="model">\n   <components>\n'
                  + component("1", None, (5, 0, 0), "2")
                  + "   </components>\n  </object>\n")
    member = mesh_member([inner_mesh_object("1"), holder])
    members = {"3D/Objects/object_assembly.model": member}
    if cross_member:
        members["3D/Objects/object_extra.model"] = mesh_member(
            [inner_mesh_object("1", translate=(40, 0, 0))])
    main = main_model(
        objects=['  <object id="1" type="model">\n   <components>\n'
                 + component("2", "/3D/Objects/object_assembly.model", (0, 0, 0), "1")
                 + "   </components>\n  </object>\n"],
        items=[build_item("1", (100, 100, 0))])
    return _prefixed(path, {"main": main, "members": members,
                            "objects": [{"id": "1", "name": "Assembly", "extruder": 1,
                                         "parts": [{"id": "2", "extruder": 3}]}]})


def shuffled_parts_project(path: str) -> str:
    """Part metadata listed in a different order than the components."""
    member = mesh_member([inner_mesh_object("1"), inner_mesh_object("2")])
    main = main_model(
        objects=['  <object id="1" type="model">\n   <components>\n'
                 + component("1", "/3D/Objects/object_shuffled.model", (0, 0, 0), "1")
                 + component("2", "/3D/Objects/object_shuffled.model", (20, 0, 0), "2")
                 + "   </components>\n  </object>\n"],
        items=[build_item("1", (100, 100, 0))])
    return _prefixed(path, {
        "main": main, "members": {"3D/Objects/object_shuffled.model": member},
        "colors": ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF"],
        "objects": [{"id": "1", "name": "Shuffled", "extruder": 1, "parts": [
            {"id": "2", "name": "second", "extruder": 5},
            {"id": "1", "name": "first", "extruder": 3}]}]})


def fully_painted_project(path: str, base_extruder: int = 7) -> str:
    """Every facet painted, so the object's own filament is not a colour it needs."""
    main = main_model(
        objects=[inner_mesh_object("1", paint=("4", "8"))],
        items=[build_item("1", (100, 100, 0))])
    return _prefixed(path, {
        "main": main, "members": {},
        "colors": ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00",
                   "#00FFFF"],
        "objects": [{"id": "1", "name": "Painted", "extruder": base_extruder,
                     "parts": [{"id": "1", "extruder": base_extruder}]}]})


def prusa_multi_volume_project(path: str) -> str:
    """A PrusaSlicer project with two volumes in one object (not supported)."""
    member = main_model(objects=[inner_mesh_object("1")], items=[build_item("1")])
    prusa_cfg = (
        "; extruder_colour = #FFFFFF;#000000;\n"
        "; filament_colour = #FFFFFF;#000000;\n"
        "; filament_type = PLA;PLA;\n"
        "; printer_model = COREONE\n")
    prusa_model = (
        XML + '<config>\n <object id="1" instances_count="1">\n'
              '  <metadata type="object" key="name" value="TwoVolumes.3mf"/>\n'
              '  <metadata type="object" key="extruder" value="1"/>\n'
              '  <volume firstid="0" lastid="0">\n'
              '   <metadata type="volume" key="name" value="a"/>\n'
              '   <metadata type="volume" key="extruder" value="1"/>\n'
              "  </volume>\n"
              '  <volume firstid="1" lastid="1">\n'
              '   <metadata type="volume" key="name" value="b"/>\n'
              '   <metadata type="volume" key="extruder" value="2"/>\n'
              "  </volume>\n"
              " </object>\n</config>\n").encode("utf-8")
    content_types = (XML
                     + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
                       ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
                       ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
                       "</Types>\n")
    root_rels = (XML
                 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
                   ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" '
                   'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
                   "</Relationships>\n")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("3D/3dmodel.model", member)
        zf.writestr("Metadata/Slic3r_PE.config", prusa_cfg)
        zf.writestr("Metadata/Slic3r_PE_model.config", prusa_model)
    return path


def prusa_negative_volume_project(path: str) -> str:
    """A PrusaSlicer object made of a model volume *and* a negative volume.

    PrusaSlicer gives each volume a triangle range and a ``volume_type``; a
    negative volume subtracts material instead of printing, so treating it as
    solid geometry changes the model.  The reader has to refuse this (it works in
    whole meshes) rather than print the model with a hole filled in.
    """
    member = main_model(objects=[inner_mesh_object("1")], items=[build_item("1")])
    prusa_cfg = (
        "; extruder_colour = #FFFFFF;#000000;\n"
        "; filament_colour = #FFFFFF;#000000;\n"
        "; filament_type = PLA;PLA;\n"
        "; printer_model = COREONE\n")
    prusa_model = (
        XML + '<config>\n <object id="1" instances_count="1">\n'
              '  <metadata type="object" key="name" value="Hole.3mf"/>\n'
              '  <metadata type="object" key="extruder" value="1"/>\n'
              '  <volume firstid="0" lastid="0">\n'
              '   <metadata type="volume" key="name" value="body"/>\n'
              '   <metadata type="volume" key="extruder" value="1"/>\n'
              '   <metadata type="volume" key="volume_type" value="ModelPart"/>\n'
              "  </volume>\n"
              '  <volume firstid="1" lastid="1">\n'
              '   <metadata type="volume" key="name" value="cavity"/>\n'
              '   <metadata type="volume" key="extruder" value="1"/>\n'
              '   <metadata type="volume" key="volume_type" value="NegativeVolume"/>\n'
              "  </volume>\n"
              " </object>\n</config>\n").encode("utf-8")
    content_types = (XML
                     + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
                       ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
                       ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
                       "</Types>\n")
    root_rels = (XML
                 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
                   ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" '
                   'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
                   "</Relationships>\n")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("3D/3dmodel.model", member)
        zf.writestr("Metadata/Slic3r_PE.config", prusa_cfg)
        zf.writestr("Metadata/Slic3r_PE_model.config", prusa_model)
    return path


def prusa_portable_project(path: str, spectrum: bool = True,
                           palette_ids=(1, 2, 3, 4, 5),
                           paint=("1C", "2C")) -> str:
    """A *portable* PrusaSlicer colour project: no Slic3r_PE.config at all.

    This is the shape this tool writes (and the shape PaintPort documents): the
    user's own print preset must not be overridden, so the palette lives in
    ``Metadata/Prusa_Slicer_full_spectrum.json`` instead.  With
    ``spectrum=False`` the archive has no palette anywhere, which a reader has to
    refuse rather than fill with white.
    """
    member = main_model(objects=[inner_mesh_object("1", paint=paint)],
                        items=[build_item("1", (0, 0, 0))])
    prusa_model = (
        XML + '<config>\n <object id="1" instances_count="1">\n'
              '  <metadata type="object" key="name" value="Portable.3mf"/>\n'
              '  <metadata type="object" key="extruder" value="2"/>\n'
              '  <volume firstid="0" lastid="1">\n'
              '   <metadata type="volume" key="name" value="Model"/>\n'
              '   <metadata type="volume" key="extruder" value="2"/>\n'
              '   <metadata type="volume" key="volume_type" value="ModelPart"/>\n'
              "  </volume>\n"
              " </object>\n</config>\n").encode("utf-8")
    content_types = (XML
                     + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
                       ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
                       ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
                       "</Types>\n")
    root_rels = (XML
                 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
                   ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" '
                   'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
                   "</Relationships>\n")
    palette = ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00"]

    def colour_of(index: int) -> str:
        return palette[index - 1] if 1 <= index <= len(palette) else "#808080"

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("3D/3dmodel.model", member)
        zf.writestr("Metadata/Slic3r_PE_model.config", prusa_model)
        if spectrum:
            zf.writestr("Metadata/Prusa_Slicer_full_spectrum.json", json.dumps({
                "version": 1,
                "physical_extruders": [
                    {"id": i, "color": colour_of(i), "kind": "physical", "type": "PLA"}
                    for i in palette_ids if i <= 4],
                "virtual_extruders": [
                    {"id": i, "color": colour_of(i), "kind": "fullspectrum",
                     "components": [{"extruder": 3, "ratio": 0.5},
                                    {"extruder": 4, "ratio": 0.5}]}
                    for i in palette_ids if i > 4],
            }, indent=2))
    return path
