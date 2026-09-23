#!/usr/bin/env python3
"""One short browser flow over the Full Spectrum card, on a synthetic project.

    python tests/spectrum_browser_qa.py

It starts the real local server on loopback, drives the real page with
Playwright's Chromium, ticks the reviewed recipes, exports, and checks both the
payload the page sent and the archive the server wrote.  Nothing is uploaded
anywhere and no slicer is started.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import u1spectrum                                             # noqa: E402
import u1ui                                                   # noqa: E402
from tests import fixtures                                    # noqa: E402
from tests.browser_qa import Recorder, start_server           # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(HERE, "docs", "agent-work", "colour-strategy", "evidence")
MIXING_REELS = [{"color": "#FFFFFF", "type": "PLA"}, {"color": "#000000", "type": "PLA"},
                {"color": "#FF9500", "type": "PLA"}, {"color": "#FF0080", "type": "PLA"}]


def run() -> int:
    os.makedirs(EVIDENCE, exist_ok=True)
    record = Recorder(os.path.join(EVIDENCE, "browser-spectrum.txt"))
    failures: list = []

    with tempfile.TemporaryDirectory(prefix="u1spectrum-ui-") as work:
        src = os.path.join(work, "five-colours.3mf")
        fixtures.two_plate_project(src, five_colours=True)
        httpd, url = start_server(None)
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                page = browser.new_page(viewport={"width": 1180, "height": 900})
                page.add_init_script(
                    "localStorage.setItem('yab3u1-reels', %s)"
                    % json.dumps(json.dumps(MIXING_REELS)))
                page.goto(url)
                page.set_input_files("#file", src)
                page.wait_for_selector("#assessment .opt", timeout=60_000)
                # The inherited plate-switch defect: choosing another plate must
                # re-render the object list and the assessment, not stall.
                page.select_option("#plate", index=1)
                page.wait_for_function(
                    "() => document.querySelectorAll('#objects label').length > 0",
                    timeout=60_000)
                page.wait_for_timeout(1200)
                names = page.eval_on_selector_all(
                    "#objects label pre, #objects label span",
                    "els => els.slice(0, 2).map(e => e.textContent.trim().slice(0, 30))")
                record("plate 2 objects: " + json.dumps(names))
                if not names:
                    failures.append("switching to plate 2 rendered no objects")
                page.select_option("#plate", index=0)
                page.wait_for_function(
                    "() => window.__lastPlan && (window.__lastPlan.spectrum || []).length",
                    timeout=60_000)
                page.wait_for_function(
                    "() => window.__lastPlan && (window.__lastPlan.spectrum || []).length",
                    timeout=60_000)
                planned = page.evaluate("() => window.__lastPlan.spectrum")
                record("planned recipes: " + json.dumps(planned))
                if not planned:
                    failures.append("the page planned no recipes")

                page.wait_for_selector("#projoptions .reciperows li", timeout=30_000)
                rows = page.eval_on_selector_all(
                    "#projoptions .reciperows li input[data-recipe]",
                    "els => els.map(e => e.getAttribute('data-recipe'))")
                record("recipe checkboxes on the card: " + json.dumps(rows))
                if not rows:
                    failures.append("the Full Spectrum card offered no recipe rows")

                page.check("#projoptions [data-action='review-spectrum']")
                page.screenshot(path=os.path.join(EVIDENCE, "spectrum-card.png"),
                                full_page=True)
                record("screenshot spectrum-card.png: the mixture comparison and recipes")

                # Unticking a recipe must clear the review, disable the export and
                # renumber what is left -- never leave a stale id on screen.
                page.uncheck("#projoptions .reciperows input[data-recipe]")
                page.wait_for_timeout(200)
                disabled = page.eval_on_selector(
                    "#projoptions [data-action='export-spectrum']", "el => el.disabled")
                review_state = page.eval_on_selector(
                    "#projoptions [data-action='review-spectrum']", "el => el.checked")
                chosen = page.eval_on_selector_all(
                    "#projoptions td[data-source]",
                    "els => els.map(e => e.textContent.trim()).slice(0, 2)")
                record("after unticking: export disabled=%s, review ticked=%s, rows=%s"
                       % (disabled, review_state, json.dumps(chosen)))
                if not disabled:
                    failures.append("the export stayed enabled after a recipe was unticked")
                if review_state:
                    failures.append("the review tick stayed set after a recipe changed")
                if any("blend" in text for text in chosen):
                    failures.append("a removed recipe is still shown as chosen")
                page.check("#projoptions .reciperows input[data-recipe]")
                page.check("#projoptions [data-action='review-spectrum']")
                page.wait_for_timeout(200)

                page.click("#projoptions [data-action='export-spectrum']")
                page.wait_for_function("() => window.__lastExport !== null", timeout=30_000)
                sent = page.evaluate("() => window.__lastExport")
                record("actually sent: " + json.dumps(
                    {"mode": sent.get("mode"), "recipes": sent.get("recipes"),
                     "mapping": sent.get("mapping")}))
                if sent.get("mode") != "spectrum":
                    failures.append("the page did not ask for a spectrum export")
                if not sent.get("recipes"):
                    failures.append("the page sent no recipes")
                if 5 not in set((sent.get("mapping") or {}).values()):
                    failures.append("the sent mapping does not point at the mixture id")

                page.wait_for_function(
                    "() => (document.getElementById('plog') || {}).textContent"
                    ".includes('ready')", timeout=120_000)
                session = page.evaluate("() => state.id")
                out = os.path.join(u1ui._workdir, session + "_U1.3mf")
                record("output: " + out)
                if not os.path.isfile(out):
                    failures.append("the server wrote no output archive")
                else:
                    with zipfile.ZipFile(out) as z:
                        cfg = json.loads(
                            z.read("Metadata/project_settings.config").decode("utf-8"))
                        model = z.read("3D/3dmodel.model").decode("utf-8")
                        custom = [r for r in
                                  cfg.get("mixed_filament_definitions", "").split(";")
                                  if r.split(",")[2:4] == ["1", "1"]]
                        record("archive: %d filaments, %d recipe rows, application %s"
                               % (len(cfg.get("filament_colour", [])), len(custom),
                                  "ok" if u1spectrum.APPLICATION in model else "MISSING"))
                        if len(custom) != len(sent.get("recipes") or []):
                            failures.append("the archive does not carry the recipes sent")
                        if u1spectrum.APPLICATION not in model:
                            failures.append("the archive lost the application metadata")
                browser.close()
        finally:
            httpd.shutdown()

    record("RESULT: " + ("FAILED - " + "; ".join(failures) if failures
                         else "PASS - card, payload and archive all checked"))
    record.save()
    print("RESULT: " + ("FAILED - " + "; ".join(failures) if failures else "PASS"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
