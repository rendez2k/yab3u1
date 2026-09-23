#!/usr/bin/env python3
"""Browser QA for the static online page (web/recolour.html).

    python tests/web_qa.py

It serves the `web/` folder over loopback (the page is a set of ES modules, so it
needs a real origin), drives it with Playwright's Chromium, and checks the
recolouring flow end to end: plate and object selection, the preview, every target
export, and the reel-change plan.  Nothing is uploaded anywhere.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import re
import socketserver
import sys
import tempfile
import threading
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import u1targets                                              # noqa: E402
from tests import fixtures                                    # noqa: E402
from tests.browser_qa import Recorder                         # noqa: E402
from tests.test_u1gcode import HEADER as GCODE_HEADER, layer  # noqa: E402
from tests.targets_real_qa import CANDIDATES                  # noqa: E402

EVIDENCE = os.path.join(HERE, "docs", "agent-work", "preview-targets-swaps", "evidence")
REELS = [{"color": "#FFFFFF", "type": "PLA"}, {"color": "#000000", "type": "PLA"},
         {"color": "#FF9500", "type": "PLA"}, {"color": "#FF0080", "type": "PLA"}]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


def serve(directory: str):
    handler = functools.partial(Quiet, directory=directory)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def load_project(page, source: str, timeout: int = 120_000) -> dict:
    """Load a model and wait for *its* preview, not the previous file's.

    ``window.__preview`` keeps the last file's soup until the new one has been
    drawn, so a bare "triangles > 0" wait passes instantly and reads the wrong
    project.  Clearing it first makes the wait mean what it says.
    """
    page.evaluate("() => { window.__preview = null; }")
    page.set_input_files("#file", source)
    page.wait_for_selector("#previewcard:not(.hidden)", timeout=timeout)
    page.wait_for_function("() => window.__preview && window.__preview.triangles > 0",
                           timeout=timeout)
    return page.evaluate("() => window.__preview")


def real_file_pass(page, source: str, label: str, work: str, record) -> list:
    """The online page on a real project: preview, then one export with geometry.

    The synthetic fixture cannot fail the way a real file does (huge arrays, an
    inline mesh, eight palette slots but five used colours), so the real route is
    driven here too.  It stays bounded: one preview and one export, no slicing.
    """
    failures: list = []
    record(f"real file: {source} ({label}) {os.path.getsize(source):,} bytes")
    preview = load_project(page, source, timeout=180_000)
    state = page.evaluate("() => ({ used: window.__recolour.assessed.used,"
                          " recipes: window.__recolour.recipes.length,"
                          " palette: window.__recolour.project.colors.length,"
                          " title: window.__recolour.project.title })")
    record("real preview: " + json.dumps(preview))
    record("real assessment: " + json.dumps(state))
    if not preview.get("triangles"):
        failures.append(f"{label}: the online preview drew nothing")
    if not state["used"]:
        failures.append(f"{label}: the online assessment found no colours")

    page.click("[data-preview='original']")
    page.wait_for_function("() => (window.__preview || {}).mode === 'original'",
                           timeout=30_000)
    page.click("[data-preview='result']")
    page.wait_for_function("() => (window.__preview || {}).mode === 'result'",
                           timeout=30_000)
    page.screenshot(path=os.path.join(EVIDENCE, "web-real-preview.png"), full_page=True)

    page.select_option("#target", "snapmaker")
    if page.is_visible("#review"):
        page.check("#review")
    with page.expect_download(timeout=180_000) as download:
        page.click("#export")
    path = os.path.join(work, "web-real-snapmaker.3mf")
    download.value.save_as(path)
    with zipfile.ZipFile(path) as z:
        model = z.read("3D/3dmodel.model").decode("utf-8", "replace")
        referenced = {name.lstrip("/") for name in
                      re.findall(r'p:path="([^"]+)"', model)}
        referenced.add("3D/3dmodel.model")
        triangles = sum(z.read(name).decode("utf-8", "replace").count("<triangle")
                        for name in referenced if name in z.namelist())
        empty_components = len(re.findall(r"<components>\s*</components>", model))
        cfg = json.loads(z.read("Metadata/project_settings.config").decode("utf-8"))
    record(f"real export: {len(referenced)} member(s), {triangles:,} reachable "
           f"triangles, {len(cfg.get('filament_colour', []))} physical slots, "
           f"{empty_components} empty component block(s)")
    if not triangles:
        failures.append(f"{label}: the exported project has no reachable geometry")
    if empty_components:
        failures.append(f"{label}: the exported project has an empty <components> block")
    if len(cfg.get("filament_colour", [])) != 4:
        failures.append(f"{label}: the exported project does not keep four physical "
                        "slots")
    return failures


def run() -> int:
    os.makedirs(EVIDENCE, exist_ok=True)
    record = Recorder(os.path.join(EVIDENCE, "web-parity.txt"))
    failures: list = []

    source = os.path.join(HERE, "web", "tests", "five-colours.3mf")
    if not os.path.isfile(source):
        os.system(f'"{sys.executable}" tests/export_js_fixtures.py')
    httpd, url = serve(os.path.join(HERE, "web"))
    with tempfile.TemporaryDirectory(prefix="u1web-qa-") as work:
        slicepath = os.path.join(work, "five.gcode")
        with open(slicepath, "w", encoding="utf-8") as fh:
            fh.write(GCODE_HEADER + "".join(layer(i, 0.2 * (i + 1), [(i, 1.0)])
                                            for i in range(5)))
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                # --disable-logging keeps Chromium from dropping a debug.log into
                # the repository root while the QA run is going on.
                browser = pw.chromium.launch(args=["--disable-logging"])
                page = browser.new_page(viewport={"width": 1180, "height": 1000},
                                        accept_downloads=True)
                page.on("pageerror", lambda err: record(f"page error: {err}"))
                page.add_init_script(
                    "localStorage.setItem('yab3u1-web-reels', %s)"
                    % json.dumps(json.dumps(REELS)))
                page.goto(url + "recolour.html")
                preview = load_project(page, source)
                record("preview: " + json.dumps(preview))
                if not preview.get("triangles"):
                    failures.append("the online preview drew nothing")

                state = page.evaluate("() => ({ plate: window.__recolour.plateId,"
                                      " objects: window.__recolour.objects,"
                                      " recipes: window.__recolour.recipes.length,"
                                      " used: window.__recolour.assessed.used })")
                record("state: " + json.dumps(state))
                if len(state["used"]) != 5:
                    failures.append("the online assessment did not find five colours")
                if not state["recipes"]:
                    failures.append("the online page offered no blends")

                page.click("[data-preview='original']")
                page.wait_for_function(
                    "() => (window.__preview || {}).mode === 'original'", timeout=20_000)
                page.click("[data-preview='result']")
                page.wait_for_function(
                    "() => (window.__preview || {}).mode === 'result'", timeout=20_000)
                page.check("#review")
                page.screenshot(path=os.path.join(EVIDENCE, "web-recolour.png"),
                                full_page=True)
                record("screenshot web-recolour.png: the online recolour page")

                for target in u1targets.TARGETS:
                    page.select_option("#target", target)
                    if page.is_visible("#review"):
                        page.check("#review")
                    if target == "prusa":
                        # The five-colour fixture is built from a three-volume
                        # object, and PrusaSlicer describes volumes by triangle
                        # range: the page has to refuse it rather than write the
                        # volumes onto one filament.  This used to hang waiting for
                        # a download; the refusal is the expected result.
                        page.click("#export")
                        page.wait_for_function(
                            "() => /triangle range|volumes/.test("
                            "document.querySelector('#exportlog').textContent)",
                            timeout=30_000)
                        record("prusa: refused the multi-volume object, as documented")
                        continue
                    with page.expect_download(timeout=60_000) as download:
                        page.click("#export")
                    path = os.path.join(work, f"web-{target}.3mf")
                    download.value.save_as(path)
                    sent = page.evaluate("() => window.__lastExport")
                    with zipfile.ZipFile(path) as z:
                        names = z.namelist()
                        cfg = None
                        if "Metadata/project_settings.config" in names:
                            cfg = json.loads(
                                z.read("Metadata/project_settings.config").decode("utf-8"))
                    leaked = [k for k in u1targets.MACHINE_KEYS if cfg and k in cfg]
                    record(f"{target}: {len(names)} members, {os.path.getsize(path)} "
                           f"bytes, recipes={sent['recipes']}, leaked={leaked or 'none'}")
                    if target != "snapmaker" and leaked:
                        failures.append(f"the {target} export leaked U1 settings")
                    if target == "prusa" and u1targets.PRUSA_SPECTRUM_JSON not in names:
                        failures.append("the Prusa export has no Full Spectrum member")
                    if target == "snapmaker":
                        if not (cfg and cfg.get("printer_settings_id")):
                            failures.append("the Snapmaker export lost the U1 profile")
                        if cfg and len(cfg["filament_colour"]) != 4:
                            failures.append("the Snapmaker export changed the physical "
                                            "slot count")
                    if target == "bambu" and cfg:
                        if len(cfg["filament_colour"]) != 4 + len(sent["recipes"]):
                            failures.append("the Bambu palette does not cover the recipes")

                # Turning every blend off must leave them off: the earlier page
                # re-ticked the lot, so the picture and the file disagreed with the
                # checkboxes.  Then clearing every object must disable the export
                # rather than quietly exporting the whole plate.
                untick = ("els => els.forEach((box) => { if (box.checked) {"
                          " box.checked = false;"
                          " box.dispatchEvent(new Event('change', {bubbles: true})); } })")
                page.eval_on_selector_all("input[data-recipe]", untick)
                page.wait_for_timeout(150)
                off = page.evaluate("() => ({ ticked: window.__recolour.ticked.size,"
                                    " boxes: [...document.querySelectorAll("
                                    "'input[data-recipe]')].filter((b) => b.checked).length,"
                                    " review: document.querySelector('#review').checked,"
                                    " disabled: document.querySelector('#export').disabled })")
                record("all recipes off: " + json.dumps(off))
                if off["boxes"] or off["ticked"]:
                    failures.append("unticking every blend re-ticked "
                                    + str(off["ticked"]) + " of them")
                if off["review"]:
                    failures.append("the review tick survived a change to the recipes")
                if not off["disabled"]:
                    failures.append("the export stayed enabled after a recipe change "
                                    "that was not reviewed")

                page.eval_on_selector_all("input[data-object]", untick)
                page.wait_for_timeout(200)
                empty = page.evaluate("() => ({ objects: window.__recolour.objects.length,"
                                      " disabled: document.querySelector('#export').disabled,"
                                      " triangles: (window.__preview || {}).triangles })")
                record("no objects selected: " + json.dumps(empty))
                if empty["objects"]:
                    failures.append("clearing every object left "
                                    + str(empty["objects"]) + " selected")
                if not empty["disabled"]:
                    failures.append("the export stayed enabled with no object selected")
                page.eval_on_selector_all("input[data-object]",
                                          "els => els.forEach((box) => {"
                                          " box.checked = true;"
                                          " box.dispatchEvent(new Event('change',"
                                          " {bubbles: true})); })")
                page.wait_for_timeout(150)

                # ... and the Prusa writer does run where it can: a one-volume
                # object.  Its archive is the portable colour project, so it must
                # carry the Full Spectrum palette and no print config that would
                # override the user's preset.
                load_project(page, os.path.join(HERE, "web", "tests",
                                                "single-object.3mf"))
                page.select_option("#target", "prusa")
                if page.is_visible("#review"):
                    page.check("#review")
                with page.expect_download(timeout=60_000) as download:
                    page.click("#export")
                prusa_path = os.path.join(work, "web-prusa-single.3mf")
                download.value.save_as(prusa_path)
                with zipfile.ZipFile(prusa_path) as z:
                    names = z.namelist()
                record("prusa (one volume): " + ", ".join(sorted(names)))
                if u1targets.PRUSA_SPECTRUM_JSON not in names:
                    failures.append("the online Prusa export has no Full Spectrum "
                                    "palette")
                if "Metadata/Slic3r_PE.config" in names:
                    failures.append("the online Prusa export would override the user's "
                                    "print preset")
                if any(name.startswith("3D/Objects/") for name in names):
                    failures.append("the online Prusa export left external members")

                page.set_input_files("#gcodefile", slicepath)
                page.click("#planbutton")
                page.wait_for_function("() => window.__plan", timeout=60_000)
                plan = page.evaluate("() => window.__plan")
                record("plan: " + json.dumps(plan))
                if not plan.get("feasible"):
                    failures.append("the online planner refused a plan it should make")
                if plan.get("reel_changes") != 1:
                    failures.append("the online planner planned "
                                    + str(plan.get("reel_changes")) + " changes")
                links = page.eval_on_selector_all(
                    "#plandownloads a", "els => els.length")
                if links != 2:
                    failures.append("the online plan offered " + str(links)
                                    + " downloads")

                # A sliced 3MF carries the toolpath as a member, and the page has to
                # ask which one: the earlier build silently read the first.
                sliced = os.path.join(work, "sliced.3mf")
                with zipfile.ZipFile(sliced, "w", zipfile.ZIP_DEFLATED) as z:
                    z.writestr("Metadata/Slic3r_PE_model.config", "<config/>")
                    z.writestr("3D/3dmodel.model", "<model/>")
                    z.writestr("Metadata/plate_1.gcode", GCODE_HEADER + "".join(
                        layer(i, 0.2 * (i + 1), [(i, 1.0)]) for i in range(5)))
                    z.writestr("Metadata/plate_2.gcode", GCODE_HEADER + "".join(
                        layer(i, 0.2 * (i + 1), [(i + 1, 1.0)]) for i in range(5)))
                page.evaluate("() => { window.__plan = null; }")
                page.set_input_files("#gcodefile", sliced)
                page.click("#planbutton")
                page.wait_for_selector("#gcodepick:not(.hidden)", timeout=30_000)
                members = page.eval_on_selector_all("#gcodememberlist option",
                                                    "els => els.map(e => e.value)")
                record("sliced 3MF members offered: " + json.dumps(members))
                if len(members) != 2:
                    failures.append("the online page did not offer both G-code members")
                if page.evaluate("() => window.__plan"):
                    failures.append("the online page planned a member before one was "
                                    "chosen")
                page.select_option("#gcodememberlist", "Metadata/plate_2.gcode")
                page.wait_for_function("() => window.__plan", timeout=60_000)
                chosen = page.evaluate("() => window.__plan")
                record("plan of the chosen member: " + json.dumps(chosen))
                if chosen.get("member") != "Metadata/plate_2.gcode":
                    failures.append("the online plan did not record the chosen member")

                real, label = next(((path, label) for path, label in CANDIDATES
                                    if os.path.isfile(path)), (None, None))
                if real is None:
                    record("no real example is on this machine; the real-file pass "
                           "is skipped")
                else:
                    failures.extend(real_file_pass(page, real, label, work, record))
                browser.close()
        finally:
            httpd.shutdown()

    record("RESULT: " + ("FAILED - " + "; ".join(failures) if failures
                         else "PASS - online page preview, exports and plan checked"))
    record.save()
    print("RESULT: " + ("FAILED - " + "; ".join(failures) if failures else "PASS"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
