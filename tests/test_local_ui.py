"""The local page's endpoints, exercised over real HTTP on loopback."""

import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import zipfile

import u1convert as u1
import u1ui
from tests import fixtures


class LocalUi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.mkdtemp(prefix="u1ui-tests-")
        cls.saved = (u1ui._workdir, u1ui._profile_root, u1.LOG_SINK)
        u1ui._workdir = cls.work
        u1ui._profile_root = None
        u1.LOG_SINK = lambda *_a: None
        cls.httpd = u1ui.ThreadingHTTPServer(("127.0.0.1", 0), u1ui.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.tmp = tempfile.TemporaryDirectory(prefix="u1ui-fixtures-")

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        u1ui._workdir, u1ui._profile_root, u1.LOG_SINK = cls.saved
        cls.tmp.cleanup()

    # -- helpers -----------------------------------------------------------------
    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def post(self, path, body: bytes, headers=None):
        req = urllib.request.Request(self.url(path), data=body, method="POST",
                                     headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8")), resp.headers
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8")), exc.headers

    def get(self, path):
        try:
            with urllib.request.urlopen(self.url(path), timeout=120) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(), exc.headers

    def get_json(self, path):
        status, body, headers = self.get(path)
        return status, json.loads(body.decode("utf-8")), headers

    def upload(self, path):
        with open(path, "rb") as fh:
            data = fh.read()
        status, body, _headers = self.post(
            "/api/analyze", data,
            {"X-Filename": os.path.basename(path), "Content-Length": str(len(data))})
        self.assertEqual(200, status, body)
        return body

    def wait_for(self, token, timeout=120):
        deadline = time.time() + timeout
        while time.time() < deadline:
            status, body, _headers = self.get_json(f"/api/progress/{token}")
            self.assertEqual(200, status, body)
            if body["state"] in ("done", "error"):
                return body
            time.sleep(0.2)
        self.fail("the conversion never finished")

    # -- project mode -------------------------------------------------------------
    def test_project_analysis_plan_and_convert(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "two.3mf"))
        info = self.upload(path)
        self.assertTrue(info["multipart"])
        self.assertEqual([1, 2], [p["id"] for p in info["plates"]])
        self.assertEqual(["10", "11"], info["selection"]["objects"])
        self.assertEqual([1, 2, 3, 4], info["mapping"]["used"])
        self.assertTrue(info["mapping"]["direct_possible"])
        self.assertEqual([], info["mapping"]["errors"])
        self.assertTrue(info["profiles"]["filament"])

        # narrowing the selection changes the assessment
        status, planned, _h = self.post("/api/plan", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["11"],
            "filaments": [{"color": "#FFFFFF", "type": "PLA"},
                          {"color": "#000000", "type": "PLA"},
                          {"color": "#3D9140", "type": "PLA"},
                          {"color": "#FF9500", "type": "PLA"}],
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(200, status, planned)
        self.assertEqual(["11"], planned["selection"]["objects"])
        self.assertEqual([3, 4], planned["mapping"]["used"])

        status, started, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["10"],
            "mode": "direct", "verify": False,
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(200, status, started)
        progress = self.wait_for(info["id"])
        self.assertEqual("done", progress["state"], progress.get("error"))
        self.assertTrue(any("verified against the source" in line for line in progress["logs"]))

        status, blob, headers = self.get(f"/api/result/{info['id']}")
        self.assertEqual(200, status)
        self.assertTrue(blob.startswith(b"PK\x03\x04"))
        self.assertIn(".3mf", headers.get("X-Suggested-Filename", ""))

    def test_five_colour_selection_needs_the_reels_and_review(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "five.3mf"),
                                          five_colours=True)
        info = self.upload(path)
        options = {o["id"]: o for o in info["options"]}
        self.assertFalse(options["direct"]["feasible"])
        self.assertTrue(options["separate"]["feasible"])
        self.assertTrue(options["simplify"]["feasible"])

        # without the reviewed mapping the approximation is refused, not guessed
        status, started, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["10"], "mode": "approximate",
            "verify": False,
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(400, status)
        self.assertIn("mapping that was reviewed", started["error"])

        # with one, the same selection exports
        status, started, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["10"], "mode": "approximate",
            "verify": False,
            "mapping": {"1": 1, "2": 2, "3": 3, "5": 1},
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(200, status, started)
        progress = self.wait_for(info["id"])
        self.assertEqual("done", progress["state"], progress.get("error"))

    def test_spectrum_export_needs_reviewed_recipes_and_writes_them(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "spectrum.3mf"),
                                          five_colours=True)
        info = self.upload(path)
        reels = [{"color": "#FFFFFF", "type": "PLA"}, {"color": "#000000", "type": "PLA"},
                 {"color": "#FF9500", "type": "PLA"}, {"color": "#FF0080", "type": "PLA"}]
        status, plan, _h = self.post("/api/plan", json.dumps({
            "id": info["id"], "plate": 1, "objects": None,
            "filaments": reels, "approximate": True,
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(200, status, plan)
        recipes = plan["spectrum"]["recipes"]
        self.assertTrue(recipes)
        mapping = plan["spectrum"]["suggested_mapping"]
        self.assertIn(5, mapping.values())
        objects = [o["id"] for o in plan["objects"] if o["selected"]]

        # No recipes at all: refused rather than quietly exporting something else.
        status, body, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "plate": 1, "objects": objects, "mode": "spectrum",
            "filaments": reels, "mapping": mapping, "recipes": [],
            "verify": False,
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(400, status)
        self.assertIn("at least one reviewed mixture recipe", body["error"])

        # A dish of recipes the writer cannot use is refused, not truncated.
        status, body, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "plate": 1, "objects": objects, "mode": "spectrum",
            "filaments": reels, "mapping": mapping,
            "recipes": [{"a": 1, "b": 2, "percent": 50}] * 13,
            "verify": False,
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(400, status)
        self.assertIn("this writer stops", body["error"])

        # And the reviewed set exports as a Full Spectrum project.
        status, started, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "plate": 1, "objects": objects, "mode": "spectrum",
            "filaments": reels, "mapping": mapping, "recipes": recipes,
            "verify": False,
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(200, status, started)
        progress = self.wait_for(info["id"])
        self.assertEqual("done", progress["state"], progress.get("error"))

    def test_unknown_object_and_bad_file_are_reported(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "two2.3mf"))
        info = self.upload(path)
        status, body, _h = self.post("/api/plan", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["nope"]}).encode("utf-8"),
            {"Content-Type": "application/json"})
        self.assertEqual(400, status)
        self.assertIn("unknown object", body["error"])

        status, body, _h = self.post("/api/analyze", b"not a zip at all",
                                     {"X-Filename": "nope.3mf"})
        self.assertEqual(400, status)
        self.assertIn("3MF", body["error"])

        status, body, _h = self.post("/api/convert", json.dumps(
            {"id": "0" * 32, "objects": []}).encode("utf-8"),
            {"Content-Type": "application/json"})
        self.assertEqual(404, status)

    def test_bad_requests_are_json_not_dropped_connections(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "two3.3mf"))
        info = self.upload(path)

        # an empty selection means none, not "all of them"
        status, body, _h = self.post("/api/plan", json.dumps({
            "id": info["id"], "plate": 1, "objects": []}).encode("utf-8"),
            {"Content-Type": "application/json"})
        self.assertEqual(400, status)
        self.assertIn("no objects were selected", body["error"])

        # a mapping that is not source:slot pairs
        status, body, _h = self.post("/api/plan", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["10"],
            "mapping": {"first": "second"}}).encode("utf-8"),
            {"Content-Type": "application/json"})
        self.assertEqual(400, status)
        self.assertIn("whole numbers", body["error"])

        # an unknown export mode
        status, body, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["10"], "mode": "wibble",
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(400, status)
        self.assertIn("unknown export mode", body["error"])

    def test_analysis_lists_every_object_and_flags_the_selection(self):
        path = fixtures.two_plate_project(os.path.join(self.tmp.name, "two4.3mf"))
        info = self.upload(path)
        self.assertEqual(["10", "11"], [o["id"] for o in info["objects"]])
        self.assertTrue(all(o["selected"] for o in info["objects"]))
        status, planned, _h = self.post("/api/plan", json.dumps({
            "id": info["id"], "plate": 1, "objects": ["10"]}).encode("utf-8"),
            {"Content-Type": "application/json"})
        self.assertEqual(200, status, planned)
        self.assertEqual(["10", "11"], [o["id"] for o in planned["objects"]])
        self.assertEqual([True, False], [o["selected"] for o in planned["objects"]])
        self.assertEqual(["10"], planned["selection"]["objects"])
        self.assertEqual(1, planned["counts"]["objects"])
        self.assertEqual(2, planned["counts"]["plate_objects"])

    # -- single-object mode --------------------------------------------------------
    def test_single_object_files_keep_the_old_flow(self):
        path = fixtures.single_object_project(os.path.join(self.tmp.name, "solo.3mf"))
        info = self.upload(path)
        self.assertFalse(info["multipart"])
        self.assertTrue(info["slots"])
        status, started, _h = self.post("/api/convert", json.dumps({
            "id": info["id"], "copies": 1, "gap": 5, "verify": False,
        }).encode("utf-8"), {"Content-Type": "application/json"})
        self.assertEqual(200, status, started)
        progress = self.wait_for(info["id"])
        self.assertEqual("done", progress["state"], progress.get("error"))
        status, blob, _h = self.get(f"/api/result/{info['id']}")
        self.assertEqual(200, status)
        self.assertTrue(blob.startswith(b"PK\x03\x04"))

    def test_multipart_files_are_reported_when_the_legacy_reader_cannot_place_them(self):
        # the full Blob shape: shared mesh files, two objects, one plate
        path = os.path.join(self.tmp.name, "shape.3mf")
        fixtures.two_plate_project(path)
        with zipfile.ZipFile(path) as zf:
            self.assertTrue(zf.read("3D/3dmodel.model"))
        info = self.upload(path)
        self.assertTrue(info["multipart"])
        self.assertIn("plates", info)


if __name__ == "__main__":
    unittest.main()
