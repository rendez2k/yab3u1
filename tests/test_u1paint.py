"""The painted-triangle codec, against the values real files carry."""

import unittest

import u1paint

# Whole-triangle values from the user's five-colour files, and the extruder each
# one names (Prusa writes these; Bambu/Orca read the same bytes as paint_color).
WHOLE_TRIANGLE = {"4": 1, "8": 2, "0C": 3, "1C": 4, "2C": 5, "3C": 6}

# Sub-divided values taken from "They live alien_5 colors.3mf" (PrusaSlicer 2.9.6).
SUB_DIVIDED = ["1C2C1", "0C2C2C2", "1C2C1C11C6", "42C41443", "2C2C2C42C2C32C3",
               "0000045AA", "044244A", "000000045AA2"]


class LeafStates(unittest.TestCase):
    def test_whole_triangles_round_trip(self):
        for text, state in WHOLE_TRIANGLE.items():
            node = u1paint.decode(text)
            self.assertEqual(("leaf", state), node, text)
            self.assertEqual(text, u1paint.encode(node))
            self.assertEqual(state, u1paint.decode_leaf_state(text))

    def test_every_state_the_format_holds_round_trips(self):
        for state in range(0, 34):
            text = u1paint.encode(("leaf", state))
            self.assertEqual(("leaf", state), u1paint.decode(text), state)
            if state < 18:
                # the legacy helper (kept for the single-object path) reports 0 for
                # the two-nibble form rather than guessing a material
                self.assertEqual(state, u1paint.decode_leaf_state(text))
                self.assertEqual(text, u1paint.encode_leaf_state(state))
            else:
                self.assertEqual(0, u1paint.decode_leaf_state(text))

    def test_state_beyond_the_format_is_refused(self):
        with self.assertRaises(u1paint.PaintError):
            u1paint.encode(("leaf", 34))


class SubDivided(unittest.TestCase):
    def test_real_values_round_trip_exactly(self):
        for text in SUB_DIVIDED:
            node = u1paint.decode(text)
            self.assertEqual(text, u1paint.encode(node), text)
            self.assertTrue(u1paint.is_split(text), text)

    def test_states_are_recovered_from_the_whole_tree(self):
        # only leaves are materials: the split node's second field is its special
        # side, which is why {0, 4, 5} is no longer the answer here
        states = set(u1paint.walk_states(u1paint.decode("1C2C1")))
        self.assertEqual({4, 5}, states)
        self.assertEqual([5, 4], sorted(u1paint.leaf_states(u1paint.decode("1C2C1")),
                                        reverse=True))

    def test_split_node_keeps_its_metadata(self):
        node = u1paint.decode("1C2C1C11C6")
        self.assertEqual("split", node[0])
        self.assertEqual(2, node[1])
        self.assertEqual(1, node[2])              # the special side, untouched
        self.assertEqual(3, len(node[3]))
        self.assertEqual(("split", 2, 1,
                          (("leaf",), ("split", 1, 0, (("leaf",), ("leaf",))),
                           ("leaf",))), u1paint.topology(node))


class Refusals(unittest.TestCase):
    def test_values_that_cannot_be_explained_are_refused(self):
        for text in ("", "ZZ", "2", "4444444444444444444444444444444444"):
            with self.assertRaises(u1paint.PaintError, msg=text):
                u1paint.decode(text)

    def test_truncated_stream_is_refused(self):
        with self.assertRaises(u1paint.PaintError):
            u1paint.decode("C")


class Remapping(unittest.TestCase):
    def test_identity_keeps_the_bytes(self):
        self.assertEqual("1C2C1", u1paint.remap_text("1C2C1", {4: 4, 5: 5}))

    def test_whole_and_sub_divided_states_are_rewritten(self):
        self.assertEqual("80C1", u1paint.remap_text("1C2C1", {4: 2, 5: 3}))
        self.assertEqual("4", u1paint.remap_text("8", {2: 1}))

    def test_state_zero_is_never_remapped(self):
        self.assertEqual("4", u1paint.remap_text("4", {0: 3}))

    def test_a_broken_value_is_refused_rather_than_guessed(self):
        with self.assertRaises(u1paint.PaintError):
            u1paint.remap_text("4444444444444444444444444444444444", {1: 2})

    def test_needed_states_lists_what_a_value_uses(self):
        self.assertEqual({4, 5}, u1paint.needed_states("1C2C1"))
        self.assertEqual(set(), u1paint.needed_states("nonsense"))


if __name__ == "__main__":
    unittest.main()
