"""The codec against an independent reader of the upstream grammar."""

import os
import unittest

import u1paint
from tests import upstream_paint as oracle

# Whole-triangle values from the user's five-colour files: hex -> material.
WHOLE = {"4": 1, "8": 2, "0C": 3, "1C": 4, "2C": 5}

# Hard-coded upstream fixtures.  Constructed by hand from the grammar
# (sides, special side, children in order, leaf state as an escaped field), not
# produced by this codec:
#   leaf material 4            -> 00 11 0001               -> 1C
#   leaf material 18           -> 00 11 1111 0000          -> F0C
#   sides=1 special=2          -> 10 01 ...
UPSTREAM_FIXTURES = {
    "4": (("leaf",), [1]),
    "8": (("leaf",), [2]),
    "0C": (("leaf",), [3]),
    "1C": (("leaf",), [4]),
    "2C": (("leaf",), [5]),
    "1C2C1": (("split", 1, 0, (("leaf",), ("leaf",))), [5, 4]),
    "0C2C2C2": (("split", 2, 0, (("leaf",), ("leaf",), ("leaf",))), [5, 5, 3]),
    "1C2C1C11C6": (("split", 2, 1, (("leaf",),
                                     ("split", 1, 0, (("leaf",), ("leaf",))),
                                     ("leaf",))), [4, 4, 5, 4]),
}

# Real sub-divided values from "They live alien_5 colors.3mf" (PrusaSlicer 2.9.6),
# including the value the root used to demonstrate the corruption.
REAL_VALUES = [
    "42C2CA442C4423",          # the pair the root compared
    "1C2C2CA",                 # special side 2, no leaf material 2
    "2C2C0C90C2",
    "2C2C2C2C4A2C3",
    "1C2C1C11C6",
    "044244A",                 # support painting form
    "0000045AA",
]


class Grammar(unittest.TestCase):
    def test_codec_reads_the_upstream_fixtures(self):
        for value, (topology, leaves) in UPSTREAM_FIXTURES.items():
            self.assertEqual(topology, oracle.topology(value), value)
            self.assertEqual(leaves, oracle.leaves(value), value)

    def test_codec_and_oracle_agree(self):
        for value in list(UPSTREAM_FIXTURES) + REAL_VALUES:
            node = u1paint.decode(value)
            self.assertEqual(oracle.topology(value), u1paint.topology(node), value)
            self.assertEqual(oracle.leaves(value), u1paint.walk_states(node), value)
            self.assertEqual(value, u1paint.encode(node), value)

    def test_split_metadata_is_not_a_material(self):
        for value in REAL_VALUES:
            node = u1paint.decode(value)
            self.assertNotIn(None, u1paint.special_sides(node))
            if node[0] == "split":
                # the field the old codec remapped is what this one preserves
                self.assertEqual(oracle.topology(value)[1:3],
                                 (node[1], node[2]), value)


class Regression(unittest.TestCase):
    """The bug the root caught: a split node's second field was remapped."""

    SOURCE = "42C2CA442C4423"
    BROKEN = "41C1C1E441C4423"      # what the buggy build wrote
    MAPPING = {1: 1, 2: 4, 3: 1, 4: 2, 5: 4}   # the alien approximation

    def test_the_old_output_is_invalid_under_the_upstream_grammar(self):
        with self.assertRaises(oracle.Invalid):
            oracle.parse(self.BROKEN)

    def test_the_codec_preserves_topology_and_maps_materials(self):
        fixed = u1paint.remap_text(self.SOURCE, self.MAPPING)
        self.assertEqual([], oracle.compare_values(self.SOURCE, fixed, self.MAPPING))
        self.assertEqual(oracle.topology(self.SOURCE), oracle.topology(fixed))
        self.assertEqual([1, 1, 5, 1, 1, 5, 5, 1], oracle.leaves(self.SOURCE))
        self.assertEqual([1, 1, 4, 1, 1, 4, 4, 1], oracle.leaves(fixed))
        self.assertEqual(oracle.mapped_leaves(self.SOURCE, self.MAPPING),
                         oracle.leaves(fixed))

    def test_a_material_equal_to_a_special_side_leaves_the_bytes_alone(self):
        # "1C2C2CA" has special side 2 and no leaf material 2, so remapping
        # material 2 must not touch it at all
        self.assertEqual("1C2C2CA", u1paint.remap_text("1C2C2CA", {2: 4}))

    def test_special_sides_survive_a_full_remap(self):
        for value in REAL_VALUES:
            node = u1paint.decode(value)
            if node[0] == "leaf":
                continue
            out = u1paint.remap_text(value, self.MAPPING)
            self.assertEqual(u1paint.topology(node),
                             u1paint.topology(u1paint.decode(out)), value)
            self.assertEqual([], oracle.compare_values(value, out, self.MAPPING), value)


class RealCorpus(unittest.TestCase):
    """Every sub-divided value the user's PrusaSlicer file carries, when present."""

    CORPUS = os.path.join(os.environ.get("TEMP", ""), "alien-split-strings.txt")

    @unittest.skipUnless(os.path.isfile(CORPUS), "extracted corpus not present")
    def test_every_real_value_round_trips_under_both_readers(self):
        with open(self.CORPUS, encoding="utf-8") as fh:
            paint, _, support = fh.read().partition("--- supports ---")
        values = [v.strip() for v in (paint + support).split("\n") if v.strip()]
        self.assertGreater(len(values), 600)
        for value in values:
            self.assertEqual(value, u1paint.encode(u1paint.decode(value)), value)
            self.assertEqual(oracle.leaves(value),
                             u1paint.walk_states(u1paint.decode(value)), value)
            self.assertEqual(oracle.topology(value),
                             u1paint.topology(u1paint.decode(value)), value)

    @unittest.skipUnless(os.path.isfile(CORPUS), "extracted corpus not present")
    def test_remapping_painted_values_never_breaks_the_upstream_grammar(self):
        mapping = {1: 1, 2: 4, 3: 1, 4: 2, 5: 4}
        with open(self.CORPUS, encoding="utf-8") as fh:
            paint, _, support = fh.read().partition("--- supports ---")
        values = [v.strip() for v in paint.split("\n") if v.strip()]
        self.assertGreater(len(values), 100)
        for value in values:
            out = u1paint.remap_text(value, mapping)
            self.assertEqual([], oracle.compare_values(value, out, mapping), value)


if __name__ == "__main__":
    unittest.main()
