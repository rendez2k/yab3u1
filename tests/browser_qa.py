#!/usr/bin/env python3
"""Browser QA for the local page, against the user's real examples.

    python tests/browser_qa.py                 # screenshots into the evidence folder
    python tests/browser_qa.py --headed        # watch it happen

It starts the real server on loopback, drives it with Playwright's bundled
Chromium, and leaves the screenshots and a transcript in
``docs/agent-work/colour-assessment/evidence``.  Nothing is sent anywhere: the
page, the server and the browser are all on this machine.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import threading
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import u1convert as u1
import u1ui

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(HERE, "docs", "agent-work", "colour-assessment", "evidence")

DESKTOP = r"C:\Users\rende\Desktop"
D_DRIVE = r"D:\3D"
BLOB = os.path.join(DESKTOP, "5 colour test-Blob Lab_Monsters V1.3mf")
FULL_BLOB = os.path.join(D_DRIVE, "Blob Lab_Monsters V1.3mf")
WOOKIE = os.path.join(D_DRIVE, "Hex3D_WookieMonster_Color",
                      "Hex3D_WookieMonster_Full_Bambu_5Color.3mf")
ALIEN = os.path.join(DESKTOP, "They live alien_5 colors.3mf")


class Recorder:
    def __init__(self, path):
        self.path = path
        self.lines = []

    def __call__(self, message):
        stamp = time.strftime("%H:%M:%S")
        self.lines.append(f"[{stamp}] {message}")
        print(f"[{stamp}] {message}", flush=True)
        try:                       # keep the transcript even if the run dies
            with open(self.path, "w", encoding="utf-8") as fh:
                fh.write("\n".join(self.lines) + "\n")
        except OSError:
            pass

    def save(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(self.lines) + "\n")


def start_server(profile_root):
    u1ui._workdir = tempfile.mkdtemp(prefix="u1ui-qa-")
    u1ui._profile_root = profile_root
    httpd = u1ui.ThreadingHTTPServer(("127.0.0.1", 0), u1ui.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def wait_for_log(page, needle, timeout=240_000):
    page.wait_for_function(
        "([sel, text]) => { const el = document.querySelector(sel); "
        "return el && el.textContent.includes(text); }",
        arg=["#plog", needle], timeout=timeout)


# What the page is showing: each reel, and each source colour's chosen slot plus the
# "Exported as" value, so a test can compare them with what was actually sent.
_PROBE = """() => {
  const reels = [...document.querySelectorAll('#reels .reel')].map(wrap => ({
    color: wrap.querySelector('input[type=color]').value.toUpperCase(),
    type: wrap.querySelector('select').value,
  }));
  const rows = [...document.querySelectorAll('#maptable tbody tr')].map(tr => {
    const cells = tr.querySelectorAll('td');
    const select = cells[2].querySelector('select');
    return {
      source: parseInt(cells[0].textContent.replace(/\\D+/g, ''), 10),
      slot: select ? parseInt(select.value, 10) : null,
      original: (cells[1].textContent || '').trim().toUpperCase(),
      result: (cells[3].textContent || '').trim().toUpperCase(),
    };
  });
  return { reels: reels, rows: rows,
           checked: !!(document.querySelector('#assessment input[type=checkbox]') || {}).checked };
}"""


# The mapping table is only "current" once every row's exported colour equals the
# reel of the slot it names; a plan response is asynchronous, so wait for that.
_RESULTS_MATCH_REELS = """() => {
  const reels = [...document.querySelectorAll('#reels input[type=color]')]
    .map(input => input.value.toUpperCase());
  const rows = [...document.querySelectorAll('#maptable tbody tr')];
  if (!rows.length) return false;
  return rows.every(tr => {
    const cells = tr.querySelectorAll('td');
    const select = cells[2].querySelector('select');
    if (!select) return false;
    const slot = parseInt(select.value, 10);
    const shown = (cells[3].textContent || '').trim().toUpperCase();
    return shown === reels[slot - 1];
  });
}"""


def self_check(picked, failures):
    """Every displayed result must be the colour of the slot it claims."""
    for row in picked["rows"]:
        if row["slot"] is None:
            continue
        shown = picked["reels"][row["slot"] - 1]["color"]
        if row["result"] != shown:
            failures.append(f"colour {row['source']} is displayed as {row['result']} but "
                            f"slot {row['slot']} holds {shown}")


def snapshot(page, record, name, note):
    path = os.path.join(EVIDENCE, name)
    page.screenshot(path=path, full_page=True)
    record(f"screenshot {name}: {note}")
    return path


def run(args):
    os.makedirs(EVIDENCE, exist_ok=True)
    record = Recorder(os.path.join(EVIDENCE, "browser-qa.txt"))
    profile_root = u1.find_profile_root()
    record(f"Orca profiles: {profile_root}")
    httpd, url = start_server(profile_root)
    record(f"local UI on {url}")

    from playwright.sync_api import sync_playwright

    failures = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not args.headed)
            page = browser.new_page(viewport={"width": 1280, "height": 1000})
            console = []
            page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}"))
            page.on("pageerror", lambda exc: console.append(f"pageerror: {exc}"))
            page.goto(url)
            record(f"page title: {page.title()}")

            # ---- the multi-object file ------------------------------------------
            if os.path.isfile(BLOB):
                page.set_input_files("#file", BLOB)
                page.wait_for_selector("#project:not(.hidden)", timeout=120_000)
                page.wait_for_selector("#assessment .opt", timeout=120_000)
                plates = page.inner_text("#plate")
                record(f"plates offered: {plates!r}")
                boxes = page.eval_on_selector_all(
                    "input[data-object]", "els => els.map(e => e.getAttribute('data-object'))")
                record(f"objects listed: {boxes}")
                if boxes != ["11", "24"]:
                    failures.append(f"expected the two Blob objects, saw {boxes}")
                snapshot(page, record, "01-project-plates-objects.png",
                         "Blob project: plate, objects and their colours")

                # uncheck the second object and watch the assessment narrow
                page.uncheck('input[data-object="24"]')
                page.wait_for_timeout(1500)
                used = page.inner_text("#pfacts")
                record("assessment after deselecting the second object: " +
                       " ".join(used.split())[:200])
                if "colours used 4" not in " ".join(used.split()):
                    failures.append("the four-colour selection was not reported as four")

                # the mapping table shows the suggestion and the result
                row = page.inner_text("#maptable")
                record("mapping table: " + " ".join(row.split())[:220])
                if "slot" not in row:
                    failures.append("no mapping table was rendered")

                # the displayed result must be the reel the page is showing, not a
                # stale server default (this is what went wrong in the first build)
                picked = page.evaluate(_PROBE)
                record("displayed mapping: " + json.dumps(picked)[:300])
                self_check(picked, failures)

                # edit a loaded reel and confirm the page re-plans from that colour
                page.eval_on_selector_all(
                    "#reels input[type=color]",
                    "els => { els[3].value = '#ff0000'; "
                    "els[3].dispatchEvent(new Event('input', {bubbles: true})); }")
                page.wait_for_function(_RESULTS_MATCH_REELS, timeout=120_000)
                picked = page.evaluate(_PROBE)
                record("after editing slot 4 to #FF0000: " + json.dumps(picked)[:300])
                self_check(picked, failures)
                if picked["reels"][3]["color"] != "#FF0000":
                    failures.append("the edited reel is not shown in slot 4")
                asked = page.evaluate("() => window.__lastPlan || null")
                if not asked or asked["filaments"][3]["color"] != "#FF0000":
                    failures.append("the page did not re-plan with the edited reel")
                # changing a reel must clear the approval tick
                if page.is_checked("#assessment input[type=checkbox]"):
                    failures.append("the substitution tick survived a reel change")
                snapshot(page, record, "02-mapping.png",
                         "mapping table with original, suggestion and result")

                # direct export of the four-colour object
                page.click('[data-action="export-direct"]')
                page.wait_for_function("() => window.__lastExport !== null", timeout=30_000)
                sent = page.evaluate("() => window.__lastExport")
                wait_for_log(page, "output")
                log = page.inner_text("#plog")
                record("direct export log: " + " | ".join(log.splitlines()[-4:]))
                if "verified against the source" not in log:
                    failures.append("the direct export did not report its checks")
                if "mode : direct" not in log:
                    failures.append("the direct export did not keep the source colours")
                if not page.is_visible("#psave"):
                    failures.append("no download link appeared after the export")
                record("actually sent: " + json.dumps(sent)[:300])
                if not sent or sent["mode"] != "direct" or sent["mapping"] is not None:
                    failures.append("the direct export sent a mapping instead of the "
                                    "source colours")
                if page.is_checked("#verify"):
                    failures.append("the slice check was on by default in project mode")
                snapshot(page, record, "03-direct-export.png",
                         "direct export of the four-colour object")

            # ---- a five-colour file, and the explicit approximation -------------
            if os.path.isfile(WOOKIE):
                page.click("#again")
                page.set_input_files("#file", WOOKIE)
                page.wait_for_selector("#assessment .opt", timeout=180_000)
                text = page.inner_text("#assessment")
                record("WookieMonster options: " + " ".join(text.split())[:300])
                if "Direct four-slot print (not available)" not in text:
                    failures.append("a five-colour file did not report direct as unavailable")
                if page.is_checked("#assessment input[type=checkbox]"):
                    failures.append("the substitution tick carried over from the previous file")
                snapshot(page, record, "04-five-colours-options.png",
                         "five-colour file: what is and is not offered")

                page.check("#assessment input[type=checkbox]")
                page.wait_for_timeout(600)
                page.wait_for_function(_RESULTS_MATCH_REELS, timeout=120_000)
                before = page.evaluate(_PROBE)
                self_check(before, failures)
                page.evaluate("() => { window.__lastExport = null; }")
                page.click('[data-action="export-approximate"]')
                page.wait_for_function(
                    "() => window.__lastExport && window.__lastExport.mode === 'approximate'",
                    timeout=60_000)
                wait_for_log(page, "output", timeout=300_000)
                log = page.inner_text("#plog")
                record("approximation export log: " + " | ".join(log.splitlines()[-4:]))
                if "colours are substituted" not in log:
                    failures.append("the approximation did not say it substituted colours")
                sent = page.evaluate("() => window.__lastExport || null")
                record("actually sent: " + json.dumps(sent)[:300])
                if not sent or sent["mode"] != "approximate" or not sent["mapping"]:
                    failures.append("the approximation did not send the reviewed mapping")
                else:
                    for row in before["rows"]:
                        shown = before["reels"][row["slot"] - 1]["color"]
                        if sent["filaments"][row["slot"] - 1]["color"] != shown:
                            failures.append("the reels sent do not match the reels shown")
                            break
                snapshot(page, record, "05-approximation-export.png",
                         "explicit approximation export of the five-colour model")

            # ---- the four-plate file: the plate selector drives everything ------
            if args.full and os.path.isfile(FULL_BLOB):
                page.click("#again")
                page.set_input_files("#file", FULL_BLOB)
                page.wait_for_selector("#assessment .opt", timeout=300_000)
                names = page.inner_text("#plate")
                record("Blob plates: " + " ".join(names.split()))
                if "Monster Multicolor" not in names or "Accessories" not in names:
                    failures.append("the four plate names were not offered")
                options = page.eval_on_selector(
                    "#plate", "el => [...el.options].map(o => o.textContent)")
                page.select_option("#plate", index=len(options) - 1)
                page.wait_for_function(
                    "() => (document.querySelector('#pfacts')?.innerText || '')"
                    ".replace(/\\s+/g, ' ').includes('colours used 4 of 12')",
                    timeout=300_000)
                facts = " ".join(page.inner_text("#pfacts").split())
                record("after switching to Accessories: " + facts[:200])
                if "colours used 4 of 12" not in facts:
                    failures.append("the Accessories plate was not assessed as four colours")
                snapshot(page, record, "08-plate-selection.png",
                         "switching plates re-assesses and re-scopes the export")

            # ---- a Prusa file with sub-divided paint ----------------------------
            if os.path.isfile(ALIEN):
                page.click("#again")
                page.set_input_files("#file", ALIEN)
                page.wait_for_selector("#assessment .opt", timeout=240_000)
                notes = page.inner_text("#assesswarn")
                record("alien warnings: " + " ".join(notes.split())[:300])
                snapshot(page, record, "06-subdivided-paint.png",
                         "Prusa file with sub-divided paint and support painting")

            # ---- error state -----------------------------------------------------
            page.click("#again")
            bad = os.path.join(tempfile.gettempdir(), "not-a-project.3mf")
            with open(bad, "wb") as fh:
                fh.write(b"this is not a zip archive")
            page.set_input_files("#file", bad)
            page.wait_for_selector("#log:not(.hidden)", timeout=30_000)
            message = page.inner_text("#log")
            record(f"error state: {message.strip()!r}")
            snapshot(page, record, "07-error-state.png", "a non-3MF file, explained")

            if console:
                record("console/page errors: " + json.dumps(console[:10]))
                failures.extend([c for c in console if c.startswith("pageerror")])
            browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()

    record(f"result: {'FAILED' if failures else 'ok'}")
    for failure in failures:
        record(f"  failure: {failure}")
    record.save()
    return 1 if failures else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Browser QA for the local U1 page.")
    ap.add_argument("--headed", action="store_true", help="show the browser")
    ap.add_argument("--full", action="store_true",
                    help="also drive the four-plate Blob (slower)")
    args = ap.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
