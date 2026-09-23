"""Colour parsing, matching and the honest wording that goes with it."""

import unittest

import u1colour

PRINTER_REELS = ["#FFFFFF", "#000000", "#3D9140", "#FF9500"]


class Parsing(unittest.TestCase):
    def test_spellings_of_a_colour(self):
        self.assertEqual("#FF8000", u1colour.norm("ff8000"))
        self.assertEqual("#FF8000", u1colour.norm("  #ff8000 "))
        self.assertEqual("#FF8000", u1colour.norm("#FF8000FF"))    # alpha byte
        self.assertEqual("", u1colour.norm("orange"))
        self.assertEqual("", u1colour.norm("#FF80"))
        self.assertEqual("", u1colour.norm(""))

    def test_lab_endpoints(self):
        white = u1colour.to_lab("#FFFFFF")
        black = u1colour.to_lab("#000000")
        self.assertAlmostEqual(100.0, white[0], places=2)
        self.assertAlmostEqual(0.0, black[0], places=2)
        self.assertIsNone(u1colour.to_lab("not a colour"))


class Distance(unittest.TestCase):
    def test_identical_colours_are_zero(self):
        self.assertEqual(0.0, u1colour.distance("#123456", "#123456"))

    def test_hue_matters_more_than_lightness(self):
        # A brown filament belongs on orange, not on white, even though white is
        # closer in lightness.
        to_orange = u1colour.distance("#BE8969", "#FF9500")
        to_white = u1colour.distance("#BE8969", "#FFFFFF")
        self.assertLess(to_orange, to_white)

    def test_unknown_colour_is_infinite(self):
        self.assertEqual(float("inf"), u1colour.distance("wibble", "#FFFFFF"))

    def test_verdicts_get_more_cautious_with_distance(self):
        self.assertEqual("same", u1colour.comparison(
            {1: "#FFFFFF"}, {1: 1}, ["#FFFFFF"])[0]["verdict"])
        self.assertEqual("approximate", u1colour.verdict(60))
        self.assertEqual("fair", u1colour.verdict(20))
        self.assertEqual("close", u1colour.verdict(3))


class Suggestions(unittest.TestCase):
    def test_nearest_returns_the_option_index(self):
        index, delta = u1colour.nearest("#010101", PRINTER_REELS)
        self.assertEqual(1, index)
        self.assertLess(delta, 5)

    def test_suggested_mapping_uses_the_loaded_reels(self):
        mapping = u1colour.suggest_mapping(
            {1: "#BE8969", 2: "#6F5034", 3: "#FFFFFF", 4: "#000000", 5: "#E4BD68"},
            PRINTER_REELS)
        self.assertEqual(1, mapping[3])          # white stays white
        self.assertEqual(2, mapping[4])          # black stays black
        self.assertEqual(4, mapping[1])          # brown -> orange, not white
        self.assertEqual(4, mapping[5])          # tan -> orange

    def test_comparison_reports_original_and_result(self):
        rows = u1colour.comparison({1: "#BE8969"}, {1: 4}, PRINTER_REELS)
        self.assertEqual("#BE8969", rows[0]["original"])
        self.assertEqual("#FF9500", rows[0]["result"])
        self.assertEqual(4, rows[0]["slot"])
        self.assertEqual("approximate", rows[0]["verdict"])

    def test_missing_colour_has_no_result(self):
        rows = u1colour.comparison({9: "#ABCDEF"}, {}, PRINTER_REELS)
        self.assertIsNone(rows[0]["slot"])
        self.assertEqual("", rows[0]["result"])
        self.assertEqual("unknown", rows[0]["verdict"])


if __name__ == "__main__":
    unittest.main()
