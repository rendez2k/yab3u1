"""The preview soup: the transform convention, and the two buffer invariants.

The renderer is fed three floats per vertex for both positions and colours, and the
positions must be in world space using the *same* matrix convention as the export
(`u1convert.apply`: row-major storage, point as a column vector). A transposed
rotation looks plausible on a symmetric part and is wrong on every real one, so it
is checked directly.
"""

import base64
import os
import struct
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import u1convert as u1                                             # noqa: E402
import u1preview                                                   # noqa: E402
import u1project as u1p                                            # noqa: E402
from tests import fixtures                                         # noqa: E402


def unpack(text, floats):
    return struct.unpack("<%df" % floats, base64.b64decode(text))


class Transform(unittest.TestCase):
    """A 90 degree Z turn plus a translation must land where u1.apply puts it."""

    ROTATION = [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0], [10, 20, 30, 1]]

    def test_a_quarter_turn_is_not_transposed(self):
        # +90 degrees about Z, then the translation the matrix carries.
        self.assertEqual((10.0, 21.0, 30.0),
                         tuple(round(v, 6) for v in u1.apply(self.ROTATION, (1, 0, 0))))
        self.assertEqual((10.0, 20.0, 30.0),
                         tuple(round(v, 6) for v in u1.apply(self.ROTATION, (0, 0, 0))))

    def test_soup_positions_follow_the_same_convention(self):
        with tempfile.TemporaryDirectory(prefix="u1preview-tests-") as tmp:
            path = os.path.join(tmp, "single.3mf")
            fixtures.single_object_project(path)
            with zipfile.ZipFile(path) as zf:
                project = u1p.read_project(zf)
                selection = u1p.select(project, None, None)
                # A transform that turns the mesh and moves it: identity would pass
                # even with a transposed matrix.
                rotation = [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0],
                            [10, 20, 30, 1]]
                member, oid, _matrix, _index = u1p.instance_chain(
                    zf, project, selection.as_ids()[0],
                    u1.transform_3mf_text(rotation))[0]
                positions = []
                states = []
                u1preview._facet_states(zf, member, {str(oid)}, rotation, 1, 1,
                                        {"seen": 0}, positions, states,
                                        {"triangles": 0, "subdivided": 0,
                                         "unknown": 0, "truncated": False})
                self.assertTrue(positions)
                # The fixture's first vertex is (0,0,0) -> the translation alone.
                self.assertEqual((10.0, 20.0, 30.0),
                                 tuple(round(v, 6) for v in positions[:3]))
                # (10,0,0) must become (10, 30, 30): +90 degrees about Z, then moved.
                found = [positions[i:i + 3] for i in range(0, len(positions), 3)]
                self.assertIn((10.0, 30.0, 30.0),
                              [tuple(round(v, 6) for v in point) for point in found])
                self.assertNotIn((0.0, 10.0, 30.0),
                                 [tuple(round(v, 6) for v in point) for point in found],
                                 "the transposed rotation would put the vertex here")


class Buffers(unittest.TestCase):
    def test_a_capped_preview_samples_across_the_whole_model(self):
        """A cap must spread the sample, not keep the model's first corner."""
        with tempfile.TemporaryDirectory(prefix="u1preview-tests-") as tmp:
            path = os.path.join(tmp, "wide.3mf")
            fixtures.wide_quad_project(path, quads=4)
            with zipfile.ZipFile(path) as zf:
                project = u1p.read_project(zf)
                selection = u1p.select(project, 1, None)
                soup = u1preview.soup(zf, project, selection,
                                      {1: "#FFFFFF", 2: "#000000"}, None, limit=2)
        self.assertEqual(8, soup["total"])
        self.assertEqual(4, soup["stride"])
        self.assertTrue(soup["sampled"])
        positions = unpack(soup["positions"], soup["floats"])
        widest = max(positions[i] for i in range(0, len(positions), 3))
        # Truncating the first two triangles would stop at x = 20; sampling keeps
        # one tile from the far end of the row as well.
        self.assertGreater(widest, 40.0)

    def test_the_fixture_placement_is_a_rotation_and_a_translation(self):
        """The independent anchor for both languages.

        ``rotated_preview_project`` places its mesh with a +90 degree Z turn and a
        translation, a placement whose transpose is a *different* answer.  If the
        Python and browser previews agree but both transpose, a parity check alone
        still passes; these numbers come from the matrix by hand.
        """
        with tempfile.TemporaryDirectory(prefix="u1preview-tests-") as tmp:
            path = os.path.join(tmp, "rotated.3mf")
            fixtures.rotated_preview_project(path)
            with zipfile.ZipFile(path) as zf:
                project = u1p.read_project(zf)
                selection = u1p.select(project, 1, None)
                soup = u1preview.soup(zf, project, selection,
                                      {1: "#FFFFFF", 2: "#000000"}, {1: 1, 2: 2})
        positions = unpack(soup["positions"], soup["floats"])
        first = tuple(round(value, 6) for value in positions[:9])
        self.assertEqual((100.0, 100.0, 30.0,
                          100.0, 110.0, 30.0,
                          90.0, 110.0, 30.0), first)
        # The transposed reading of the same matrix would answer these instead.
        self.assertNotEqual((100.0, 100.0, 30.0,
                             90.0, 100.0, 30.0,
                             90.0, 90.0, 30.0), first)

    def test_colour_buffer_matches_the_position_buffer(self):
        with tempfile.TemporaryDirectory(prefix="u1preview-tests-") as tmp:
            path = os.path.join(tmp, "four.3mf")
            fixtures.two_plate_project(path)
            with zipfile.ZipFile(path) as zf:
                project = u1p.read_project(zf)
                selection = u1p.select(project, 1, None)
                soup = u1preview.soup(zf, project, selection,
                                      {1: "#FFFFFF", 2: "#000000", 3: "#FF9500",
                                       4: "#FF0080"}, {3: 3, 4: 4})
        positions = unpack(soup["positions"], soup["floats"])
        colours = unpack(soup["colors"], soup["floats"])
        self.assertEqual(len(positions), len(colours))
        self.assertEqual(soup["triangles"] * 9, len(positions))
        self.assertEqual(soup["triangles"] * 9, len(colours))
        # Three vertices of a facet share the facet's colour.
        for facet in range(soup["triangles"]):
            base = facet * 9
            self.assertEqual(colours[base:base + 3], colours[base + 3:base + 6])
            self.assertEqual(colours[base:base + 3], colours[base + 6:base + 9])

    def test_an_unknown_paint_value_is_marked_not_guessed(self):
        with tempfile.TemporaryDirectory(prefix="u1preview-tests-") as tmp:
            path = os.path.join(tmp, "bogus.3mf")
            fixtures.bogus_paint_project(path)
            with zipfile.ZipFile(path) as zf:
                project = u1p.read_project(zf)
                selection = u1p.select(project, 1, None)
                soup = u1preview.soup(zf, project, selection, {1: "#FFFFFF"})
        self.assertGreaterEqual(soup["unknown_paint"], 1)
        colours = unpack(soup["colors"], soup["floats"])
        # The warning colour, so the page can say the facet was not understood.
        self.assertAlmostEqual(0.69, colours[0], places=2)


if __name__ == "__main__":
    unittest.main()
