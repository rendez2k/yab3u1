"""Multi-object projects: structure, selection, assessment and export."""

import os
import tempfile
import unittest
import zipfile

import u1colour
import u1convert as u1
import u1project as u1p
from tests import fixtures


class ProjectCase(unittest.TestCase):
    """Shares one synthetic project between tests, and rewrites it on demand."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="u1project-tests-")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def project_file(self, name="two-plate.3mf", five_colours=False):
        path = os.path.join(self.tmp.name, name)
        fixtures.two_plate_project(path, five_colours=five_colours)
        return path

    # -- helpers -----------------------------------------------------------------
    def load(self, path):
        zf = zipfile.ZipFile(path)
        self.addCleanup(zf.close)
        return zf, u1p.read_project(zf)

    def plan_for(self, zf, project, selection, mode="direct", mapping=None,
                 colors=None, types=None):
        plan = u1p.Plan()
        plan.mode = mode
        used = sorted({e for oid in selection.as_ids()
                       for e in u1p.object_used_extruders(zf, project, oid)})
        if mode == "direct":
            plan.mapping = {e: i + 1 for i, e in enumerate(used)}
            plan.filaments = [
                {"slot": i + 1, "color": project.color_for(e), "type": project.type_for(e)}
                for i, e in enumerate(used)]
            plan.filaments += [{"slot": j + 1, "color": "#FF9500", "type": "PLA"}
                               for j in range(len(used), 4)]
        else:
            colors = colors or [f["color"] for f in u1p.DEFAULT_FILAMENTS]
            types = types or [f["type"] for f in u1p.DEFAULT_FILAMENTS]
            plan.filaments = [{"slot": i + 1, "color": c, "type": t}
                              for i, (c, t) in enumerate(zip(colors, types))]
            plan.mapping = mapping or u1colour.suggest_mapping(
                {e: project.color_for(e) for e in used}, plan.colors())
        return plan

    def export(self, path, selection, plan, name="out.3mf", **kwargs):
        zf, project = self.load(path)
        out = os.path.join(self.tmp.name, name)
        if isinstance(selection, tuple):
            selection = u1p.select(project, selection[0], selection[1])
        elif not isinstance(selection, u1p.Selection):
            selection = u1p.select(project, selection, None)
        result = u1p.export(zf, project, selection, plan, out, **kwargs)
        return zf, project, selection, plan, result, out


class Structure(ProjectCase):
    def test_plates_objects_and_names(self):
        zf, project = self.load(self.project_file())
        self.assertEqual("bambu", project.kind)
        self.assertEqual([1, 2], [p.id for p in project.plates])
        self.assertEqual("Multicolour", project.plates[0].name)
        self.assertEqual(["10", "11"], project.plates[0].object_ids)
        self.assertEqual(["11", "11"], project.plates[1].object_ids)
        self.assertEqual("Alpha", project.object_name_for("10"))
        self.assertEqual("Beta", project.object_name_for("11"))

    def test_palette_is_a_menu_not_the_colours_used(self):
        zf, project = self.load(self.project_file())
        self.assertEqual(6, project.palette_count)
        self.assertEqual(4, len(u1p.object_used_extruders(zf, project, "10")
                               | u1p.object_used_extruders(zf, project, "11")))

    def test_mesh_index_reports_paint_and_unused_objects(self):
        zf, project = self.load(self.project_file())
        index = u1p.mesh_index(zf, project, "3D/Objects/object_shared.model")
        self.assertEqual(["1", "2", "3"], index.order)
        self.assertEqual(2, index.get("1").leaf_states[2])
        self.assertEqual(2, index.get("2").triangles)
        self.assertEqual({}, index.get("2").leaf_states)

    def test_legacy_path_declines_a_multi_object_project(self):
        zf, project = self.load(self.project_file())
        self.assertTrue(u1p.legacy_path_problem(zf, project))


class Selection(ProjectCase):
    def test_defaults_to_the_first_plate_and_all_its_objects(self):
        zf, project = self.load(self.project_file())
        selection = u1p.select(project)
        self.assertEqual(1, selection.plate_id)
        self.assertEqual(["10", "11"], selection.as_ids())

    def test_object_subset_is_honoured(self):
        zf, project = self.load(self.project_file())
        selection = u1p.select(project, 1, ["11"])
        self.assertEqual(["11"], selection.as_ids())
        self.assertEqual({3, 4}, u1p.object_used_extruders(zf, project, "11"))

    def test_repeated_instances_resolve(self):
        zf, project = self.load(self.project_file())
        selection = u1p.select(project, 2, ["11"])
        instances = u1p.selection_instances(project, selection)
        self.assertEqual(2, len(instances))
        self.assertEqual([("11", instances[0][1]), ("11", instances[1][1])], instances)

    def test_unknown_and_foreign_objects_are_refused(self):
        zf, project = self.load(self.project_file())
        with self.assertRaises(u1.ConvertError):
            u1p.select(project, 1, ["nope"])
        with self.assertRaises(u1.ConvertError):
            u1p.select(project, 2, ["10"])
        with self.assertRaises(u1.ConvertError):
            u1p.select(project, 9, None)


class Assessment(ProjectCase):
    def test_four_colours_allow_a_direct_print(self):
        path = self.project_file()
        zf, project = self.load(path)
        info = u1p.analyse(zf, project, u1p.select(project))
        self.assertEqual([1, 2, 3, 4], info["mapping"]["used"])
        self.assertTrue(info["mapping"]["direct_possible"])
        options = {o["id"]: o for o in info["options"]}
        self.assertTrue(options["direct"]["feasible"])
        self.assertEqual("export", options["direct"]["action"])
        self.assertNotIn("manual-swap", options)
        # Full Spectrum is offered exactly when a predicted mixture really comes
        # closer to some source colour than the nearest single reel does.
        improves = any(row["choice"] == "mixture" for row in info["spectrum"]["rows"])
        self.assertEqual(improves, options["full-spectrum"]["feasible"])
        self.assertEqual("spectrum" if improves else None,
                         options["full-spectrum"]["action"])
        if improves:
            ids = [r["id"] for r in info["spectrum"]["recipes"]]
            self.assertEqual(list(range(5, 5 + len(ids))), ids)

    def test_five_colours_offer_separate_prints_not_a_silent_swap(self):
        path = self.project_file("five.3mf", five_colours=True)
        zf, project = self.load(path)
        info = u1p.analyse(zf, project, u1p.select(project))
        self.assertEqual([1, 2, 3, 4, 5], info["mapping"]["used"])
        options = {o["id"]: o for o in info["options"]}
        self.assertFalse(options["direct"]["feasible"])
        self.assertTrue(options["separate"]["feasible"])
        self.assertEqual(2, options["separate"]["prints"])
        self.assertEqual([["10"], ["11"]], [g["ids"] for g in options["separate"]["groups"]])
        self.assertEqual("simplify", info["options"][2]["id"])
        self.assertTrue(options["simplify"]["feasible"])
        self.assertTrue(any("5 source colours" in w for w in info["warnings"]))

    def test_plate_two_counts_its_own_objects(self):
        zf, project = self.load(self.project_file())
        info = u1p.analyse(zf, project, u1p.select(project, 2, None))
        self.assertEqual(1, info["counts"]["objects"])
        self.assertEqual(2, info["counts"]["instances"])
        self.assertEqual([3, 4], info["mapping"]["used"])

    def test_measurement_follows_the_transforms(self):
        zf, project = self.load(self.project_file())
        info = u1p.analyse(zf, project, u1p.select(project, 1, ["10"]))
        # the two parts sit at x 100..110 and x 120..130, z 0..0 and 5..5
        self.assertAlmostEqual(30.0, info["measurement"]["size"][0], places=3)
        self.assertAlmostEqual(5.0, info["measurement"]["size"][2], places=3)
        self.assertTrue(info["fit"]["fits"])


class Export(ProjectCase):
    def test_direct_export_preserves_geometry_and_parts(self):
        path = self.project_file()
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "direct.3mf"))
        report = u1p.verify_export(result["output"], zf, project, selection, plan)
        self.assertEqual([], report["problems"])
        self.assertEqual(2, result["instances"])

        with zipfile.ZipFile(result["output"]) as zout:
            names = zout.namelist()
            member = "3D/Objects/object_shared.model"
            self.assertIn(member, names)
            index = u1p.mesh_index(zout, u1p.read_project(zout), member)
            self.assertEqual(["1", "2"], index.order)          # the unused mesh is gone
            settings = zout.read("Metadata/model_settings.config").decode("utf-8")
            self.assertIn('key="name" value="Alpha"', settings)
            self.assertIn('key="extruder" value="3"', settings)
            doc = zout.read("3D/3dmodel.model").decode("utf-8")
            self.assertEqual(2, doc.count("<item "))
            # the inline mesh became its own member and is referenced by path
            self.assertTrue(any(n.startswith("3D/Objects/object_12") for n in names))

    def test_instance_duplication_keeps_both_copies(self):
        path = self.project_file()
        zf, project = self.load(path)
        selection = u1p.select(project, 2, ["11"])
        plan = self.plan_for(zf, project, selection, "direct")
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "instances.3mf"))
        self.assertEqual(2, result["instances"])
        report = u1p.verify_export(result["output"], zf, project, selection, plan)
        self.assertEqual([], report["problems"])

    def test_approximation_remaps_parts_and_paint(self):
        path = self.project_file("five.3mf", five_colours=True)
        zf, project = self.load(path)
        selection = u1p.select(project, 1, ["10"])
        plan = self.plan_for(zf, project, selection, "approximate",
                             colors=["#FFFFFF", "#000000", "#3D9140", "#FF9500"],
                             types=["PLA"] * 4)
        plan.mapping = {1: 1, 2: 2, 3: 3, 5: 1}          # two source colours share slot 1
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "approx.3mf"))
        report = u1p.verify_export(result["output"], zf, project, selection, plan)
        self.assertEqual([], report["problems"])
        # only inner object 1 is painted (state 2, two triangles); 2 -> slot 2
        self.assertEqual({2: 2}, report["paint"])
        with zipfile.ZipFile(result["output"]) as zout:
            settings = zout.read("Metadata/model_settings.config").decode("utf-8")
            self.assertIn('key="extruder" value="3"', settings)   # part 1 stayed on slot 3
            self.assertIn('key="extruder" value="1"', settings)   # part 3 (was 5) shares slot 1

    def test_invalid_mappings_are_refused(self):
        path = self.project_file()
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")

        broken = u1p.Plan(mode="direct", mapping={1: 1}, filaments=plan.filaments)
        self.assertTrue(u1p.validate_plan(zf, project, selection, broken))
        with self.assertRaises(u1.ConvertError):
            u1p.export(zf, project, selection, broken,
                       os.path.join(self.tmp.name, "broken.3mf"))

        out_of_range = u1p.Plan(mode="direct", mapping={1: 1, 2: 2, 3: 3, 4: 9},
                                filaments=plan.filaments)
        self.assertTrue(any("not assigned" in e or "slot" in e
                            for e in u1p.validate_plan(zf, project, selection, out_of_range)))

        substituted = u1p.Plan(
            mode="direct", mapping={1: 1, 2: 2, 3: 3, 4: 4},
            filaments=[{"slot": 1, "color": "#FFFFFF", "type": "PLA"},
                       {"slot": 2, "color": "#000000", "type": "PLA"},
                       {"slot": 3, "color": "#3D9140", "type": "PLA"},
                       {"slot": 4, "color": "#FF9500", "type": "PLA"}])
        self.assertTrue(any("approximation export" in e
                            for e in u1p.validate_plan(zf, project, selection, substituted)))

    def test_copies_are_refused_for_a_multi_object_plate(self):
        path = self.project_file()
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")
        errors = u1p.validate_plan(zf, project, selection, plan, copies=4)
        self.assertTrue(any("copies and fill-bed" in e for e in errors))

    def test_plate_translation_centres_the_selection(self):
        path = self.project_file()
        zf, project = self.load(path)
        selection = u1p.select(project, 1, ["10"])
        plan = self.plan_for(zf, project, selection, "direct")
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "centred.3mf"))
        # measured x 100..130 -> centre 115; the U1 bed centre is 135.5
        self.assertAlmostEqual(20.5, result["offset"][0], places=2)

    def test_export_is_written_beside_the_destination_and_never_partial(self):
        path = self.project_file()
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")
        out = os.path.join(self.tmp.name, "nested", "deep.3mf")
        u1p.export(zf, project, selection, plan, out)
        self.assertTrue(os.path.isfile(out))
        self.assertFalse(os.path.exists(out + ".partial"))


class UnsupportedPaint(ProjectCase):
    def test_identity_pass_through_keeps_an_odd_value(self):
        path = os.path.join(self.tmp.name, "bogus.3mf")
        fixtures.bogus_paint_project(path)
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "bogus-out.3mf"))
        with zipfile.ZipFile(result["output"]) as zout:
            blob = "".join(zout.read(n).decode("utf-8", "replace")
                           for n in zout.namelist() if n.endswith(".model"))
        self.assertIn("4444444444444444444444444444444444", blob)

    def test_a_requested_remap_refuses_rather_than_guessing(self):
        path = os.path.join(self.tmp.name, "bogus2.3mf")
        fixtures.bogus_paint_project(path)
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "approximate",
                             mapping={1: 2}, colors=["#FFFFFF", "#000000", "#3D9140",
                                                     "#FF9500"])
        info = u1p.analyse(zf, project, selection, plan)
        self.assertTrue(any("cannot decode" in w for w in info["warnings"]))
        with self.assertRaises(u1.ConvertError) as ctx:
            u1p.export(zf, project, selection, plan,
                       os.path.join(self.tmp.name, "bogus-out2.3mf"))
        self.assertIn("cannot read", str(ctx.exception))


class PlanFor(ProjectCase):
    def test_default_is_direct_and_keeps_source_colours(self):
        path = self.project_file()
        zf, project = self.load(path)
        plan = u1p.plan_for(zf, project, u1p.select(project))
        self.assertEqual("direct", plan.mode)
        self.assertEqual({1: 1, 2: 2, 3: 3, 4: 4}, plan.mapping)
        self.assertEqual("#FF0000", plan.colors()[2])

    def test_five_colours_ask_before_substituting(self):
        path = self.project_file("five.3mf", five_colours=True)
        zf, project = self.load(path)
        with self.assertRaises(u1.ConvertError) as ctx:
            u1p.plan_for(zf, project, u1p.select(project))
        self.assertIn("uses 5 source colours", str(ctx.exception))
        plan = u1p.plan_for(zf, project, u1p.select(project), require_explicit=False)
        self.assertEqual("approximate", plan.mode)
        self.assertEqual(5, len(plan.mapping))

    def test_named_reels_make_it_an_approximation(self):
        path = self.project_file()
        zf, project = self.load(path)
        plan = u1p.plan_for(zf, project, u1p.select(project),
                            slots=["#FFFFFF", "#000000", "#3D9140", "#FF9500"],
                            approximate=True)
        self.assertEqual("approximate", plan.mode)
        self.assertEqual("#3D9140", plan.colors()[2])

    def test_explicit_map_is_used_as_given(self):
        path = self.project_file()
        zf, project = self.load(path)
        plan = u1p.plan_for(zf, project, u1p.select(project, 1, ["10"]),
                            slots=["#FFFFFF", "#000000", "#3D9140", "#FF9500"],
                            mapping={1: 2, 2: 1, 3: 3}, approximate=True)
        self.assertEqual({1: 2, 2: 1, 3: 3}, plan.mapping)

    def test_direct_intent_on_five_colours_fails_clearly(self):
        path = self.project_file("five-direct.3mf", five_colours=True)
        zf, project = self.load(path)
        with self.assertRaises(u1.ConvertError) as ctx:
            u1p.plan_for(zf, project, u1p.select(project), intent="direct")
        self.assertIn("source colours", str(ctx.exception))
        with self.assertRaises(u1.ConvertError):
            u1p.validate_plan(zf, project, u1p.select(project),
                              u1p.plan_for(zf, project, u1p.select(project),
                                           intent="direct"))


class SelectionListing(ProjectCase):
    """The page must see every object on the plate, selected or not."""

    def test_analysis_lists_every_object_with_a_selected_flag(self):
        path = self.project_file()
        zf, project = self.load(path)
        info = u1p.analyse(zf, project, u1p.select(project, 1, ["10"]))
        ids = [o["id"] for o in info["objects"]]
        self.assertEqual(["10", "11"], ids)
        self.assertTrue(info["objects"][0]["selected"])
        self.assertFalse(info["objects"][1]["selected"])
        self.assertEqual(["10"], info["selection"]["objects"])
        self.assertEqual(1, info["counts"]["objects"])
        self.assertEqual(2, info["counts"]["plate_objects"])

    def test_empty_selection_is_an_error_not_a_default(self):
        path = self.project_file()
        zf, project = self.load(path)
        with self.assertRaises(u1.ConvertError):
            u1p.select(project, 1, [])
        self.assertEqual(["10", "11"], u1p.select(project, 1).as_ids())

    def test_unselectable_objects_are_left_out_of_the_listing(self):
        path = os.path.join(self.tmp.name, "missing-item.3mf")
        fixtures.two_plate_project(path)
        zf, project = self.load(path)
        project.items = [it for it in project.items if it.objectid != "11"]
        self.assertEqual(["10"], u1p.eligible_objects(project, 1))


class Instances(ProjectCase):
    """Plate entries are instances, not object names."""

    def test_one_instance_per_plate_entry(self):
        path = self.project_file()
        zf, project = self.load(path)
        first = u1p.selection_instances(project, u1p.select(project, 1, ["11"]))
        second = u1p.selection_instances(project, u1p.select(project, 2, ["11"]))
        self.assertEqual(1, len(first))
        self.assertEqual(2, len(second))
        # the two copies on plate 2 are the two build items, not the same one twice
        self.assertNotEqual(second[0][1], second[1][1])
        # and plate 1's copy is plate 2's first build item, not all of them
        self.assertEqual(first[0][1], second[0][1])

    def test_instance_ids_select_the_matching_build_item(self):
        path = self.project_file()
        zf, project = self.load(path)
        plate = project.plate(2)
        plate.entries[1].instance_id = "0"
        instances = u1p.selection_instances(project, u1p.select(project, 2, ["11"]))
        self.assertEqual(2, len(instances))
        self.assertEqual(instances[0][1], instances[1][1])
        plate.entries[1].instance_id = "9"
        instances = u1p.selection_instances(project, u1p.select(project, 2, ["11"]))
        self.assertEqual(1, len(instances))
        self.assertTrue(any("left out" in w for w in project.warnings))

    def test_rotated_duplicates_are_both_kept(self):
        path = os.path.join(self.tmp.name, "rotated.3mf")
        fixtures.rotated_duplicates_project(path)
        zf, project = self.load(path)
        selection = u1p.select(project)
        chain = u1p.component_chain(zf, project, "1")
        self.assertEqual(2, len(chain))
        self.assertNotEqual(u1p._matrix_key(chain[0][2]), u1p._matrix_key(chain[1][2]))
        info = u1p.analyse(zf, project, selection)
        self.assertEqual([1, 2], info["mapping"]["used"])


class Graph(ProjectCase):
    def test_nested_assembly_is_exported_whole(self):
        path = os.path.join(self.tmp.name, "nested.3mf")
        fixtures.nested_project(path)
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "nested-out.3mf"))
        report = u1p.verify_export(result["output"], zf, project, selection, plan,
                                   offset=None)
        self.assertEqual([], report["problems"])
        with zipfile.ZipFile(result["output"]) as zout:
            index = u1p.mesh_index(zout, u1p.read_project(zout),
                                   "3D/Objects/object_assembly.model")
        self.assertEqual(["1", "2"], index.order)

    def test_cross_member_reference_is_copied(self):
        path = os.path.join(self.tmp.name, "cross.3mf")
        fixtures.nested_project(path, cross_member=True)
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "cross-out.3mf"))
        self.assertIn("3D/Objects/object_extra.model", result["members"])
        self.assertEqual([], result["checks"]["problems"])

    def test_cycles_and_missing_objects_are_refused(self):
        cycle = os.path.join(self.tmp.name, "cycle.3mf")
        fixtures.nested_project(cycle, cycle=True)
        zf, project = self.load(cycle)
        selection = u1p.select(project)
        with self.assertRaises(u1.ConvertError) as ctx:
            plan = self.plan_for(zf, project, selection, "direct")
            u1p.export(zf, project, selection, plan,
                       os.path.join(self.tmp.name, "cycle-out.3mf"))
        self.assertIn("cyclic", str(ctx.exception))

        missing = os.path.join(self.tmp.name, "missing.3mf")
        fixtures.nested_project(missing, missing=True)
        zf, project = self.load(missing)
        selection = u1p.select(project)
        with self.assertRaises(u1.ConvertError) as ctx:
            plan = self.plan_for(zf, project, selection, "direct")
            u1p.export(zf, project, selection, plan,
                       os.path.join(self.tmp.name, "missing-out.3mf"))
        self.assertIn("has no object", str(ctx.exception))

    def test_invalid_transform_is_an_error(self):
        path = os.path.join(self.tmp.name, "bad-transform.3mf")
        fixtures.two_plate_project(path)
        zf, project = self.load(path)
        project.objects["10"].components[0].transform = "not a matrix"
        with self.assertRaises(u1.ConvertError) as ctx:
            u1p.component_chain(zf, project, "10")
        self.assertIn("could not be read", str(ctx.exception))

    def test_prusa_multi_volume_is_refused(self):
        path = os.path.join(self.tmp.name, "multi-volume.3mf")
        fixtures.prusa_multi_volume_project(path)
        with self.assertRaises(u1.ConvertError) as ctx:
            with zipfile.ZipFile(path) as zf:
                u1p.read_project(zf)
        self.assertIn("volumes", str(ctx.exception))

    def test_a_prusa_negative_volume_is_refused(self):
        """A control volume subtracts material; flattening it prints the hole in."""
        path = os.path.join(self.tmp.name, "negative.3mf")
        fixtures.prusa_negative_volume_project(path)
        with self.assertRaises(u1.ConvertError) as ctx:
            with zipfile.ZipFile(path) as zf:
                u1p.read_project(zf)
        message = str(ctx.exception)
        self.assertIn("volumes", message)
        self.assertIn("triangle-range filaments", message)

    def test_a_bambu_control_volume_is_refused(self):
        """The Bambu spelling of the same thing: every part is written printable."""
        for subtype in ("negative_part", "modifier_part", "support_blocker"):
            with self.subTest(subtype):
                path = os.path.join(self.tmp.name, f"{subtype}.3mf")
                fixtures.hidden_role_project(path, subtype)
                with self.assertRaises(u1.ConvertError) as ctx:
                    with zipfile.ZipFile(path) as zf:
                        u1p.read_project(zf)
                self.assertIn(subtype, str(ctx.exception))
                self.assertIn("printable geometry", str(ctx.exception))

    def test_part_metadata_follows_the_part_id(self):
        path = os.path.join(self.tmp.name, "shuffled.3mf")
        fixtures.shuffled_parts_project(path)
        zf, project = self.load(path)
        selection = u1p.select(project)
        plan = self.plan_for(zf, project, selection, "direct")
        result = u1p.export(zf, project, selection, plan,
                            os.path.join(self.tmp.name, "shuffled-out.3mf"))
        self.assertEqual({"3": 1, "5": 2}, result["mapping"])
        with zipfile.ZipFile(result["output"]) as zout:
            settings = zout.read(u1.SRC_BBL_MODEL).decode("utf-8")
        # the parts keep their *names* from the shuffled metadata and land on the
        # slots their own extruders map to: 3 -> 1, 5 -> 2
        self.assertLess(settings.index('value="first"'), settings.index('value="second"'))
        self.assertIn('key="extruder" value="1"', settings)
        self.assertIn('key="extruder" value="2"', settings)
        self.assertEqual([3, 5], sorted(u1p.object_used_extruders(zf, project, "1")))


class PaletteProvenance(ProjectCase):
    """Where a project's colours come from, and what happens when they are nowhere.

    A portable PrusaSlicer colour project deliberately has no ``Slic3r_PE.config``,
    so its palette is the Full Spectrum description.  Reading only the print config
    reopened such a file as white defaults; reading neither has to stop.
    """

    def test_full_spectrum_json_is_the_palette_of_a_portable_prusa_project(self):
        path = os.path.join(self.tmp.name, "portable-prusa.3mf")
        fixtures.prusa_portable_project(path)
        zf, project = self.load(path)
        self.assertEqual("prusa", project.kind)
        self.assertEqual(["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF"],
                         project.colors)
        self.assertEqual("Prusa_Slicer_full_spectrum.json", project.palette_source)
        # A paint state that names the recipe resolves to the recipe's own colour.
        self.assertEqual("#FF0000", project.color_for(3))
        self.assertEqual("#0000FF", project.color_for(5))
        info = u1p.analyse(zf, project, u1p.select(project, 1, None))
        # The fixture paints leaf states 4 and 5, so the *used* colours are the
        # fourth reel and the single recipe -- not the first two palette entries.
        self.assertEqual([4, 5], info["mapping"]["used"])
        self.assertEqual({4: "#00FF00", 5: "#0000FF"}, info["source_colors"])
        self.assertEqual("Prusa_Slicer_full_spectrum.json",
                         info["source"]["palette_source"])
        self.assertEqual([], [w for w in info["warnings"] if "palette" in w],
                         "every used id has a palette entry")

    def test_a_project_with_no_palette_anywhere_is_refused(self):
        path = os.path.join(self.tmp.name, "palette-less.3mf")
        fixtures.prusa_portable_project(path, spectrum=False)
        with self.assertRaises(u1.ConvertError) as ctx:
            with zipfile.ZipFile(path) as zf:
                u1p.read_project(zf)
        self.assertIn("no palette to read", str(ctx.exception))

    def test_a_palette_that_does_not_start_at_one_is_refused(self):
        path = os.path.join(self.tmp.name, "gapped.3mf")
        fixtures.prusa_portable_project(path, palette_ids=(2, 3, 4, 5, 6))
        with self.assertRaises(u1.ConvertError) as ctx:
            with zipfile.ZipFile(path) as zf:
                u1p.read_project(zf)
        self.assertIn("1..N", str(ctx.exception))

    def test_used_states_beyond_the_palette_are_reported_not_whited_out(self):
        path = os.path.join(self.tmp.name, "beyond.3mf")
        # "6C" is leaf state 9, which this palette (five entries) never describes.
        fixtures.prusa_portable_project(path, paint=("6C", "2C"))
        zf, project = self.load(path)
        info = u1p.analyse(zf, project, u1p.select(project, 1, None))
        self.assertIn(9, info["mapping"]["used"])
        self.assertTrue(any("palette does not list" in w for w in info["warnings"]),
                        info["warnings"])


class ColourCounting(ProjectCase):
    def test_a_fully_painted_part_does_not_need_its_base_filament(self):
        path = os.path.join(self.tmp.name, "painted.3mf")
        fixtures.fully_painted_project(path)
        zf, project = self.load(path)
        self.assertEqual({1, 2}, u1p.object_used_extruders(zf, project, "1"))
        info = u1p.analyse(zf, project, u1p.select(project))
        self.assertEqual([1, 2], info["mapping"]["used"])
        self.assertEqual([1, 1], [info["source"]["slots"][i]["painted_triangles"]
                                  for i in (0, 1)])

    def test_undecodable_paint_does_not_confirm_four_colours(self):
        path = os.path.join(self.tmp.name, "odd.3mf")
        fixtures.bogus_paint_project(path)
        zf, project = self.load(path)
        info = u1p.analyse(zf, project, u1p.select(project))
        options = {o["id"]: o for o in info["options"]}
        self.assertFalse(options["direct"]["feasible"])
        self.assertIn("cannot read", options["direct"]["detail"])
        self.assertEqual(2, info["counts"]["undecodable_paint"])


if __name__ == "__main__":
    unittest.main()
