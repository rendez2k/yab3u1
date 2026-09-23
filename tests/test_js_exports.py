"""Read the projects the *browser* wrote, with the Python side.

The Node test in `web/tests/project.test.mjs` exports the three targets and leaves
the archives in `web/tests/`.  This test opens them with the Python readers and
checks the invariants that matter, so the two implementations are not just
separately self-consistent but agree on the file on disk.  It skips (rather than
fails) when Node is not available.
"""

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import unittest
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import u1paint                                                    # noqa: E402
import u1project as u1p                                           # noqa: E402
import u1spectrum                                                 # noqa: E402
import u1targets                                                  # noqa: E402
import u1convert as u1                                            # noqa: E402

WEB = os.path.join(HERE, "web", "tests")
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "node is not installed, so the browser exporter cannot run")
class BrowserExports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run([sys.executable, "tests/export_js_fixtures.py"], cwd=HERE,
                       check=True, capture_output=True)
        subprocess.run([NODE, "web/tests/project.test.mjs"], cwd=HERE,
                       check=True, capture_output=True)
        cls.outputs = {os.path.basename(path).replace("out-", "").replace(".3mf", ""): path
                       for path in glob.glob(os.path.join(WEB, "out-*.3mf"))}

    def test_all_three_targets_were_written(self):
        self.assertEqual({"snapmaker", "bambu", "prusa"}, set(self.outputs))

    def test_snapmaker_export_is_a_u1_project(self):
        with zipfile.ZipFile(self.outputs["snapmaker"]) as zf:
            project = u1p.read_project(zf)
            self.assertEqual("bambu", project.kind)
            cfg = json.loads(zf.read("Metadata/project_settings.config").decode("utf-8"))
            self.assertTrue(cfg.get("printer_settings_id"))
            self.assertEqual(4, len(cfg["filament_colour"]))
            self.assertTrue(cfg.get("mixed_filament_definitions"))
            rows = cfg["mixed_filament_definitions"].split(";")
            custom = [row for row in rows if row.split(",")[2:4] == ["1", "1"]]
            self.assertTrue(custom)
            self.assertEqual([], u1spectrum.validate(cfg, 4, [
                {"a": int(row.split(",")[0]), "b": int(row.split(",")[1]),
                 "percent": int(row.split(",")[4])} for row in custom]))
            # The meshes are the source's own, with the paint ids remapped.
            states = set()
            for name in zf.namelist():
                if name.endswith(".model") and name != u1.MODEL_FILE:
                    index = u1p._scan_member_objects(zf, name)
                    for oid in index.order:
                        states |= set(index.objects[oid].leaf_states)
            self.assertTrue(states)
            self.assertTrue(all(1 <= state <= 4 + len(custom) for state in states))

    def test_bambu_export_is_portable_and_complete(self):
        with zipfile.ZipFile(self.outputs["bambu"]) as zf:
            cfg = json.loads(zf.read("Metadata/project_settings.config").decode("utf-8"))
        for key in u1targets.MACHINE_KEYS:
            self.assertNotIn(key, cfg)
        self.assertEqual(len(cfg["filament_colour"]), len(cfg["filament_is_mixed"]))
        self.assertEqual("1", cfg["filament_is_mixed"][-1])
        self.assertEqual(4, cfg["filament_is_mixed"].count("0"))

    def test_prusa_export_uses_prusa_spellings(self):
        with zipfile.ZipFile(self.outputs["prusa"]) as zf:
            model = zf.read(u1.MODEL_FILE).decode("utf-8")
            names = zf.namelist()
            spectrum = json.loads(zf.read(u1targets.PRUSA_SPECTRUM_JSON).decode("utf-8"))
        self.assertIn("slic3rpe:mmu_segmentation=", model)
        self.assertNotIn("paint_color=", model)
        self.assertNotIn("p:path=", model)
        self.assertNotIn("requiredextensions", model)
        self.assertFalse([name for name in names if name.startswith("3D/Objects/")])
        self.assertEqual(4, len(spectrum["physical_extruders"]))
        self.assertTrue(spectrum["virtual_extruders"])
        # The paint must still be a bitstream this tool reads, and inside range.
        for value in re.findall(r'mmu_segmentation="([0-9A-Fa-f]+)"', model):
            states = u1paint.walk_states(u1paint.decode(value))
            self.assertTrue(all(state <= u1paint.SUPPORTED_STATE_MAX for state in states))


if __name__ == "__main__":
    unittest.main()
