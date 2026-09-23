#!/usr/bin/env python3
"""Bounded plate-switch check on the real multi-plate example.

    python tests/plate_switch_qa.py

The earlier browser run stalled when switching to the Accessories plate, so this
walks every plate of the Blob file once and records how long each render took.
No export, no slicer.
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.browser_qa import BLOB, FULL_BLOB, Recorder, start_server   # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(HERE, "docs", "agent-work", "colour-strategy", "evidence")


def main() -> int:
    os.makedirs(EVIDENCE, exist_ok=True)
    record = Recorder(os.path.join(EVIDENCE, "plate-switch.txt"))
    failures: list = []
    targets = [(BLOB, "one plate: the selector must stay disabled"),
               (FULL_BLOB, "four plates: every one must render")]
    targets = [(path, note) for path, note in targets if os.path.isfile(path)]
    if not targets:
        record("no real example is on this machine")
        record.save()
        return 0

    httpd, url = start_server(None)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1180, "height": 900})
            for path, note in targets:
                page.goto(url)
                started = time.time()
                page.set_input_files("#file", path)
                page.wait_for_selector("#assessment .opt", timeout=300_000)
                count = page.eval_on_selector_all("#plate option", "els => els.length")
                disabled = page.eval_on_selector("#plate", "el => el.disabled")
                record("%s -- %s: %d plate(s), selector %s, opened in %.1fs"
                       % (os.path.basename(path), note, count,
                          "disabled" if disabled else "enabled", time.time() - started))
                if count < 2:
                    if not disabled:
                        failures.append("%s: one plate but the selector is enabled" % path)
                    continue
                for index in range(count):
                    mark = time.time()
                    page.select_option("#plate", index=index)
                    label = page.eval_on_selector_all(
                        "#plate option", "(els, i) => els[i].textContent", index)
                    try:
                        page.wait_for_function(
                            "() => document.querySelectorAll('#objects label').length > 0",
                            timeout=90_000)
                        page.wait_for_function(
                            "() => document.querySelectorAll('#assessment .opt').length > 0",
                            timeout=90_000)
                        page.wait_for_timeout(600)
                        names = page.eval_on_selector_all(
                            "#objects label span",
                            "els => els.slice(0, 3).map(e => e.textContent.trim().slice(0, 24))")
                        record("plate %d %r rendered in %.1fs: %s"
                               % (index + 1, label.strip(), time.time() - mark,
                                  json.dumps(names)))
                    except Exception as exc:                    # noqa: BLE001
                        failures.append("plate %d (%s): %s"
                                        % (index + 1, label.strip(), type(exc).__name__))
                        record("plate %d %r STALLED after %.1fs (%s)"
                               % (index + 1, label.strip(), time.time() - mark,
                                  type(exc).__name__))
                        break
            browser.close()
    finally:
        httpd.shutdown()

    record("RESULT: " + ("FAILED - " + "; ".join(failures) if failures
                         else "PASS - every plate rendered"))
    record.save()
    print("RESULT: " + ("FAILED - " + "; ".join(failures) if failures else "PASS"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
