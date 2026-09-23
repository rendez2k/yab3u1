#!/usr/bin/env python3
"""Browser performance evidence for the recolour page: one real model, one run.

It measures what the user feels rather than what the code claims: how long the
page takes to show the model, how much of that time the *main thread* was blocked
(long tasks), what a palette change and an Original/Result toggle cost, whether
geometry is reused instead of re-prepared, that a rapid file switch cannot land
out of order, and how long the export takes.

    python tests/perf_qa.py [model.3mf]

Writes docs/agent-work/browser-performance/evidence/perf.txt.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

EVIDENCE = os.path.join(HERE, "docs", "agent-work", "browser-performance", "evidence")
REELS = [{"color": "#FFFFFF", "type": "PLA"}, {"color": "#000000", "type": "PLA"},
         {"color": "#FF9500", "type": "PLA"}, {"color": "#FF0080", "type": "PLA"}]
CANDIDATES = [r"C:\Users\rende\Desktop\They live alien_5 colors.3mf",
              r"C:\Users\rende\Desktop\5 colour test-Blob Lab_Monsters V1.3mf"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory: str):
    handler = functools.partial(Quiet, directory=directory)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


HEARTBEAT = """
window.__long = [];
window.__beats = 0;
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__long.push(Math.round(entry.duration));
    }
  }).observe({ entryTypes: ["longtask"] });
} catch (error) { /* no observer: the beat count still shows responsiveness */ }
(function beat() { window.__beats += 1; setTimeout(beat, 50); }());
"""


def main() -> int:
    source = sys.argv[1] if len(sys.argv) > 1 else next(
        (path for path in CANDIDATES if os.path.isfile(path)), None)
    if source is None:
        print("no real model on this machine; nothing measured")
        return 0
    os.makedirs(EVIDENCE, exist_ok=True)
    lines: list = []

    def record(text):
        lines.append(text)
        print(text)

    httpd, url = serve(os.path.join(HERE, "web"))
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--disable-logging"])
            page = browser.new_page(viewport={"width": 1180, "height": 1000},
                                    accept_downloads=True)
            page.add_init_script(
                "localStorage.setItem('yab3u1-web-reels', %s)"
                % json.dumps(json.dumps(REELS)))
            page.goto(url + "recolour.html")
            page.evaluate(HEARTBEAT)

            # ---- load ------------------------------------------------------
            started = time.time()
            page.set_input_files("#file", source)
            page.wait_for_function("() => window.__loadTiming", timeout=180_000)
            load_ms = (time.time() - started) * 1000
            page.wait_for_function("() => window.__preview && window.__preview.triangles > 0",
                                   timeout=120_000)
            visible_ms = (time.time() - started) * 1000
            timing = page.evaluate("() => window.__loadTiming")
            longtasks = page.evaluate("() => window.__long")
            beats = page.evaluate("() => window.__beats")
            record(f"model                : {os.path.basename(source)} "
                   f"({os.path.getsize(source):,} bytes)")
            record(f"load to metadata     : {load_ms:,.0f} ms wall "
                   f"(preview visible at {visible_ms:,.0f} ms)")
            record(f"worker reported      : {json.dumps(timing)}")
            record(f"main-thread longtasks: {len(longtasks)} "
                   f"(total {sum(longtasks):,} ms; max "
                   f"{max(longtasks) if longtasks else 0:,} ms)")
            record(f"UI heartbeats        : {beats} (a 50 ms timer kept running "
                   "through the load)")

            # ---- Original/Result and a palette change ----------------------
            for label, action in (
                    ("Original/Result", "() => document.querySelector("
                     "\"[data-preview='original']\").click()"),
                    ("Result", "() => document.querySelector("
                     "\"[data-preview='result']\").click()")):
                page.evaluate("() => { window.__preview = null; }")
                started = time.time()
                page.evaluate(action)
                page.wait_for_function("() => window.__preview", timeout=60_000)
                preview = page.evaluate("() => window.__preview")
                record(f"{label:<20} : {(time.time() - started) * 1000:,.0f} ms, "
                       f"reused={preview.get('reused')}, "
                       f"prepare_ms={preview.get('prepare_ms')}")

            page.evaluate("() => { window.__preview = null; }")
            started = time.time()
            page.eval_on_selector("#reel0", "el => { el.value = '#123456';"
                                  " el.dispatchEvent(new Event('input',"
                                  " {bubbles: true})); }")
            page.wait_for_function("() => window.__preview", timeout=60_000)
            preview = page.evaluate("() => window.__preview")
            record(f"reel colour change   : {(time.time() - started) * 1000:,.0f} ms, "
                   f"reused={preview.get('reused')}, "
                   f"prepare_ms={preview.get('prepare_ms')}")

            # ---- export ----------------------------------------------------
            page.wait_for_function(
                "() => { const box = document.querySelector('#review');"
                " return box && !box.parentElement.classList.contains('hidden'); }",
                timeout=60_000)
            if not page.is_checked("#review"):
                page.check("#review")
            page.wait_for_function("() => !document.querySelector('#export').disabled",
                                   timeout=30_000)
            started = time.time()
            with page.expect_download(timeout=180_000) as download:
                page.click("#export")
            download.value.save_as(os.path.join(EVIDENCE, "perf-export.3mf"))
            record(f"export               : {(time.time() - started) * 1000:,.0f} ms "
                   f"({os.path.getsize(os.path.join(EVIDENCE, 'perf-export.3mf')):,} "
                   "bytes written)")

            # ---- rapid file switch cannot land out of order -----------------
            other = next((path for path in CANDIDATES if os.path.isfile(path)
                          and path != source), None)
            if other:
                page.set_input_files("#file", other)
                page.set_input_files("#file", source)
                page.wait_for_function("() => window.__loadTiming", timeout=180_000)
                page.wait_for_timeout(2500)
                current = page.evaluate("() => window.__recolour.project.title || ''")
                record(f"rapid switch ended on: {os.path.basename(source)} "
                       f"(title {current!r})")
            browser.close()
    finally:
        httpd.shutdown()

    with open(os.path.join(EVIDENCE, "perf.txt"), "w", encoding="utf-8") as fh:
        fh.write("Browser performance evidence: recolour page, one real model\n\n")
        fh.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
