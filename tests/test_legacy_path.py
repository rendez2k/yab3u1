"""The single-object path must keep working exactly as it did."""

import os
import tempfile
import unittest
import zipfile

import u1convert as u1
import u1project as u1p
from tests import fixtures


class Dispatch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="u1legacy-tests-")
        self.addCleanup(self.tmp.cleanup)

    def test_single_object_projects_stay_on_the_legacy_path(self):
        path = fixtures.single_object_project(os.path.join(self.tmp.name, "solo.3mf"))
        with zipfile.ZipFile(path) as zf:
            project = u1p.read_project(zf)
            self.assertIsNone(u1p.legacy_path_problem(zf, project))

    def test_legacy_conversion_still_renames_and_remaps_paint(self):
        path = fixtures.single_object_project(os.path.join(self.tmp.name, "solo.3mf"))
        out = os.path.join(self.tmp.name, "solo-U1.3mf")
        u1.convert(path, out, None, None, u1.DEFAULT_MACHINE, u1.DEFAULT_PROCESS,
                   [], [], True)
        with zipfile.ZipFile(out) as zout:
            names = zout.namelist()
            members = [n for n in names if n.endswith(".model") and n != u1.MODEL_FILE]
            self.assertTrue(members)
            blob = "".join(zout.read(n).decode("utf-8") for n in members)
            # the object's own filament takes slot 1, so source states 4 and 5
            # become slots 2 and 3
            self.assertIn('paint_color="8"', blob)
            self.assertIn('paint_color="0C"', blob)
            self.assertNotIn("mmu_segmentation", blob)
            settings = zout.read(u1.SRC_BBL_PROJECT).decode("utf-8")
            self.assertIn("Snapmaker U1", settings)

    def test_legacy_colour_override_still_applies(self):
        path = fixtures.single_object_project(os.path.join(self.tmp.name, "solo2.3mf"))
        out = os.path.join(self.tmp.name, "solo2-U1.3mf")
        u1.convert(path, out, None, None, u1.DEFAULT_MACHINE, u1.DEFAULT_PROCESS,
                   ["#112233", "#445566"], [], True)
        with zipfile.ZipFile(out) as zout:
            settings = zout.read(u1.SRC_BBL_PROJECT).decode("utf-8")
        self.assertIn("#112233", settings)
        self.assertIn("#445566", settings)

    def test_multi_object_projects_are_handed_to_the_project_path(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "multi.3mf"))
        out = os.path.join(self.tmp.name, "multi-U1.3mf")
        u1.convert(path, out, None, None, u1.DEFAULT_MACHINE, u1.DEFAULT_PROCESS,
                   [], [], True, plate=1, object_ids=["10"])
        with zipfile.ZipFile(out) as zout:
            doc = zout.read(u1.MODEL_FILE).decode("utf-8")
        self.assertEqual(1, doc.count("<item "))

    def test_a_five_colour_model_asks_before_substituting(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "five.3mf"),
                                          five_colours=True)
        out = os.path.join(self.tmp.name, "five-U1.3mf")
        with self.assertRaises(u1.ConvertError) as ctx:
            u1.convert(path, out, None, None, u1.DEFAULT_MACHINE, u1.DEFAULT_PROCESS,
                       [], [], True)
        self.assertIn("5 source colours", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
