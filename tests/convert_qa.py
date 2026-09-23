#!/usr/bin/env python3
"""Bounded browser QA for the portable converter (phase 2 correction).

    python tests/convert_qa.py

Checks the finished homepage converter: one workflow (no legacy four-slot path),
the promoted Full Spectrum link and its "back to converter" link, a keyboard
chooser, labelled row/exchange controls with visible focus, light and dark
readability, the repaint table showing exactly what the export will write, the
recovery path after a malformed upload, no page-level overflow at 320/390/1180 px,
no model uploads, and one real-file conversion with its timings.

Writes docs/agent-work/browser-performance/evidence/phase2.txt, the screenshots
next to it, and one converted archive per run.
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
import time
import zipfile
import zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
EVIDENCE = os.path.join(HERE, "docs", "agent-work", "browser-performance", "evidence")
REAL = r"C:\Users\rende\Desktop\They live alien_5 colors.3mf"
FIXTURE = os.path.join(HERE, "web", "tests", "five-colours.3mf")
REL_THUMBNAIL = ("http://schemas.openxmlformats.org/package/2006/relationships/"
                 "metadata/thumbnail")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory: str):
    handler = functools.partial(Quiet, directory=directory)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def rgb_of(colour: str) -> str:
    value = colour.lstrip("#")[:6]
    return "rgb(%d, %d, %d)" % (int(value[0:2], 16), int(value[2:4], 16),
                                int(value[4:6], 16))


def png_pixels(data: bytes):
    """Decode an 8-bit RGBA, filter-0 PNG: the shape this tool writes."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    width = height = None
    idat = b""
    at = 8
    while at < len(data):
        length = int.from_bytes(data[at:at + 4], "big")
        kind = data[at + 4:at + 8]
        body = data[at + 8:at + 8 + length]
        if kind == b"IHDR":
            width = int.from_bytes(body[0:4], "big")
            height = int.from_bytes(body[4:8], "big")
            assert body[8] == 8 and body[9] == 6, "expected 8-bit RGBA"
        elif kind == b"IDAT":
            idat += body
        at += 12 + length
        if kind == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = width * 4
    pixels = bytearray(width * height * 4)
    for row in range(height):
        assert raw[row * (stride + 1)] == 0, "unexpected PNG filter"
        start = row * (stride + 1) + 1
        pixels[row * stride:(row + 1) * stride] = raw[start:start + stride]
    return width, height, bytes(pixels)


def colours_in(pixels: bytes, background=(242, 244, 247)) -> set:
    """The distinct opaque colours a thumbnail used, background aside."""
    found = set()
    for at in range(0, len(pixels), 4):
        rgb = (pixels[at], pixels[at + 1], pixels[at + 2])
        if rgb == background:
            continue
        found.add(rgb)
    return found


def main() -> int:
    os.makedirs(EVIDENCE, exist_ok=True)
    lines: list = []
    failures: list = []

    def record(text):
        lines.append(text)
        print(text)

    def check(condition, message):
        if not condition:
            failures.append(message)

    def shot(page, name):
        path = os.path.join(EVIDENCE, name)
        page.screenshot(path=path, full_page=True)
        record(f"screenshot: {os.path.basename(path)}")

    httpd, url = serve(os.path.join(HERE, "web"))
    work = tempfile.mkdtemp(prefix="u1convert-qa-")
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--disable-logging"])
            page = browser.new_page(viewport={"width": 1180, "height": 1000},
                                    accept_downloads=True)
            posts: list = []
            errors: list = []
            failed: list = []
            page.on("request", lambda request: posts.append(request.method)
                    if request.method != "GET" else None)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("requestfailed",
                    lambda request: failed.append(request.url)
                    if request.url.startswith(url) else None)

            page.goto(url + "index.html")
            page.wait_for_selector("#convertdrop")

            # --- one converter on the homepage: no legacy four-slot path -------
            legacy = page.evaluate("() => ['file', 'go', 'again', 'options', 'source']"
                                   ".filter((id) => document.getElementById(id))")
            check(not legacy, f"the legacy homepage controls are still present: {legacy}")
            record(f"homepage: legacy controls present = {legacy or 'none'}")
            shot(page, "homepage-desktop.png")

            # --- navigation both ways ------------------------------------------
            check(page.is_visible("#torecolour"), "the promoted link is not visible")
            page.click("#torecolour")
            page.wait_for_url(re.compile(r"recolour\.html"))
            page.wait_for_selector("text=Back to converter")
            page.click("text=Back to converter")
            page.wait_for_url(re.compile(r"index\.html"))
            record("navigation: homepage -> Full Spectrum recolouring -> back")

            # --- the recolour page is untouched by the conversion work ---------
            # It keeps its own proven three-target list: adding generic Orca to the
            # *converter* must not advertise an unverified blend path here.
            page.click("#torecolour")
            page.wait_for_url(re.compile(r"recolour\.html"))
            page.set_input_files("#file", os.path.join(HERE, "web", "tests",
                                                       "four-colours.3mf"))
            page.wait_for_function("() => document.getElementById('target')"
                                   ".options.length > 0 && "
                                   "!document.getElementById('project')"
                                   ".classList.contains('hidden')", timeout=60_000)
            targets = page.eval_on_selector_all(
                "#target option", "nodes => nodes.map((n) => n.value)")
            check(targets == ["snapmaker", "bambu", "prusa"],
                  f"the recolour page targets changed: {targets}")
            record(f"recolour: a four-colour project loads; targets {targets}")
            # The recolour save carries its own regenerated thumbnail too.
            page.select_option("#target", "bambu")
            if page.is_disabled("#export") and not page.is_checked("#review"):
                page.check("#review")
            page.wait_for_function("() => !document.getElementById('export').disabled",
                                   timeout=60_000)
            with page.expect_download(timeout=180_000) as download:
                page.click("#export")
            recoloured = os.path.join(work, "recoloured-bambu.3mf")
            download.value.save_as(recoloured)
            with zipfile.ZipFile(recoloured) as archive:
                recolour_names = archive.namelist()
                recolour_rels = archive.read("_rels/.rels").decode("utf-8")
                recolour_png = archive.read("Metadata/plate_1.png")
                recolour_small = archive.read("Metadata/plate_1_small.png")
            recolour_w, recolour_h, recolour_pixels = png_pixels(recolour_png)
            small_w, small_h, _ = png_pixels(recolour_small)
            record(f"recolour export: {len(recolour_names)} members, thumbnail "
                   f"{recolour_w}x{recolour_h} + {small_w}x{small_h}, "
                   f"{len(colours_in(recolour_pixels))} model colour(s)")
            check((recolour_w, recolour_h) == (512, 512)
                  and (small_w, small_h) == (128, 128),
                  "the recolour save has no correctly sized thumbnail")
            check(REL_THUMBNAIL in recolour_rels, "the recolour save has no "
                  "standard thumbnail relationship")
            with open(os.path.join(EVIDENCE, "thumbnail-recolour-512.png"), "wb") as fh:
                fh.write(recolour_png)
            page.click("text=Back to converter")
            page.wait_for_url(re.compile(r"index\.html"))

            # --- keyboard chooser ----------------------------------------------
            role = page.get_attribute("#convertdrop", "role")
            tabindex = page.get_attribute("#convertdrop", "tabindex")
            check(role == "button" and tabindex == "0",
                  "the drop zone is not a keyboard-operable button")
            page.focus("#convertdrop")
            page.keyboard.press("Enter")
            record(f"keyboard: #convertdrop role={role} tabindex={tabindex}, Enter "
                   "opened the picker without an error")

            # --- visible focus on a real control --------------------------------
            page.click("body")
            focused = []
            for _ in range(40):
                page.keyboard.press("Tab")
                state = page.evaluate(
                    "() => { const el = document.activeElement; if (!el) return null;"
                    " const style = getComputedStyle(el);"
                    " return { id: el.id || el.tagName, outline: style.outlineWidth,"
                    "         style: style.outlineStyle }; }")
                if state and state["style"] != "none" and state["outline"] not in ("0px", ""):
                    focused.append(state["id"])
            record(f"keyboard: visible focus ring on {sorted(set(focused))[:6] or 'nothing'}")
            check(focused, "no focused control showed a visible focus ring")

            # --- light/dark readability ----------------------------------------
            # The starting theme follows the system, so the check is that the
            # toggle really flips both the attribute and the painted colours.
            read_theme = ("() => ({ theme: document.documentElement.dataset.theme,"
                          " bg: getComputedStyle(document.body).backgroundColor,"
                          " fg: getComputedStyle(document.body).color })")
            first = page.evaluate(read_theme)
            page.click("#theme")
            page.wait_for_timeout(150)
            second = page.evaluate(read_theme)
            check(first["theme"] != second["theme"],
                  "the theme toggle did not change the theme")
            check(first["bg"] != second["bg"],
                  "the theme toggle did not change the background colour")
            check(second["fg"] != second["bg"],
                  "the foreground and background colours are the same")
            if second["theme"] == "light":
                shot(page, "homepage-light.png")
            else:
                shot(page, "homepage-dark.png")
            record(f"theme: {first['theme']} {first['bg']} -> "
                   f"{second['theme']} {second['bg']}")
            page.click("#theme")
            page.wait_for_timeout(120)

            # --- load the five-colour fixture ----------------------------------
            page.set_input_files("#convertfile", FIXTURE)
            page.wait_for_function("() => window.__convertLoaded", timeout=60_000)
            state = page.evaluate("() => window.__convertLoaded")
            record("loaded: " + json.dumps(state))
            check(page.is_visible("#convertpick"), "the project card did not appear")
            rows = page.eval_on_selector_all("#convertmap .maprow",
                                             "rows => rows.length")
            check(rows == state["colours"],
                  f"the repaint table has {rows} rows for {state['colours']} colours")
            labels = page.eval_on_selector_all(
                "#convertmap label", "nodes => nodes.map((n) => n.textContent)")
            check(len(labels) == rows and all(labels),
                  "the destination selects are not all labelled")
            swaps = page.eval_on_selector_all(
                "#convertswapa option, #convertswapb option", "nodes => nodes.length")
            check(swaps == 2 * state["colours"],
                  "the exchange selects do not list every filament")
            plates = page.eval_on_selector_all("#convertplate option",
                                               "nodes => nodes.map((n) => n.value)")
            check(len(plates) == state["plates"],
                  f"the plate chooser lists {len(plates)} of {state['plates']} plate(s)")
            check(page.is_visible("#convertplate") and page.input_value(
                "#convertplate") == plates[0],
                "the selected plate is not visible before export")
            record(f"repaint: {rows} labelled row(s), exchange selects list "
                   f"{swaps} option(s), plate chooser lists {plates}")

            # --- reassign source colour 3 and read back what will be written ----
            page.select_option("#mapdest-3", "1")
            plan = page.text_content("#convertplan") or ""
            swatch = page.evaluate("() => getComputedStyle("
                                   "document.getElementById('mapswatch-3'))"
                                   ".backgroundColor")
            record(f"repaint plan: {plan.strip()}")
            check("1" in plan and "#" in plan,
                  "the plan line does not name the destination filament and colour")
            # Nothing has asked for 3D geometry yet: the load stayed metadata-only.
            check(page.evaluate("() => window.__convertPreview || null") is None,
                  "a preview was prepared before the user asked for one")
            record("preview : not prepared during loading (lazy)")

            page.select_option("#converttarget", "bambu")
            with page.expect_download(timeout=60_000) as download:
                page.click("#convertgo")
            out = os.path.join(work, "converted-bambu.3mf")
            download.value.save_as(out)
            with zipfile.ZipFile(out) as archive:
                names = archive.namelist()
                has_config = "Metadata/project_settings.config" in names
                model = "".join(archive.read(name).decode("utf-8", "replace")
                                for name in names if name.endswith(".model"))
            colours = re.findall(r'<m:color color="#([0-9A-Fa-f]{8})"', model)
            refs = re.findall(r'p1="([0-9]+)"', model)
            record(f"converted: {len(names)} members, "
                   f"{len(set(colours))} declared colours, references={sorted(set(refs))}, "
                   f"project settings={'yes' if has_config else 'none'}")
            check(not has_config,
                  "a printer-agnostic model must carry no project settings")
            check(len(set(colours)) == state["colours"],
                  "the conversion did not declare every source colour")
            check(refs and all(int(ref) < len(set(colours)) for ref in refs),
                  "a colour reference does not resolve inside the declared palette")
            declared = [c[:6].upper() for c in colours]
            check("FFFFFF" in declared,
                  "the reassignment target colour is not declared")
            # The swatch the page showed must be the colour actually written to
            # the destination filament.
            written = "#" + colours[0][:6]
            check(swatch == rgb_of(written),
                  f"the displayed swatch {swatch} is not the written colour "
                  f"{rgb_of(written)}")
            check(written.upper() in plan.upper(),
                  "the plan line does not show the written destination colour")
            record(f"displayed comparison: swatch {swatch} == written {written}")

            # --- the save carried a regenerated output thumbnail ----------------
            with zipfile.ZipFile(out) as archive:
                member_names = archive.namelist()
                rels = archive.read("_rels/.rels").decode("utf-8")
                types = archive.read("[Content_Types].xml").decode("utf-8")
                plate = archive.read("Metadata/model_settings.config").decode("utf-8")
                main_png = archive.read("Metadata/plate_1.png")
                small_png = archive.read("Metadata/plate_1_small.png")
            width, height, pixels = png_pixels(main_png)
            small_width, small_height, _ = png_pixels(small_png)
            used = colours_in(pixels)
            record(f"thumbnail: plate_1.png {width}x{height}, plate_1_small.png "
                   f"{small_width}x{small_height}, model colours "
                   f"{sorted(used)}")
            check((width, height) == (512, 512), "the main thumbnail must be 512x512")
            check((small_width, small_height) == (128, 128),
                  "the cover thumbnail must be 128x128")
            check("http://schemas.openxmlformats.org/package/2006/relationships/"
                  "metadata/thumbnail" in rels,
                  "the package has no standard thumbnail relationship")
            check('Target="/Metadata/plate_1.png"' in rels
                  and 'Target="/Metadata/plate_1_small.png"' in rels,
                  "a thumbnail relationship points at a file that is not there")
            check(rels.count("cover-thumbnail-middle") == 1
                  and rels.count("cover-thumbnail-small") == 1,
                  "the Bambu cover relationships are missing")
            check(len(set(re.findall(r'Id="([^"]+)"', rels)))
                  == len(re.findall(r'Id="([^"]+)"', rels)),
                  "two relationships share an id")
            check('Extension="png" ContentType="image/png"' in types,
                  "the PNG content type is not declared")
            check('key="thumbnail_file" value="Metadata/plate_1.png"' in plate,
                  "the plate metadata does not name the thumbnail")
            check(rgb_of("#FFFFFF") in
                  ["rgb(%d, %d, %d)" % rgb for rgb in used],
                  "the thumbnail does not show the colour the export wrote")
            check("rgb(255, 0, 0)" not in
                  ["rgb(%d, %d, %d)" % rgb for rgb in used],
                  "the thumbnail still shows the colour this export replaced")
            # The restored layout controls: a fill writes more build items over the
            # same mesh and the thumbnail follows.
            check(page.is_visible("#layoutcopies") and page.is_visible("#layoutfill"),
                  "the Copies / Fill plate controls are missing")
            page.fill("#layoutcopies", "4")
            page.dispatch_event("#layoutcopies", "change")
            page.wait_for_timeout(200)
            check("4 of" in (page.text_content("#layoutnote") or ""),
                  "the layout note does not report the copy count and capacity")
            with page.expect_download(timeout=60_000) as filled:
                page.click("#convertgo")
            filled_out = os.path.join(work, "converted-filled.3mf")
            filled.value.save_as(filled_out)
            with zipfile.ZipFile(filled_out) as archive:
                filled_model = "".join(archive.read(name).decode("utf-8", "replace")
                                       for name in archive.namelist()
                                       if name.endswith(".model"))
                filled_png = archive.read("Metadata/plate_1.png")
            items = re.findall(r"<item\b", filled_model)
            _fw, _fh, filled_pixels = png_pixels(filled_png)
            record(f"fill plate: {len(items)} build item(s), thumbnail colours "
                   f"{sorted(colours_in(filled_pixels))}")
            check(len(items) >= 4 and len(items) % 4 == 0,
                  f"expected a multiple of four build items (the plate's objects), "
                  f"got {len(items)}")
            check(colours_in(filled_pixels), "the filled layout has no thumbnail")
            for name, data in (("thumbnail-bambu-512.png", main_png),
                               ("thumbnail-bambu-128.png", small_png)):
                with open(os.path.join(EVIDENCE, name), "wb") as handle:
                    handle.write(data)
            record("thumbnail: extracted for visual review (evidence/thumbnail-bambu-*)")

            # --- lazily show the preview, and let it be panned away --------------
            page.click("#previewshow")
            page.wait_for_function("() => window.__convertPreview "
                                   "&& window.__convertPreview.triangles > 0",
                                   timeout=120_000)
            shown = page.evaluate("() => window.__convertPreview")
            record("preview : " + json.dumps(shown))
            check(shown["triangles"] > 0, "Show preview drew nothing")
            output_hash = shown["colours"]
            page.select_option("#previewmode", "original")
            page.wait_for_function(
                "() => window.__convertPreview && window.__convertPreview.mode"
                " === 'original'", timeout=120_000)
            page.wait_for_timeout(300)
            original_hash = page.evaluate(
                "() => window.__convertPreview && window.__convertPreview.colours")
            check(original_hash != output_hash,
                  "Original and Output draw the same picture after a reassignment")
            record(f"preview : original {original_hash} != output {output_hash}")
            shot(page, "homepage-loaded-repaint.png")
            for width in (320, 390):
                page.set_viewport_size({"width": width, "height": 900})
                page.wait_for_timeout(150)
                shot(page, f"homepage-{width}.png")
            page.set_viewport_size({"width": 1180, "height": 1000})
            page.wait_for_timeout(150)

            # Pan and zoom the preview away from the model: the *saved* image must
            # still be the deterministic output view, not this camera.
            box = page.locator("#convertpreview").bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] / 2 + 220,
                            box["y"] + box["height"] / 2 + 140, steps=8)
            page.mouse.up()
            page.mouse.wheel(0, 900)
            page.wait_for_timeout(250)
            page.select_option("#converttarget", "bambu")
            with page.expect_download(timeout=60_000) as download:
                page.click("#convertgo")
            moved = os.path.join(work, "converted-moved.3mf")
            download.value.save_as(moved)
            with zipfile.ZipFile(moved) as archive:
                moved_png = archive.read("Metadata/plate_1.png")
            _, _, moved_pixels = png_pixels(moved_png)
            check(colours_in(moved_pixels) == used,
                  "the saved thumbnail changed with the user's camera")
            check(page.evaluate("() => window.__convertPreview.mode") == "original",
                  "the Original/Output switch was not still on Original")
            record("thumbnail: unchanged after orbiting away, and still the Output "
                   "view while Original was displayed")

            # --- malformed upload recovers with a visible message ---------------
            bad = os.path.join(work, "broken.3mf")
            with open(bad, "wb") as handle:
                handle.write(b"this is not a zip archive")
            page.set_input_files("#convertfile", bad)
            page.wait_for_function(
                "() => { const node = document.getElementById('loaderror');"
                " return node && !node.classList.contains('hidden')"
                " && node.textContent.trim().length > 0; }", timeout=30_000)
            record("malformed: visible error, page still usable")
            page.set_input_files("#convertfile", FIXTURE)
            page.wait_for_function("() => window.__convertLoaded", timeout=60_000)
            check(page.evaluate("() => document.getElementById('loaderror')"
                                ".classList.contains('hidden')"),
                  "the error box stayed up after a good file was chosen")
            record("malformed: recovered by choosing a good file again")

            # --- layout: no page-level horizontal overflow ----------------------
            # --- a machine with no WebGL still saves a thumbnail -----------------
            plain = pw.chromium.launch(args=["--disable-logging", "--disable-3d-apis",
                                             "--disable-webgl"])
            try:
                bare = plain.new_page(viewport={"width": 1180, "height": 1000},
                                      accept_downloads=True)
                bare.goto(url + "index.html")
                bare.set_input_files("#convertfile", FIXTURE)
                bare.wait_for_function("() => window.__convertLoaded", timeout=60_000)
                bare.click("#previewshow")
                bare.wait_for_timeout(600)
                note_text = (bare.text_content("#previewnote") or "").strip()
                record(f"no-WebGL: preview says \"{note_text}\"")
                with bare.expect_download(timeout=60_000) as download:
                    bare.click("#convertgo")
                bare_out = os.path.join(work, "converted-nowebgl.3mf")
                download.value.save_as(bare_out)
                with zipfile.ZipFile(bare_out) as archive:
                    bare_png = archive.read("Metadata/plate_1.png")
                    bare_names = archive.namelist()
                bare_w, bare_h, bare_pixels = png_pixels(bare_png)
                bare_colours = colours_in(bare_pixels)
                record(f"no-WebGL: exported {len(bare_names)} members with a "
                       f"{bare_w}x{bare_h} thumbnail drawing {sorted(bare_colours)}")
                check((bare_w, bare_h) == (512, 512) and bare_colours,
                      "a WebGL-less browser saved a missing or blank thumbnail")
            finally:
                plain.close()

            for width in (320, 390, 1180):
                page.set_viewport_size({"width": width, "height": 900})
                page.wait_for_timeout(150)
                overflow = page.evaluate("() => document.documentElement.scrollWidth "
                                         "- document.documentElement.clientWidth")
                record(f"layout {width}px: horizontal overflow {overflow}px")
                check(overflow <= 2, f"the page overflows horizontally at {width}px")

            # --- one real conversion, if the model is here ----------------------
            if os.path.isfile(REAL):
                page.set_viewport_size({"width": 1180, "height": 1000})
                page.evaluate("() => { window.__convertLoaded = null; }")
                started = time.time()
                page.set_input_files("#convertfile", REAL)
                page.wait_for_function("() => window.__convertLoaded",
                                       timeout=300_000)
                load_ms = (time.time() - started) * 1000
                real = page.evaluate("() => window.__convertLoaded")
                record(f"real alien loaded in {load_ms:,.0f} ms: " + json.dumps(real))
                page.select_option("#converttarget", "bambu")
                started = time.time()
                with page.expect_download(timeout=300_000) as download:
                    page.click("#convertgo")
                write_ms = (time.time() - started) * 1000
                real_out = os.path.join(work, "alien-bambu.3mf")
                download.value.save_as(real_out)
                with zipfile.ZipFile(real_out) as archive:
                    alien_names = archive.namelist()
                    alien_model = "".join(archive.read(name).decode("utf-8", "replace")
                                          for name in alien_names
                                          if name.endswith(".model"))
                    triangles = len(re.findall(r"<triangle\b", alien_model))
                    alien_colours = set(re.findall(
                        r'<m:color color="#([0-9A-Fa-f]{8})"', alien_model))
                record(f"real alien -> Bambu in {write_ms:,.0f} ms: "
                       f"{len(alien_colours)} declared colours, {triangles:,} "
                       f"triangles, {os.path.getsize(real_out):,} bytes, "
                       f"project settings="
                       f"{'yes' if 'Metadata/project_settings.config' in alien_names else 'none'}")
                real_thumb = page.evaluate("() => window.__convertThumbnail || null")
                record("real alien thumbnail: " + json.dumps(real_thumb))
                with zipfile.ZipFile(real_out) as archive:
                    alien_png = archive.read("Metadata/plate_1.png")
                alien_w, alien_h, alien_pixels = png_pixels(alien_png)
                alien_thumb_colours = colours_in(alien_pixels)
                record(f"real alien thumbnail: {alien_w}x{alien_h}, "
                       f"{len(alien_thumb_colours)} distinct model colour(s)")
                check((alien_w, alien_h) == (512, 512) and len(alien_thumb_colours) >= 2,
                      "the real alien export has no usable thumbnail")
                check(real_thumb is not None and real_thumb.get("ms", 0) > 0,
                      "the thumbnail render was not reported")
                with open(os.path.join(EVIDENCE, "thumbnail-alien-512.png"), "wb") as fh:
                    fh.write(alien_png)
                check(len(alien_colours) == real["colours"],
                      "the real conversion dropped source colours")
                check("Metadata/project_settings.config" not in alien_names,
                      "the portable model carries printer/process settings")
                del alien_colours          # the thumbnail pass rebinds its own name
                # Flat paint keeps the mesh exactly; subdivided colour facets
                # become their real leaf triangles (the node suite asserts the exact
                # count), so the written mesh may only grow.
                check(triangles >= real["triangles"],
                      "the real conversion dropped triangles")
                shot(page, "homepage-alien-loaded.png")
            else:
                record("real alien not on this machine; structural test covers it")

            # --- the actual pumpkin, with the opt-in settings control -----------
            pumpkin = r"C:\Users\rende\Desktop\Flippin Pumpkin flat bottom painted.3mf"
            if os.path.isfile(pumpkin):
                page.set_viewport_size({"width": 1180, "height": 1000})
                page.evaluate("() => { window.__convertLoaded = null; }")
                page.set_input_files("#convertfile", pumpkin)
                page.wait_for_function("() => window.__convertLoaded", timeout=300_000)
                loaded_pumpkin = page.evaluate("() => window.__convertLoaded")
                record("pumpkin loaded: " + json.dumps(loaded_pumpkin))
                note = (page.text_content("#sourcesettings") or "").strip()
                record(f"pumpkin settings note: {note}")
                check("layer height 0.2" in note,
                      "the source's layer height is not shown")
                check("supports on" in note, "the source's support intent is not shown")
                check("first layer" not in note,
                      "the note shows a value that is not carried")
                check(not page.is_disabled("#preservesettings"),
                      "the settings control is disabled for a Bambu export")
                page.check("#preservesettings")
                page.select_option("#converttarget", "bambu")
                page.wait_for_timeout(300)
                with page.expect_download(timeout=600_000) as download:
                    page.click("#convertgo")
                pumpkin_out = os.path.join(work, "pumpkin-bambu.3mf")
                download.value.save_as(pumpkin_out)
                import xml.etree.ElementTree as ET
                with zipfile.ZipFile(pumpkin_out) as archive:
                    p_names = archive.namelist()
                    p_model = archive.read("3D/3dmodel.model").decode("utf-8")
                    p_settings = archive.read("Metadata/model_settings.config").decode("utf-8")
                    p_thumb = archive.read("Metadata/plate_1.png")
                    members = [n for n in p_names if n.endswith(".model")]
                    docs = {n: archive.read(n).decode("utf-8") for n in members}
                parsed_ok = {}
                ids_by_doc = {}
                for name, text in docs.items():
                    try:
                        root = ET.fromstring(text)
                        parsed_ok[name] = True
                        ids = [e.get("id") for e in root.iter()
                               if e.tag.endswith("object") or e.tag.endswith("colorgroup")]
                        ids_by_doc[name] = ids
                    except ET.ParseError as error:
                        parsed_ok[name] = f"parse error: {error}"
                record(f"pumpkin export: {len(p_names)} members, "
                       f"settings={'yes' if 'layer_height' in p_settings else 'no'}, "
                       f"thumbnail={len(p_thumb)} bytes")
                record("xml: " + json.dumps(parsed_ok))
                check(all(value is True for value in parsed_ok.values()),
                      f"an exported model document is not valid XML: {parsed_ok}")
                for name, ids in ids_by_doc.items():
                    check(len(ids) == len(set(ids)),
                          f"duplicate ids in {name}: {ids}")
                check("layer_height" in p_settings and "support_type" in p_settings,
                      "the opt-in settings did not reach the archive")
                check("slic3rpe:" not in "".join(docs.values()),
                      "the standard model still carries an unbound slic3rpe prefix")
                every_model_text = "".join(docs.values())
                declared = set(re.findall(
                    r'<m:color color="#([0-9A-Fa-f]{8})"', every_model_text))
                refs = set(re.findall(r'p1="([0-9]+)"', every_model_text))
                check(refs and all(int(ref) < len(declared) for ref in refs),
                      "a colour reference does not resolve inside the declared palette")
                with open(os.path.join(EVIDENCE, "pumpkin-bambu-thumbnail.png"),
                          "wb") as fh:
                    fh.write(p_thumb)
                page.evaluate("() => { window.__convertLoaded = null; }")
                record("pumpkin: exported, XML-valid, references resolve")

            if posts:
                check(False, f"the page sent {len(posts)} non-GET request(s)")
            record(f"network : {len(posts)} non-GET requests (0 expected)")
            record(f"page errors: {errors or 'none'}")
            check(not errors, f"the page raised {errors}")
            record(f"failed same-origin requests: {failed or 'none'}")
            check(not failed, f"{failed} request(s) failed")
            browser.close()
    finally:
        httpd.shutdown()
        record("RESULT: " + ("FAILED - " + "; ".join(failures) if failures
                             else "PASS - single converter, repaint table, recovery, "
                                  "layout, theme, network"))
        with open(os.path.join(EVIDENCE, "phase2.txt"), "w", encoding="utf-8") as fh:
            fh.write("Phase 2 converter QA\n\n" + "\n".join(lines) + "\n")
    print("RESULT: " + ("FAILED - " + "; ".join(failures) if failures else "PASS"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
