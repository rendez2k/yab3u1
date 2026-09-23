"""Acceptance against the user's own examples, read-only.

These skip unless the files are present, so the archive never carries them.  Each
case asserts what the plan documents about that file, and the exports go to a
temporary directory: nothing here writes next to the sources.
"""

import os
import tempfile
import unittest
import zipfile

import u1colour
import u1convert as u1
import u1project as u1p
from tests import upstream_paint as oracle

DESKTOP = r"C:\Users\rende\Desktop"
D_DRIVE = r"D:\3D"

BL0B_DESKTOP = os.path.join(DESKTOP, "5 colour test-Blob Lab_Monsters V1.3mf")
BLOB_FULL = os.path.join(D_DRIVE, "Blob Lab_Monsters V1.3mf")
WOOKIE_BAMBU = os.path.join(D_DRIVE, "Hex3D_WookieMonster_Color",
                            "Hex3D_WookieMonster_Full_Bambu_5Color.3mf")
WOOKIE_GENERIC = os.path.join(D_DRIVE, "Hex3D_WookieMonster_Color",
                              "Hex3D_WookieMonster_Full_Generic_5Color.3mf")
ALIEN = os.path.join(DESKTOP, "They live alien_5 colors.3mf")


class RealFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="u1real-")
        u1.LOG_SINK = lambda *_a: None

    @classmethod
    def tearDownClass(cls):
        u1.LOG_SINK = None
        cls.tmp.cleanup()

    def load(self, path):
        zf = zipfile.ZipFile(path)
        self.addCleanup(zf.close)
        return zf, u1p.read_project(zf)

    def export(self, zf, project, selection, plan, name):
        out = os.path.join(self.tmp.name, name)
        result = u1p.export(zf, project, selection, plan, out,
                            profile_root=u1.find_profile_root())
        report = u1p.verify_export(out, zf, project, selection, plan)
        return result, report

    # -- fixtures -----------------------------------------------------------------
    @unittest.skipUnless(os.path.isfile(BL0B_DESKTOP), "example not on this machine")
    def test_desktop_blob_offers_two_separate_prints(self):
        zf, project = self.load(BL0B_DESKTOP)
        self.assertEqual("bambu", project.kind)
        self.assertEqual([1], [p.id for p in project.plates])
        self.assertEqual("Monster Multicolor", project.plates[0].name)
        self.assertEqual(["11", "24"], project.plates[0].object_ids)
        self.assertEqual(["Blob Monster_Iggy", "Blob Monster_Sitting Body"],
                         [project.object_name_for(o) for o in project.plates[0].object_ids])
        self.assertEqual({1, 2, 3, 4}, u1p.object_used_extruders(zf, project, "11"))
        self.assertEqual({1, 4, 5}, u1p.object_used_extruders(zf, project, "24"))

        info = u1p.analyse(zf, project, u1p.select(project))
        self.assertEqual([1, 2, 3, 4, 5], info["mapping"]["used"])
        self.assertEqual(5, info["source"]["palette_size"])
        options = {o["id"]: o for o in info["options"]}
        self.assertFalse(options["direct"]["feasible"])
        self.assertTrue(options["separate"]["feasible"])
        self.assertEqual(2, options["separate"]["prints"])

    @unittest.skipUnless(os.path.isfile(BL0B_DESKTOP), "example not on this machine")
    def test_desktop_blob_direct_exports_keep_their_colours(self):
        zf, project = self.load(BL0B_DESKTOP)
        for oid, triangles, colours in (("11", 875000, {1, 2, 3, 4}),
                                        ("24", 896226, {1, 4, 5})):
            selection = u1p.select(project, 1, [oid])
            plan = u1p.plan_for(zf, project, selection)
            self.assertEqual("direct", plan.mode)
            used = [e for e in sorted(colours)]
            self.assertEqual({e: i + 1 for i, e in enumerate(used)}, plan.mapping)
            result, report = self.export(zf, project, selection, plan, f"{oid}.3mf")
            self.assertEqual([], report["problems"])
            self.assertEqual(triangles, report["triangles"])
            self.assertEqual([], [p for p in report["problems"] if "paint" in p])

    @unittest.skipUnless(os.path.isfile(BL0B_DESKTOP) and os.path.isfile(BLOB_FULL),
                         "example not on this machine")
    def test_full_blob_has_four_plates_and_isolates_the_selection(self):
        zf, project = self.load(BLOB_FULL)
        self.assertEqual([1, 2, 3, 4], [p.id for p in project.plates])
        self.assertEqual(["Monster Multicolor", "Monster Hybrid Color",
                          "Monster Bodies Single Color", "Accessories"],
                         [p.name for p in project.plates])
        self.assertEqual(5, len(project.plates[0].object_ids))
        self.assertEqual(33, len(project.plates[2].object_ids))

        plate_one = u1p.analyse(zf, project, u1p.select(project, 1))
        self.assertEqual(9, len(plate_one["mapping"]["used"]))
        self.assertFalse(plate_one["mapping"]["direct_possible"])
        self.assertEqual(4, plate_one["separate"]["prints"])

        accessories = u1p.analyse(zf, project, u1p.select(project, 4))
        self.assertTrue(accessories["mapping"]["direct_possible"])
        self.assertEqual([1, 2, 4, 12], accessories["mapping"]["used"])
        self.assertEqual(3, accessories["counts"]["objects"])

        # selecting plate 4 exports plate 4 only: no object from another plate
        selection = u1p.select(project, 4)
        plan = u1p.plan_for(zf, project, selection)
        result, report = self.export(zf, project, selection, plan, "accessories.3mf")
        self.assertEqual([], report["problems"])
        self.assertEqual(3, result["instances"])
        self.assertEqual(accessories["counts"]["triangles"], report["triangles"])

    @unittest.skipUnless(os.path.isfile(WOOKIE_BAMBU), "example not on this machine")
    def test_wookiemonster_bambu_keeps_five_colours_and_asks_first(self):
        zf, project = self.load(WOOKIE_BAMBU)
        info = u1p.analyse(zf, project, u1p.select(project))
        self.assertEqual([1, 2, 3, 4, 5], info["mapping"]["used"])
        self.assertEqual(["#BE8969", "#6F5034", "#FFFFFF", "#000000", "#E4BD68"],
                         [project.color_for(e) for e in range(1, 6)])
        self.assertEqual(498390, info["counts"]["triangles"])
        self.assertEqual(200576, info["counts"]["painted_triangles"])
        with self.assertRaises(u1.ConvertError):
            u1p.plan_for(zf, project, u1p.select(project))

    @unittest.skipUnless(os.path.isfile(WOOKIE_BAMBU), "example not on this machine")
    def test_wookiemonster_approximation_remaps_every_painted_triangle(self):
        zf, project = self.load(WOOKIE_BAMBU)
        selection = u1p.select(project)
        plan = u1p.plan_for(zf, project, selection,
                            slots=["#FFFFFF", "#000000", "#3D9140", "#FF9500"],
                            approximate=True)
        # brown -> orange, dark brown -> black, white -> white, black -> black,
        # tan -> orange
        self.assertEqual({1: 4, 2: 2, 3: 1, 4: 2, 5: 4}, plan.mapping)
        _result, report = self.export(zf, project, selection, plan, "wookie.3mf")
        self.assertEqual([], report["problems"])
        self.assertEqual({2: 100352, 1: 80766, 4: 19458}, report["paint"])

    @unittest.skipUnless(os.path.isfile(WOOKIE_GENERIC), "example not on this machine")
    def test_wookiemonster_generic_inline_mesh_matches_the_bambu_copy(self):
        zf, project = self.load(WOOKIE_GENERIC)
        self.assertEqual([1], [p.id for p in project.plates])
        self.assertEqual(["2"], project.plates[0].object_ids)
        info = u1p.analyse(zf, project, u1p.select(project))
        self.assertEqual(498390, info["counts"]["triangles"])
        self.assertEqual(200576, info["counts"]["painted_triangles"])
        self.assertEqual([1, 2, 3, 4, 5], info["mapping"]["used"])
        selection = u1p.select(project)
        plan = u1p.plan_for(zf, project, selection, approximate=True,
                            slots=["#FFFFFF", "#000000", "#3D9140", "#FF9500"])
        _result, report = self.export(zf, project, selection, plan, "generic.3mf")
        self.assertEqual([], report["problems"])
        self.assertEqual({2: 100352, 1: 80766, 4: 19458}, report["paint"])

    @unittest.skipUnless(os.path.isfile(ALIEN), "example not on this machine")
    def test_alien_prusa_uses_the_extruder_palette_and_five_colours(self):
        zf, project = self.load(ALIEN)
        self.assertEqual("prusa", project.kind)
        self.assertEqual(8, project.palette_count)
        self.assertEqual("extruder_colour", project.palette_source)
        self.assertEqual(["#0080C0", "#FF0000", "#FFFFFF", "#000000", "#C5C263"],
                         [project.color_for(e) for e in range(1, 6)])
        info = u1p.analyse(zf, project, u1p.select(project))
        self.assertEqual([1, 2, 3, 4, 5], info["mapping"]["used"])
        self.assertEqual(1333448, info["counts"]["triangles"])
        # every facet is painted: the 152 sub-divided ones count too
        self.assertEqual(1333448, info["counts"]["painted_triangles"])
        self.assertEqual(152, info["counts"]["subdivided_triangles"])
        self.assertTrue(any("sub-divided" in w for w in info["warnings"]))
        self.assertFalse({o["id"]: o for o in info["options"]}["direct"]["feasible"])

    @unittest.skipUnless(os.path.isfile(ALIEN), "example not on this machine")
    def test_alien_explicit_remap_rewrites_whole_and_sub_divided_paint(self):
        zf, project = self.load(ALIEN)
        selection = u1p.select(project)
        plan = u1p.plan_for(zf, project, selection, approximate=True,
                            slots=["#FFFFFF", "#000000", "#3D9140", "#FF9500"])
        self.assertEqual({1: 1, 2: 4, 3: 1, 4: 2, 5: 4}, plan.mapping)
        result, report = self.export(zf, project, selection, plan, "alien.3mf")
        self.assertEqual([], report["problems"])
        self.assertEqual({1: 137717, 2: 1133249, 4: 62330}, report["paint"])
        # supports are renamed, never renumbered
        with zipfile.ZipFile(result["output"]) as zout:
            blob = "".join(zout.read(n).decode("utf-8", "replace")
                           for n in zout.namelist() if n.endswith(".model"))
        self.assertIn("paint_supports", blob)
        self.assertNotIn("custom_supports", blob)

    @unittest.skipUnless(os.path.isfile(ALIEN), "example not on this machine")
    def test_alien_export_survives_an_independent_parser(self):
        """Facet by facet, with a reader written from the upstream grammar.

        The earlier build remapped the split header's special side and produced
        values that do not parse at all; this walks the whole mesh with a second
        implementation and compares topology and mapped materials per facet.
        """
        zf, project = self.load(ALIEN)
        selection = u1p.select(project)
        plan = u1p.plan_for(zf, project, selection, approximate=True,
                            slots=["#FFFFFF", "#000000", "#3D9140", "#FF9500"])
        result, _report = self.export(zf, project, selection, plan, "alien-oracle.3mf")
        mapping = dict(plan.mapping)
        problems: list = []
        with zipfile.ZipFile(result["output"]) as zout:
            out_member = next(n for n in zout.namelist()
                              if n.startswith("3D/Objects/") and n.endswith(".model"))
            with zf.open(u1.MODEL_FILE) as source_handle, zout.open(out_member) as out_handle:
                problems = oracle.compare_members(source_handle, out_handle, mapping)
        self.assertEqual([], problems[:5])

    @unittest.skipUnless(os.path.isfile(ALIEN), "example not on this machine")
    def test_the_value_the_root_compared_maps_cleanly(self):
        source = "42C2CA442C4423"
        mapping = {1: 1, 2: 4, 3: 1, 4: 2, 5: 4}
        out = u1p.u1paint.remap_text(source, mapping)
        self.assertEqual([], oracle.compare_values(source, out, mapping))


if __name__ == "__main__":
    unittest.main()
