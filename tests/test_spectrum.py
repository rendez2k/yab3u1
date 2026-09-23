"""Mixture prediction, the native Full Spectrum format, and its export.

Everything here is synthetic or in-memory: the recipe/id contract is checked
against hand-written rows, and the end-to-end export is read back from the
archive the exporter writes.  No slicer is started.
"""

import json
import os
import tempfile
import unittest
import zipfile

import u1convert as u1
import u1mix
import u1paint
import u1project as u1p
import u1spectrum
from tests import fixtures

REELS = [
    {"slot": 1, "color": "#FFFFFF", "type": "PLA"},
    {"slot": 2, "color": "#000000", "type": "PLA"},
    {"slot": 3, "color": "#3D9140", "type": "PLA"},
    {"slot": 4, "color": "#FF9500", "type": "PLA"},
]

# The five-colour fixture is white, black, red, green and blue.  With these four
# reels its red is closer as an orange/magenta blend than to any single reel --
# which is exactly the case the mixture comparison exists to find.
MIXING_REELS = [
    {"slot": 1, "color": "#FFFFFF", "type": "PLA"},
    {"slot": 2, "color": "#000000", "type": "PLA"},
    {"slot": 3, "color": "#FF9500", "type": "PLA"},
    {"slot": 4, "color": "#FF0080", "type": "PLA"},
]


class Mixtures(unittest.TestCase):
    def test_exact_reel_colour_is_never_mixed(self):
        plan = u1mix.plan_mixtures({1: "#FFFFFF", 2: "#FF9500"}, REELS)
        rows = {row["source"]: row for row in plan["rows"]}
        self.assertEqual("solid", rows[1]["choice"])
        self.assertEqual(1, rows[1]["solid"]["slot"])
        self.assertTrue(rows[1]["exact"])
        self.assertEqual("solid", rows[2]["choice"])
        self.assertEqual([], plan["recipes"])
        self.assertEqual([], [r for r in plan["rows"] if r["choice"] == "mixture"])

    def test_a_recipe_is_only_offered_when_it_really_improves(self):
        # A colour between white and green is the classic case a mixture fixes.
        plan = u1mix.plan_mixtures({1: "#C8D8C0"}, REELS)
        improved = [r for r in plan["rows"] if r["choice"] == "mixture"]
        self.assertTrue(improved, "a pale green should be closer as a white/green mix")
        self.assertEqual(len(improved), len(plan["recipes"]))
        for recipe in plan["recipes"]:
            self.assertIn("percent", recipe)
            self.assertTrue(recipe["color"].startswith("#"))
        # …and the ids follow the reels.
        self.assertEqual([5], [r["id"] for r in plan["recipes"]])

    def test_materials_are_never_blended(self):
        reels = [dict(r) for r in REELS]
        reels[3] = {"slot": 4, "color": "#FF9500", "type": "PETG"}
        plan = u1mix.plan_mixtures({1: "#C8D8C0"}, reels)
        for row in plan["rows"]:
            if row["mixture"]:
                self.assertNotEqual(4, row["mixture"]["b"])

    def test_poor_coverage_advises_changing_filament(self):
        plan = u1mix.plan_mixtures({1: "#B03060"}, REELS)
        self.assertNotIn("mixture", [r["choice"] for r in plan["rows"]])
        self.assertIn("load closer filament", plan["advice"])
        self.assertEqual([], plan["recipes"])


class Format(unittest.TestCase):
    def test_rows_are_custom_first_then_pair_tombstones(self):
        recipes = [{"a": 1, "b": 3, "percent": 50}, {"a": 2, "b": 4, "percent": 25}]
        rows = u1spectrum.definitions(4, recipes)
        self.assertEqual(2 + 6, len(rows))
        first = rows[0].split(",")
        self.assertEqual(["1", "3", "1", "1", "50"], first[:5])
        self.assertEqual("0", first[5])                  # retired same-layer flag
        self.assertIn("m2", rows[0])
        self.assertIn("d0", rows[0])
        self.assertIn("o0", rows[0])
        self.assertIn("u1", rows[0])
        for index, row in enumerate(rows[2:], start=3):
            tokens = row.split(",")
            self.assertEqual(["0", "0"], tokens[2:4], "auto pairs are disabled")
            self.assertIn("d1", row)
            self.assertIn("u%d" % index, row)
        # every unordered physical pair is present exactly once
        pairs = {(min(int(r.split(",")[0]), int(r.split(",")[1])),
                  max(int(r.split(",")[0]), int(r.split(",")[1]))) for r in rows[2:]}
        self.assertEqual({(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)}, pairs)

    def test_virtual_ids_follow_the_physical_reels(self):
        self.assertEqual(5, u1spectrum.virtual_id(4, 0))
        self.assertEqual(8, u1spectrum.virtual_id(4, 3))

    def test_twelve_recipes_is_the_ceiling(self):
        recipes = [{"a": 1, "b": 2, "percent": 50}] * u1spectrum.MAX_RECIPES
        u1spectrum.check(4, recipes)                       # exactly at the limit: fine
        with self.assertRaises(u1spectrum.SpectrumError):
            u1spectrum.check(4, recipes + [{"a": 1, "b": 2, "percent": 50}])

    def test_recipes_must_name_two_real_different_reels(self):
        for recipe in ({"a": 1, "b": 1, "percent": 50}, {"a": 1, "b": 5, "percent": 50},
                       {"a": 1, "b": 2, "percent": 0}, {"a": 1, "b": 2, "percent": 100}):
            with self.assertRaises(u1spectrum.SpectrumError):
                u1spectrum.check(4, [recipe])

    def test_parse_recipes(self):
        self.assertEqual([{"a": 1, "b": 3, "percent": 50},
                          {"a": 2, "b": 4, "percent": 25}],
                         u1spectrum.parse_recipes("1,3,50; 2:4:25"))
        with self.assertRaises(u1spectrum.SpectrumError):
            u1spectrum.parse_recipes("1,3")

    def test_validate_re_reads_what_was_written(self):
        recipes = [{"a": 1, "b": 4, "percent": 75}]
        cfg = u1spectrum.apply({"filament_colour": ["#FFFFFFFF"] * 4,
                                "filament_type": ["PLA"] * 4,
                                "extruder_colour": ["#FFFFFF"] * 4,
                                "nozzle_diameter": ["0.4"] * 4,
                                "filament_flow_ratio": ["1", "1", "1", "1"]},
                               [r["color"] for r in REELS],
                               [r["type"] for r in REELS], recipes)
        self.assertEqual([], u1spectrum.validate(cfg, 4, recipes))
        # The physical palette is what defines the id base: it must NOT grow.
        self.assertEqual(4, len(cfg["filament_colour"]))
        self.assertEqual(4, len(cfg["nozzle_diameter"]))
        self.assertEqual(4, len(cfg["filament_flow_ratio"]))
        for key in u1spectrum.BAMBU_ONLY_KEYS:
            self.assertNotIn(key, cfg)
        self.assertTrue(cfg["filament_colour"][0].endswith("FF"))
        # A tampered recipe table is reported rather than trusted.
        broken = dict(cfg)
        broken["mixed_filament_definitions"] = cfg["mixed_filament_definitions"].replace(
            u1spectrum.definitions(4, recipes)[0], u1spectrum.definitions(4, recipes)[0]
            .replace("1,4", "1,3"), 1)
        self.assertTrue(u1spectrum.validate(broken, 4, recipes))

    def test_virtual_id_oracle_matches_the_written_rows(self):
        # Independent of the writer's helper: walk the rows the way the slicer
        # does and check that id n+1+k lands on the k-th custom row.
        recipes = [{"a": 1, "b": 2, "percent": 25}, {"a": 3, "b": 4, "percent": 75},
                   {"a": 2, "b": 3, "percent": 50}]
        rows = u1spectrum.definitions(4, recipes)
        enabled = [r for r in rows
                   if r.split(",")[2] == "1" and "d1" not in r.split(",")]
        for index, recipe in enumerate(recipes):
            tokens = enabled[index].split(",")
            self.assertEqual(str(recipe["a"]), tokens[0])
            self.assertEqual(str(recipe["b"]), tokens[1])
            self.assertEqual(str(recipe["percent"]), tokens[4])
            self.assertEqual(4 + 1 + index, u1spectrum.virtual_id(4, index))
        self.assertEqual(len(recipes), len(enabled),
                         "only the custom recipes are visible")

    def test_mapping_outside_the_written_range_is_refused(self):
        with self.assertRaises(u1spectrum.SpectrumError):
            u1spectrum.mapping_with_recipes({1: 17}, 4)
        self.assertEqual({1: 5}, u1spectrum.mapping_with_recipes({"1": "5"}, 4))

    def test_a_recipe_may_not_blend_two_materials(self):
        types = ["PLA", "PLA", "PLA", "PETG"]
        u1spectrum.check_types(types, [{"a": 1, "b": 2, "percent": 50}])
        with self.assertRaises(u1spectrum.SpectrumError):
            u1spectrum.check_types(types, [{"a": 1, "b": 4, "percent": 50}])
        cfg = {"filament_colour": ["#FFFFFFFF"] * 4, "filament_type": types,
               "extruder_colour": ["#FFFFFF"] * 4, "nozzle_diameter": ["0.4"] * 4}
        with self.assertRaises(u1spectrum.SpectrumError):
            u1spectrum.apply(cfg, [r["color"] for r in REELS], types,
                             [{"a": 1, "b": 4, "percent": 50}])


class HighIds(unittest.TestCase):
    def test_ids_above_sixteen_are_refused_not_reinterpreted(self):
        # state 17 is written by newer Prusa-format files with a different escape.
        value = u1paint.encode(("leaf", 17))
        self.assertEqual([17], u1paint.excessive_states(value))
        with self.assertRaises(u1.ConvertError):
            u1p._rewrite_paint('paint_color="%s"' % value, {1: 2}, {}, "a test mesh")

    def test_ids_inside_the_range_still_rewrite(self):
        value = u1paint.encode(("leaf", 5))
        self.assertEqual([], u1paint.excessive_states(value))
        out = u1p._rewrite_paint('paint_color="%s"' % value, {5: 2}, {}, "a test mesh")
        self.assertEqual(("leaf", 2), u1paint.decode(out.split('"')[1]))


class Export(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="u1spectrum-tests-")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def analysed(self, name="five.3mf", reels=None):
        reels = reels or MIXING_REELS
        path = os.path.join(self.tmp.name, name)
        fixtures.two_plate_project(path, five_colours=True)
        zf = zipfile.ZipFile(path)
        self.addCleanup(zf.close)
        project = u1p.read_project(zf)
        selection = u1p.select(project, 1, None)
        plan = u1p.plan_for(zf, project, selection,
                            [r["color"] for r in reels], [r["type"] for r in reels],
                            None, True, intent="approximate")
        info = u1p.analyse(zf, project, selection, plan)
        return path, zf, project, selection, plan, info

    def test_five_colour_plate_gets_recipes_and_ids(self):
        _path, _zf, _project, _selection, _plan, info = self.analysed()
        self.assertIsNotNone(info["spectrum"])
        recipes = info["spectrum"]["recipes"]
        self.assertTrue(recipes, "the five-colour fixture must offer something")
        self.assertEqual(list(range(5, 5 + len(recipes))),
                         [r["id"] for r in recipes])
        mapping = info["spectrum"]["suggested_mapping"]
        self.assertIn(5, mapping.values(), "the mixture must be the chosen export id")
        self.assertTrue(all(1 <= v <= 16 for v in mapping.values()))

    def test_spectrum_export_writes_the_native_project(self):
        path, zf, project, selection, plan, info = self.analysed()
        recipes = info["spectrum"]["recipes"]
        plan.mapping = {int(k): int(v)
                        for k, v in info["spectrum"]["suggested_mapping"].items()}
        out = os.path.join(self.tmp.name, "spectrum.3mf")
        result = u1p.export(zf, project, selection, plan, out,
                            spectrum={"recipes": recipes})
        self.assertEqual([], result["checks"]["problems"])

        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            self.assertIn("Metadata/project_settings.config", names)
            cfg = json.loads(z.read("Metadata/project_settings.config").decode("utf-8"))
            # len(filament_colour) is how the slicer knows how many physical reels
            # the recipes are built from, so it must stay at four.
            self.assertEqual(4, len(cfg["filament_colour"]))
            self.assertEqual(4, len(cfg["filament_type"]))
            self.assertEqual(4, len(cfg["nozzle_diameter"]))
            for key in u1spectrum.BAMBU_ONLY_KEYS:
                self.assertNotIn(key, cfg, "%s is Bambu schema, not Full Spectrum" % key)
            self.assertTrue(cfg["mixed_filament_definitions"])
            self.assertIn("mixed_color_layer_height_a", cfg)
            model = z.read("3D/3dmodel.model").decode("utf-8")
            self.assertIn(u1spectrum.APPLICATION, model)
            for name in names:
                if name.endswith(".config") or name.endswith(".model"):
                    self.assertNotIn("MmPaintingVersion", z.read(name).decode("utf-8"))
            # the paint ids in the written meshes are the ids the config declares
            seen = set()
            for name in names:
                if name.endswith(".model") and name != "3D/3dmodel.model":
                    index = u1p._scan_member_objects(z, name)
                    for oid in index.order:
                        seen |= set(index.objects[oid].leaf_states)
            self.assertTrue(seen)
            self.assertIn(5, seen, "the recipe must be painted somewhere")
            self.assertTrue(all(1 <= s <= 4 + len(recipes) for s in seen))
            custom = [row for row in u1spectrum.definitions(4, recipes)
                      if row.split(",")[2:4] == ["1", "1"]]
            self.assertEqual(len(recipes), len(custom))

    def test_export_refuses_a_recipe_it_cannot_write(self):
        path, zf, project, selection, plan, info = self.analysed("five2.3mf")
        plan.mapping = {int(k): int(v)
                        for k, v in info["spectrum"]["suggested_mapping"].items()}
        out = os.path.join(self.tmp.name, "broken.3mf")
        too_many = [{"a": 1, "b": 2, "percent": 50}] * (u1spectrum.MAX_RECIPES + 1)
        with self.assertRaises(u1.ConvertError):
            u1p.export(zf, project, selection, plan, out,
                       spectrum={"recipes": too_many})
        self.assertFalse(os.path.exists(out))

    def test_direct_export_is_untouched(self):
        # A four-colour plate still exports exactly as before: no mixture settings,
        # no extra filaments, the source colours in order.
        path = os.path.join(self.tmp.name, "four.3mf")
        fixtures.two_plate_project(path)
        with zipfile.ZipFile(path) as zf:
            project = u1p.read_project(zf)
            selection = u1p.select(project, 1, None)
            direct = u1p.plan_for(zf, project, selection, None, None, None, False,
                                  intent="direct")
            self.assertEqual("direct", direct.mode)
            out = os.path.join(self.tmp.name, "direct.3mf")
            result = u1p.export(zf, project, selection, direct, out)
            self.assertEqual([], result["checks"]["problems"])
        with zipfile.ZipFile(out) as z:
            cfg = json.loads(z.read("Metadata/project_settings.config").decode("utf-8"))
            self.assertEqual(4, len(cfg["filament_colour"]))
            self.assertNotIn("mixed_filament_definitions", cfg)
            model = z.read("3D/3dmodel.model").decode("utf-8")
            self.assertIn("Snapmaker Orca", model)
            self.assertNotIn(u1spectrum.APPLICATION, model)


if __name__ == "__main__":
    unittest.main()
