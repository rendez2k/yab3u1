"""The three project targets: Snapmaker, Bambu Studio and PrusaSlicer.

Each export is read back from the archive it wrote.  Nothing is opened in a
slicer: the checks are the ones that can be made offline.
"""

import json
import os
import re
import tempfile
import unittest
import zipfile

import u1convert as u1
import u1colour
import u1project as u1p
import u1spectrum
import u1targets
from tests import fixtures

REELS = [{"slot": 1, "color": "#FFFFFF", "type": "PLA"},
         {"slot": 2, "color": "#000000", "type": "PLA"},
         {"slot": 3, "color": "#FF9500", "type": "PLA"},
         {"slot": 4, "color": "#FF0080", "type": "PLA"}]


class Targets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="u1targets-tests-")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def prepared(self, name="five.3mf", five=True):
        path = os.path.join(self.tmp.name, name)
        fixtures.two_plate_project(path, five_colours=five)
        zf = zipfile.ZipFile(path)
        self.addCleanup(zf.close)
        project = u1p.read_project(zf)
        selection = u1p.select(project, 1, None)
        plan = u1p.plan_for(zf, project, selection,
                            [r["color"] for r in REELS], [r["type"] for r in REELS],
                            None, True, intent="approximate")
        info = u1p.analyse(zf, project, selection, plan)
        return zf, project, selection, plan, info

    def export(self, target, drop_recipes=False, name=None, five=True, objects=None):
        zf, project, selection, plan, info = self.prepared(
            name or f"{target}.3mf", five)
        if objects:
            selection = u1p.select(project, 1, objects)
            plan = u1p.plan_for(zf, project, selection,
                                [r["color"] for r in REELS],
                                [r["type"] for r in REELS], None, True,
                                intent="approximate")
            info = u1p.analyse(zf, project, selection, plan)
        recipes = info["spectrum"]["recipes"]
        suggested = info["spectrum"]["suggested_mapping"]
        if drop_recipes:
            recipes = []
            suggested = u1colour.suggest_mapping(info["source_colors"],
                                                 plan.colors())
        plan.mapping = {int(k): int(v) for k, v in suggested.items()}
        suffix = "-plain" if drop_recipes else ""
        out = os.path.join(self.tmp.name, f"out-{target}{suffix}.3mf")
        result = u1p.export(zf, project, selection, plan, out, target=target,
                            spectrum={"recipes": recipes})
        return out, result, recipes

    def test_unknown_target_is_refused(self):
        with self.assertRaises(u1targets.TargetError):
            u1targets.normalise("cura")

    def test_bambu_project_carries_the_palette_and_no_u1_machine(self):
        out, result, recipes = self.export("bambu")
        self.assertEqual([], result["checks"]["problems"])
        with zipfile.ZipFile(out) as z:
            cfg = json.loads(z.read("Metadata/project_settings.config").decode("utf-8"))
            model = z.read("3D/3dmodel.model").decode("utf-8")
        total = 4 + len(recipes)
        self.assertEqual(total, len(cfg["filament_colour"]))
        self.assertEqual(["0"] * 4 + ["1"] * len(recipes), cfg["filament_is_mixed"])
        self.assertEqual("3,4", cfg["filament_mixed_components"][4])
        self.assertEqual("0.5,0.5", cfg["filament_mixed_sublayer_ratios"][4])
        self.assertEqual(total, len(cfg["filament_multi_colour"]))
        # A logical colour is not a nozzle: Bambu Studio's own GUI check rejects
        # a multi-entry nozzle list with no extruder type.
        self.assertNotIn("nozzle_diameter", cfg)
        for key in u1targets.MACHINE_KEYS:
            self.assertNotIn(key, cfg, "%s must not reach a foreign target" % key)
        self.assertIn(u1targets.APPLICATION["bambu"], model)
        self.assertNotIn("Snapmaker", json.dumps(cfg))

    def test_prusa_project_is_inlined_with_its_own_schema(self):
        # The PrusaSlicer writer describes volumes by triangle range, so it takes
        # the one-volume object on this plate (object 11) and refuses the
        # three-volume one; see the refusal test below.
        out, result, recipes = self.export("prusa", objects=["11"])
        self.assertEqual([], result["checks"]["problems"])
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            model = z.read("3D/3dmodel.model").decode("utf-8")
            spectrum = json.loads(
                z.read(u1targets.PRUSA_SPECTRUM_JSON).decode("utf-8"))
            struct = z.read(u1targets.PRUSA_MODEL_CONFIG).decode("utf-8")
            members = [n for n in names if n.startswith("3D/Objects/")]
        self.assertEqual([], members, "PrusaSlicer reads parts from the model file")
        self.assertIn(u1targets.APPLICATION["prusa"], model)
        self.assertIn("xmlns:slic3rpe=", model)
        self.assertNotIn("requiredextensions", model)
        self.assertNotIn("p:path=", model)
        self.assertNotIn("p:UUID=", model)
        self.assertNotIn("MmPaintingVersion", model)
        self.assertIn("slic3rpe:mmu_segmentation", model)
        self.assertNotIn("paint_color", model)
        self.assertEqual(1, len(re.findall(r"<item ", model)),
                         "the one selected object is placed")
        self.assertEqual(4, len(spectrum["physical_extruders"]))
        for entry in spectrum["physical_extruders"]:
            self.assertIn("color", entry)
            self.assertNotIn("colour", entry)
            self.assertEqual("physical", entry["kind"])
        self.assertEqual([5], [v["id"] for v in spectrum["virtual_extruders"]])
        self.assertEqual("fullspectrum", spectrum["virtual_extruders"][0]["kind"])
        ratios = spectrum["virtual_extruders"][0]["components"]
        self.assertEqual([{"extruder": 3, "ratio": 0.5},
                          {"extruder": 4, "ratio": 0.5}], ratios)
        self.assertIn("<config>", struct)
        self.assertIn("<volume", struct)

    def test_prusa_refuses_a_multi_volume_object(self):
        with self.assertRaises(u1.ConvertError) as caught:
            self.export("prusa", name="multi.3mf")
        self.assertIn("triangle range", str(caught.exception))

    def test_a_portable_prusa_export_reopens_with_its_own_palette(self):
        """The archive we write must read back as the colours it wrote.

        A portable Prusa project has no Slic3r_PE.config, so a reader that only
        looks there reopens it as white defaults: the palette has to come from the
        Full Spectrum description, and every paint state has to resolve.
        """
        out, result, recipes = self.export("prusa", objects=["11"])
        self.assertEqual([], result["checks"]["problems"])
        with zipfile.ZipFile(out) as z:
            self.assertNotIn("Metadata/Slic3r_PE.config", z.namelist())
            spectrum = json.loads(
                z.read(u1targets.PRUSA_SPECTRUM_JSON).decode("utf-8"))
            reread = u1p.read_project(z)
        self.assertEqual("prusa", reread.kind)
        self.assertEqual("Prusa_Slicer_full_spectrum.json", reread.palette_source)
        self.assertEqual(4 + len(recipes), len(reread.colors))
        for entry in spectrum["physical_extruders"]:
            self.assertEqual(u1.norm_color(entry["color"]),
                             reread.color_for(entry["id"]))
        for entry in spectrum["virtual_extruders"]:
            self.assertEqual(u1.norm_color(entry["color"]),
                             reread.color_for(entry["id"]),
                             "a paint state naming a recipe resolves to its shade")

    def test_a_portable_prusa_export_is_refused_without_its_palette(self):
        """Drop the Full Spectrum description and there is nothing to read."""
        out, _result, _recipes = self.export("prusa", objects=["11"])
        stripped = out + ".stripped.3mf"
        with zipfile.ZipFile(out) as z, zipfile.ZipFile(stripped, "w") as w:
            for name in z.namelist():
                if name != u1targets.PRUSA_SPECTRUM_JSON:
                    w.writestr(name, z.read(name))
        with self.assertRaises(u1.ConvertError) as caught:
            with zipfile.ZipFile(stripped) as z:
                u1p.read_project(z)
        self.assertIn("no palette to read", str(caught.exception))

    def test_a_foreign_target_with_no_recipes_writes_no_mixture_fields(self):
        out, _result, _recipes = self.export("bambu", drop_recipes=True,
                                             name="four.3mf", five=False)
        with zipfile.ZipFile(out) as z:
            cfg = json.loads(z.read("Metadata/project_settings.config").decode("utf-8"))
        self.assertEqual(4, len(cfg["filament_colour"]))
        for key in ("filament_is_mixed", "filament_multi_colour",
                    "filament_mixed_components"):
            self.assertNotIn(key, cfg)

    def test_validate_reports_leaked_machine_settings(self):
        cfg = u1targets.config("bambu", [r["color"] for r in REELS],
                               [r["type"] for r in REELS], [])
        self.assertEqual([], u1targets.validate("bambu", cfg, 4, []))
        cfg["machine_start_gcode"] = ["G28"]
        cfg["print_settings_id"] = "0.20mm Standard @Snapmaker U1"
        problems = u1targets.validate("bambu", cfg, 4, [])
        self.assertTrue(any("leaked" in p for p in problems))
        self.assertTrue(any("G-code" in p for p in problems))

    def test_export_through_the_cli_wrapper(self):
        path = os.path.join(self.tmp.name, "cli.3mf")
        fixtures.two_plate_project(path, five_colours=True)
        out = os.path.join(self.tmp.name, "cli-prusa.3mf")
        u1.convert_project(path, out, plate=1, objects=["11"],
                           slots=[r["color"] for r in REELS],
                           slot_types=[r["type"] for r in REELS],
                           approximate=True, mode="spectrum", target="prusa",
                           verify=False)
        with zipfile.ZipFile(out) as z:
            self.assertIn(u1targets.PRUSA_SPECTRUM_JSON, z.namelist())


if __name__ == "__main__":
    unittest.main()
