#!/usr/bin/env python3
"""Browser QA for the preview, the target choice and the sliced-G-code plan.

    python tests/preview_qa.py

It drives the real local page with Playwright's Chromium: the preview is drawn
from /api/mesh, the Bambu target is exported and read back, and a synthetic slice
is planned.  No slicer is started and nothing leaves the machine.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import u1targets                                              # noqa: E402
import u1ui                                                   # noqa: E402
from tests import fixtures                                    # noqa: E402
from tests.browser_qa import Recorder, start_server           # noqa: E402
from tests.test_u1gcode import HEADER as GCODE_HEADER, layer  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(HERE, "docs", "agent-work", "preview-targets-swaps", "evidence")


def run() -> int:
    os.makedirs(EVIDENCE, exist_ok=True)
    record = Recorder(os.path.join(EVIDENCE, "preview-targets-plan.txt"))
    failures: list = []

    with tempfile.TemporaryDirectory(prefix="u1preview-qa-") as work:
        project = os.path.join(work, "five.3mf")
        fixtures.two_plate_project(project, five_colours=True)
        slicepath = os.path.join(work, "five.gcode")
        with open(slicepath, "w", encoding="utf-8") as fh:
            fh.write(GCODE_HEADER
                     + "".join(layer(i, 0.2 * (i + 1), [(i, 1.0)])
                               for i in range(5)))

        httpd, url = start_server(None)
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser = pw.chromium.launch(args=["--disable-logging"])
                page = browser.new_page(viewport={"width": 1180, "height": 1000})
                page.add_init_script(
                    "localStorage.setItem('yab3u1-reels', %s)"
                    % json.dumps(json.dumps([
                        {"color": "#FFFFFF", "type": "PLA"},
                        {"color": "#000000", "type": "PLA"},
                        {"color": "#FF9500", "type": "PLA"},
                        {"color": "#FF0080", "type": "PLA"}])))
                page.goto(url)
                page.set_input_files("#file", project)
                page.wait_for_selector("#previewcard:not(.hidden)", timeout=60_000)
                page.wait_for_function(
                    "() => window.__preview && window.__preview.triangles > 0",
                    timeout=60_000)
                preview = page.evaluate("() => window.__preview")
                record("preview: " + json.dumps({k: preview[k] for k in
                                                 ("mode", "triangles", "mapping",
                                                  "palette")}))
                if not preview.get("triangles"):
                    failures.append("the preview drew nothing")
                drawn = page.evaluate(
                    "() => { const c = document.getElementById('preview');"
                    " return { w: c.width, h: c.height,"
                    " webgl: Boolean(c.getContext('webgl2')) }; }")
                record("canvas: " + json.dumps(drawn))
                if drawn["w"] < 2 or drawn["h"] < 2:
                    failures.append("the preview canvas has no size")
                if not drawn["webgl"]:
                    record("note: this browser has no WebGL2 context; the preview "
                           "reports that in the page instead of drawing")

                page.click("#previewmode button[data-preview='original']")
                page.wait_for_function(
                    "() => window.__preview && window.__preview.mode === 'original'",
                    timeout=30_000)
                record("switched the preview to the original colours")
                page.click("#previewmode button[data-preview='result']")
                page.wait_for_function(
                    "() => window.__preview && window.__preview.mode === 'result'",
                    timeout=30_000)

                page.select_option("#target", "bambu")
                page.wait_for_selector(
                    "#projoptions [data-action='review-spectrum']", timeout=60_000)
                page.check("#projoptions [data-action='review-spectrum']")
                page.screenshot(path=os.path.join(EVIDENCE, "preview-bambu.png"),
                                full_page=True)
                record("screenshot preview-bambu.png: preview, reels and the recipe card")
                page.click("#projoptions [data-action='export-spectrum']")
                page.wait_for_function(
                    "() => (document.getElementById('plog') || {}).textContent"
                    ".includes('ready')", timeout=120_000)
                sent = page.evaluate("() => window.__lastExport")
                session = page.evaluate("() => window.state.id")
                out = os.path.join(u1ui._workdir, session + "_U1.3mf")
                record("export sent: " + json.dumps(
                    {"mode": sent.get("mode"), "recipes": sent.get("recipes")}))
                if sent.get("target") and sent["target"] != "bambu":
                    failures.append("the request did not carry the chosen target")
                if not os.path.isfile(out):
                    failures.append("the target export wrote no archive")
                else:
                    with zipfile.ZipFile(out) as z:
                        cfg = json.loads(
                            z.read("Metadata/project_settings.config").decode("utf-8"))
                    leaked = [k for k in u1targets.MACHINE_KEYS if k in cfg]
                    record("bambu archive: %d filaments, mixed=%s, leaked=%s"
                           % (len(cfg.get("filament_colour", [])),
                              cfg.get("filament_is_mixed"),
                              leaked or "none"))
                    if leaked:
                        failures.append("the Bambu export leaked U1 machine settings")

                page.set_input_files("#gcodefile", slicepath)
                page.click("#planbutton")
                page.wait_for_function("() => window.__plan", timeout=60_000)
                plan = page.evaluate("() => window.__plan")
                record("plan: " + json.dumps(plan))
                if not plan.get("feasible"):
                    failures.append("the planner refused a file it should plan")
                if plan.get("reel_changes") != 1:
                    failures.append("expected one reel change, got "
                                    + str(plan.get("reel_changes")))
                downloads = page.eval_on_selector_all(
                    "#plandownloads a", "els => els.map(e => e.getAttribute('download'))")
                record("plan downloads: " + json.dumps(downloads))
                if len(downloads) != 2:
                    failures.append("the plan did not offer both downloads")

                # A sliced 3MF holds the toolpath as a member.  The page must ask
                # which member to read instead of picking the first one (and it used
                # to fail outright, because nothing wired the chooser up).
                sliced = os.path.join(work, "sliced.3mf")
                with zipfile.ZipFile(sliced, "w", zipfile.ZIP_DEFLATED) as z:
                    z.writestr("Metadata/Slic3r_PE_model.config", "<config/>")
                    z.writestr("3D/3dmodel.model", "<model/>")
                    z.writestr("Metadata/plate_1.gcode",
                               GCODE_HEADER + "".join(layer(i, 0.2 * (i + 1), [(i, 1.0)])
                                                      for i in range(5)))
                    z.writestr("Metadata/plate_2.gcode",
                               GCODE_HEADER + "".join(layer(i, 0.2 * (i + 1),
                                                            [(i + 1, 1.0)])
                                                      for i in range(5)))
                page.evaluate("() => { window.__plan = null; }")
                page.set_input_files("#gcodefile", sliced)
                page.click("#planbutton")
                page.wait_for_selector("#gcodepick:not(.hidden)", timeout=30_000)
                members = page.eval_on_selector_all(
                    "#gcodememberlist option", "els => els.map(e => e.value)")
                record("sliced 3MF members offered: " + json.dumps(members))
                if len(members) != 2:
                    failures.append("the sliced 3MF did not offer both G-code members")
                if page.evaluate("() => document.querySelector('#gcodefile')"
                                 ".getAttribute('data-member')"):
                    failures.append("a member was chosen without the user choosing one")
                page.select_option("#gcodememberlist", "Metadata/plate_2.gcode")
                page.wait_for_function("() => window.__plan", timeout=60_000)
                chosen = page.evaluate("() => window.__plan")
                record("plan of the chosen member: " + json.dumps(chosen))
                if not chosen.get("feasible"):
                    failures.append("the chosen G-code member produced no plan")
                browser.close()
        finally:
            httpd.shutdown()

    record("RESULT: " + ("FAILED - " + "; ".join(failures) if failures
                         else "PASS - preview, target export and plan all checked"))
    record.save()
    print("RESULT: " + ("FAILED - " + "; ".join(failures) if failures else "PASS"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
