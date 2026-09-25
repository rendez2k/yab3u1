"""The published site build: selection, isolation and byte equality.

`tools/build_site.py` decides what Netlify publishes.  These checks pin the
output to the file list the live v2.3.2 release serves, prove every copy is
byte-identical to its source, prove nothing private or test-only is in there,
and prove the cleanup cannot be pointed at the repository.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(HERE, "tools", "build_site.py")

# What https://yab3u1.netlify.app serves, out of this source tree: the two pages,
# the modules and worker they load, the icon, and the two licence files.
PUBLIC_FILES = (
    "LICENSE",
    "THIRD_PARTY_NOTICES.txt",
    "base_settings.js",
    "batch-page.js",
    "batch.css",
    "convert-page.js",
    "converter.js",
    "icon.ico",
    "index.html",
    "recolour.html",
    "recolour.js",
    "local-printer.js",
    "shared/printer.js",
    "shared/printerPanel.js",
    "shared/printerBridge.js",
    "assets/yab3d-mark-96.png",
    "assets/yab3d-mark.png",
    "shared/assignment.js",
    "shared/batchSession.js",
    "shared/batchZipWorker.js",
    "shared/bundle.js",
    "shared/bundleWorker.js",
    "shared/textureFormats.js",
    "shared/textureModel.js",
    "shared/textureImport.js",
    "shared/textureWorker.js",
    "texture-import.css",
    "shared/filamentPicker.js",
    "shared/filamentPicker.css",
    "shared/filamentProfiles.js",
    "shared/u1ProfileData.js",
    "shared/u1Profiles.js",
    "shared/colour.js",
    "shared/convertSession.js",
    "shared/fdmMix.js",
    "shared/layout.js",
    "shared/mix.js",
    "shared/mix_model.js",
    "shared/paint.js",
    "shared/planner.js",
    "shared/swapExport.js",
    "shared/swapProject.js",
    "shared/swapWorker.js",
    "shared/spoolImport.js",
    "shared/recommend.js",
    "shared/recommendWorker.js",
    "shared/png.js",
    "shared/preview.js",
    "shared/printSettings.js",
    "shared/project.js",
    "shared/raster.js",
    "shared/recolour-worker.js",
    "shared/simplify.js",
    "shared/standard.js",
    "shared/targets.js",
    "shared/thumbnail.js",
    "shared/workerClient.js",
    "shared/vendor/prusa-fdm/color.js",
    "shared/vendor/prusa-fdm/delta-e.js",
    "shared/vendor/prusa-fdm/yule-nielsen.js",
    "shared/vendor/prusa-fdm/prusa-fdm-mixer.js",
    "zip.js",
)

# Nothing in the published site may carry any of these markers.
FORBIDDEN = ("tests/", "selftest", "make_fixtures", ".3mf", "node_modules",
             "docs/", "tools/", "analysis-previews", "debug.log", "u1")


def load_builder():
    """Import tools/build_site.py by path; `tools/` is not a package."""
    spec = importlib.util.spec_from_file_location("build_site", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def run_build(out: str, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, SCRIPT, "--out", out, *extra],
                          cwd=HERE, capture_output=True, text=True)


def sha256_file(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def built_files(out: str) -> dict:
    """`{relative path: sha256}` for everything the build wrote."""
    found = {}
    for base, _dirs, names in os.walk(out):
        for name in names:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, out).replace(os.sep, "/")
            found[rel] = sha256_file(full)
    return found


class SiteBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="u1-site-build-")
        self.out = os.path.join(self.tmp, "site")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_selection_is_the_published_site(self):
        done = run_build(self.out)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(sorted(built_files(self.out)), sorted(PUBLIC_FILES))

    def test_copies_are_byte_identical_to_their_sources(self):
        done = run_build(self.out)
        self.assertEqual(done.returncode, 0, done.stderr)
        for rel, digest in built_files(self.out).items():
            source = os.path.join(HERE, "web", rel)
            if not os.path.isfile(source):
                source = os.path.join(HERE, rel)      # LICENSE, THIRD_PARTY_NOTICES.txt
            self.assertTrue(os.path.isfile(source), f"{rel} has no source")
            self.assertEqual(digest, sha256_file(source), f"{rel} was rewritten")

    def test_nothing_private_or_test_only_is_published(self):
        done = run_build(self.out)
        self.assertEqual(done.returncode, 0, done.stderr)
        for rel in built_files(self.out):
            lowered = rel.lower()
            for marker in FORBIDDEN:
                if marker == "u1" and rel in ("shared/u1ProfileData.js", "shared/u1Profiles.js"):
                    continue
                self.assertNotIn(marker, lowered, f"{rel} should not be published")

    def test_manifest_records_the_same_inventory(self):
        manifest = os.path.join(self.tmp, "manifest.json")
        done = run_build(self.out, "--manifest", manifest)
        self.assertEqual(done.returncode, 0, done.stderr)
        with open(manifest, encoding="utf-8") as fh:
            report = json.load(fh)
        self.assertEqual({item["path"] for item in report["files"]},
                         set(built_files(self.out)))
        self.assertEqual(report["assets"], len(PUBLIC_FILES) - 2)   # two licence files

    def test_a_fresh_build_reproduces_the_same_bytes(self):
        first = run_build(self.out)
        self.assertEqual(first.returncode, 0, first.stderr)
        again = os.path.join(self.tmp, "site-again")
        second = run_build(again)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(built_files(again), built_files(self.out))

    def test_pages_only_reference_files_that_are_in_the_build(self):
        done = run_build(self.out)
        self.assertEqual(done.returncode, 0, done.stderr)
        pages = sorted(name for name in os.listdir(self.out) if name.endswith(".html"))
        self.assertEqual(pages, ["index.html", "recolour.html"])
        reference = re.compile(r'(?:src|href)="([^"]+)"')
        for page in pages:
            with open(os.path.join(self.out, page), encoding="utf-8") as fh:
                text = fh.read()
            for ref in reference.findall(text):
                if ref.startswith(("http:", "https:", "mailto:", "#")):
                    continue
                self.assertTrue(os.path.isfile(os.path.join(self.out, ref)),
                                f"{page} refers to {ref}, which the build left out")

    def test_a_png_asset_ships_byte_for_byte(self):
        # A stand-in tree, so the test never writes to the real `web/`: the mark
        # the pages load is published exactly as it is on disk, beside the larger
        # original root keeps there.
        builder = load_builder()
        web = os.path.join(self.tmp, "web")
        os.makedirs(os.path.join(web, "assets"))
        with open(os.path.join(web, "index.html"), "w", encoding="utf-8") as fh:
            fh.write("<!DOCTYPE html><html></html>")
        with open(os.path.join(web, "convert-page.js"), "w", encoding="utf-8") as fh:
            fh.write("// the page's module\n")
        header_mark = bytes(range(256)) * 4
        with open(os.path.join(web, "assets", "yab3d-mark-96.png"), "wb") as fh:
            fh.write(b"\x89PNG\r\n\x1a\n" + header_mark)
        with open(os.path.join(web, "assets", "yab3d-mark.png"), "wb") as fh:
            fh.write(b"\x89PNG\r\n\x1a\n" + b"master art")
        original = builder.WEB
        builder.WEB = pathlib.Path(web)
        self.addCleanup(setattr, builder, "WEB", original)

        chosen = {item.as_posix() for item in builder.asset_paths(pathlib.Path(web))}
        self.assertIn("assets/yab3d-mark-96.png", chosen)
        self.assertIn("assets/yab3d-mark.png", chosen,
                      "every approved image under web/ is published")

        out = os.path.join(self.tmp, "image-site")
        report = builder.build(pathlib.Path(out), clean=False)
        self.assertEqual({item["path"] for item in report["files"]} - {"LICENSE"},
                         {"THIRD_PARTY_NOTICES.txt", "assets/yab3d-mark-96.png",
                          "assets/yab3d-mark.png", "convert-page.js", "index.html"})
        built = os.path.join(out, "assets", "yab3d-mark-96.png")
        self.assertTrue(os.path.isfile(built), "the image was not published")
        with open(built, "rb") as fh:
            self.assertEqual(fh.read(), b"\x89PNG\r\n\x1a\n" + header_mark,
                             "the published image is not the source byte for byte")

    def test_clean_removes_stale_files_from_the_output(self):
        # The guard only allows cleaning inside the repository, so point the
        # module's root -- and the licence files it looks up beside it -- at the
        # scratch directory, then let the real clean path run.
        builder = load_builder()
        builder.ROOT = pathlib.Path(self.tmp)
        self.out = os.path.join(self.tmp, "dist")
        for name in builder.COPY_WITH_SITE:
            shutil.copyfile(os.path.join(HERE, name), os.path.join(self.tmp, name))
        os.makedirs(self.out)
        with open(os.path.join(self.out, "stale.txt"), "w", encoding="utf-8") as fh:
            fh.write("left over from an earlier build\n")
        builder.build(pathlib.Path(self.out), clean=True)
        self.assertNotIn("stale.txt", built_files(self.out))
        self.assertEqual(sorted(built_files(self.out)), sorted(PUBLIC_FILES))

    def test_clean_is_refused_outside_the_repository(self):
        os.makedirs(self.out)
        with open(os.path.join(self.out, "keep.txt"), "w", encoding="utf-8") as fh:
            fh.write("not mine to delete\n")
        done = run_build(self.out)          # cleaning is on by default
        self.assertEqual(done.returncode, 1)
        self.assertIn("outside", done.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "keep.txt")))

    def test_no_clean_refuses_existing_content(self):
        os.makedirs(self.out)
        sentinel = pathlib.Path(self.out, "private.txt")
        sentinel.write_text("keep", encoding="utf-8")
        done = run_build(self.out, "--no-clean")
        self.assertEqual(done.returncode, 1)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_cleanup_guard_never_reaches_source(self):
        builder = load_builder()
        for target in (pathlib.Path(HERE),
                       pathlib.Path(HERE, "web"),
                       pathlib.Path(HERE, "web", "shared"),
                       pathlib.Path(HERE, ".git"),
                       pathlib.Path(HERE, "other-user-folder"),
                       pathlib.Path(HERE).parent):
            with self.assertRaises(builder.BuildError, msg=str(target)):
                builder.check_clean_target(target)
        allowed = builder.check_clean_target(pathlib.Path(HERE, "dist"))
        self.assertEqual(allowed, pathlib.Path(HERE, "dist").resolve())


if __name__ == "__main__":
    unittest.main()
