#!/usr/bin/env python3
"""
u1ui.py -- a small local web UI for u1convert.

Runs on 127.0.0.1 only and uses nothing outside the Python standard library, so
there is nothing to install. Start it and a browser opens on the drop zone:

    python u1ui.py
    python u1ui.py --port 9000 --no-browser
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import uuid
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import u1convert as u1
import u1gcode
import u1mix
import u1preview
import u1project as u1p
import u1spectrum
import u1targets

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_UPLOAD = 600 * 1024 * 1024
SESSION_TTL = 6 * 3600
TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")

_sessions: dict[str, dict] = {}
_sessions_lock = threading.Lock()
_convert_lock = threading.Lock()
_workdir = ""
_profile_root = None


def _profiles_block() -> dict:
    """The profile lists the page fills its dropdowns from."""
    if not _profile_root:
        return {"filament": [u1.DEFAULT_FILAMENT], "process": [u1.DEFAULT_PROCESS],
                "machine": [u1.DEFAULT_MACHINE]}
    profiles = u1.Profiles(_profile_root)
    return {
        "filament": profiles.u1_filaments(),
        "process": profiles.matching("process", "U1", "0.4"),
        "machine": profiles.matching("machine", "U1"),
    }


class BadRequest(ValueError):
    """The request asked for something this endpoint cannot parse."""


def _mapping_of(req) -> dict:
    """The source-colour -> slot mapping in a request, refusing bad shapes."""
    raw = req.get("mapping")
    if raw in (None, {}, ""):
        return {}
    if not isinstance(raw, dict):
        raise BadRequest("the mapping must be an object of source colour -> slot")
    out = {}
    for key, value in raw.items():
        try:
            source, slot = int(key), int(value)
        except (TypeError, ValueError):
            raise BadRequest(
                f"the mapping entry {key!r}: {value!r} is not a pair of whole numbers")
        out[source] = slot
    return out


def _mode_of(req) -> str:
    mode = str(req.get("mode") or "direct")
    if mode not in ("direct", "approximate", "spectrum"):
        raise BadRequest(
            f"unknown export mode {mode!r}; use direct, approximate or spectrum")
    return mode


def _recipes_of(req) -> list:
    """The reviewed Full Spectrum recipes, refusing anything the writer cannot use."""
    raw = req.get("recipes")
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise BadRequest("recipes must be a list of first/second/percent entries")
    out = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise BadRequest(f"recipe {index + 1} is not an object")
        try:
            out.append({
                "a": int(entry.get("a")),
                "b": int(entry.get("b")),
                "percent": int(entry.get("percent")),
            })
        except (TypeError, ValueError):
            raise BadRequest(f"recipe {index + 1} needs whole numbers for a, b and percent")
    return out


# --------------------------------------------------------------------------------------
# session bookkeeping
# --------------------------------------------------------------------------------------

def _purge() -> None:
    cutoff = time.time() - SESSION_TTL
    with _sessions_lock:
        stale = [k for k, v in _sessions.items() if v["created"] < cutoff]
        for k in stale:
            sess = _sessions.pop(k)
            for key in ("src", "out"):
                path = sess.get(key)
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass


def _get(token: str):
    if not TOKEN_RE.match(token or ""):
        return None
    with _sessions_lock:
        return _sessions.get(token)


# --------------------------------------------------------------------------------------
# request handling
# --------------------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "u1convert"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):        # keep stdout for our own messages
        pass

    # -- plumbing -----------------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def _fail(self, message: str, code: int = 400):
        self._json(code, {"error": message})

    def _body(self, limit: int) -> bytes:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("bad Content-Length")
        if n <= 0:
            raise ValueError("the request was empty")
        if n > limit:
            raise ValueError(f"that is larger than the {limit // (1024*1024)} MB limit")
        buf = bytearray()
        while len(buf) < n:
            chunk = self.rfile.read(min(1 << 20, n - len(buf)))
            if not chunk:
                break
            buf += chunk
        return bytes(buf)

    # -- routes -------------------------------------------------------------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        _purge()

        if path == "/":
            try:
                with open(os.path.join(HERE, "u1ui.html"), "rb") as fh:
                    page = fh.read()
            except OSError as exc:
                return self._fail(f"u1ui.html is missing next to the script ({exc})", 500)
            return self._send(200, page, "text/html; charset=utf-8")

        if path == "/favicon.ico":
            icon = os.path.join(HERE, "u1convert.ico")
            if os.path.isfile(icon):
                with open(icon, "rb") as fh:
                    return self._send(200, fh.read(), "image/x-icon")
            return self._fail("no icon", 404)

        if path.startswith("/web/"):
            return self._static(path)

        m = re.match(r"^/api/progress/([0-9a-f]{32})$", path)
        if m:
            sess = _get(m.group(1))
            if not sess:
                return self._fail("that session has expired", 404)
            with _sessions_lock:
                return self._json(200, {
                    "state": sess["state"],
                    "logs": sess["logs"][-400:],
                    "error": sess.get("error"),
                    "copies": sess.get("copies"),
                    "capacity": sess.get("capacity"),
                    "verify_failed": bool((sess.get("result") or {}).get("verify_failed")),
                    "sliced": (sess.get("result") or {}).get("sliced"),
                    "unverified": bool((sess.get("result") or {}).get("verify_failed")),
                })

        m = re.match(r"^/api/result/([0-9a-f]{32})$", path)
        if m:
            sess = _get(m.group(1))
            if not sess or sess["state"] != "done" or not sess.get("out"):
                return self._fail("nothing to download yet", 404)
            with open(sess["out"], "rb") as fh:
                data = fh.read()
            name = urllib.parse.quote(sess["download"])
            return self._send(200, data, "application/octet-stream",
                              {"X-Suggested-Filename": name})

        return self._fail("not found", 404)

    def _static(self, path: str):
        """Serve the shared browser modules the page imports.

        Only files under this project's own `web/` directory, resolved and then
        checked, so a crafted path cannot walk out of the tree.
        """
        root = os.path.join(HERE, "web")
        target = os.path.normpath(os.path.join(HERE, path.lstrip("/").replace("/", os.sep)))
        if not target.startswith(root + os.sep) or not os.path.isfile(target):
            return self._fail("not found", 404)
        types = {".js": "text/javascript; charset=utf-8",
                 ".mjs": "text/javascript; charset=utf-8",
                 ".json": "application/json",
                 ".css": "text/css; charset=utf-8",
                 ".html": "text/html; charset=utf-8",
                 ".svg": "image/svg+xml", ".png": "image/png"}
        ext = os.path.splitext(target)[1].lower()
        with open(target, "rb") as fh:
            return self._send(200, fh.read(), types.get(ext, "application/octet-stream"))

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/analyze":
            return self._analyze()
        if path == "/api/convert":
            return self._convert()
        if path == "/api/replan":
            return self._replan()
        if path == "/api/plan":
            return self._plan()
        if path == "/api/mesh":
            return self._mesh()
        if path == "/api/gcode":
            return self._gcode()
        return self._fail("not found", 404)

    def _palette_for(self, plan, recipes):
        """{filament id: colour} for the four reels plus any reviewed recipes."""
        colours = {index + 1: colour for index, colour in enumerate(plan.colors())}
        for index, recipe in enumerate(recipes):
            colours[4 + index + 1] = u1spectrum.palette(plan.colors(), [recipe])[0]
        return colours

    def _mesh(self):
        """Triangle soup for the interactive preview, in the export's colours."""
        try:
            req = json.loads(self._body(1 << 20).decode("utf-8"))
        except Exception as exc:
            return self._fail(f"bad request: {exc}")
        sess = _get(req.get("id", ""))
        if not sess or not sess.get("project"):
            return self._fail("that session has expired, please drop the file again", 404)
        filaments = req.get("filaments") or []
        recipes = _recipes_of(req)
        # "original" must show the file's own palette and its own states; only
        # "result" applies the reels, the mapping and the recipes.
        mode = str(req.get("mode") or "result")
        if mode not in ("original", "result"):
            return self._fail(f"unknown preview mode {mode!r}")
        try:
            with zipfile.ZipFile(sess["src"]) as zf:
                project = sess["project"]
                selection = u1p.select(project, req.get("plate"), req.get("objects"))
                if mode == "original":
                    source = {index + 1: project.color_for(index + 1)
                              for index in range(max(project.palette_count, 1))}
                    mesh = u1preview.soup(zf, project, selection, source, None)
                    mesh["mapping"] = {}
                    mesh["palette"] = {str(k): v for k, v in sorted(source.items())}
                    mesh["mode"] = "original"
                    return self._json(200, mesh)
                plan = u1p.plan_for(
                    zf, project, selection,
                    [str(f.get("color") or "") for f in filaments],
                    [str(f.get("type") or "PLA") for f in filaments],
                    _mapping_of(req) or None, True, require_explicit=False)
                if not plan.mapping:
                    plan.mapping = u1mix.mapping_from_plan(
                        u1mix.plan_mixtures(
                            {e: project.color_for(e) for e in
                             sorted({x for o in selection.as_ids()
                                     for x in u1p.object_used_extruders(zf, project, o)})},
                            plan.filaments),
                        use_mixtures=bool(recipes))
                palette = self._palette_for(plan, recipes)
                mesh = u1preview.soup(zf, project, selection, palette,
                                      {int(k): int(v) for k, v in
                                       (plan.mapping or {}).items()})
        except u1.ConvertError as exc:
            return self._fail(str(exc))
        except Exception as exc:                       # pragma: no cover - defensive
            traceback.print_exc()
            return self._fail(f"could not build the preview: {exc}")
        mesh["mapping"] = {str(k): v for k, v in sorted((plan.mapping or {}).items())}
        mesh["palette"] = {str(k): v for k, v in sorted(palette.items())}
        mesh["mode"] = "result"
        return self._json(200, mesh)

    def _gcode(self):
        """Plan reel changes from a sliced file the user uploads."""
        try:
            name = urllib.parse.unquote(self.headers.get("X-Filename") or "slice.gcode")
            data = self._body(MAX_UPLOAD)
        except ValueError as exc:
            return self._fail(str(exc))
        member = urllib.parse.unquote(self.headers.get("X-Member") or "")
        if data.startswith(b"PK\x03\x04"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    candidates = [n for n in zf.namelist()
                                  if n.lower().endswith(".gcode")]
                    if not member:
                        if not candidates:
                            return self._fail("that is a sliced 3MF with no .gcode "
                                              "member in it")
                        # The page asks which member rather than guessing.
                        return self._json(422, {
                            "error": "that is a sliced 3MF; choose which G-code member "
                                     "to read",
                            "candidates": candidates[:40]})
                    if member not in candidates:
                        return self._fail(f"{member} is not a G-code member of that file "
                                          f"(found {', '.join(candidates[:6]) or 'none'})")
                    info = zf.getinfo(member)
                    if info.file_size > u1gcode.MAX_BYTES:
                        # Checked before inflating: a bomb must not be expanded.
                        return self._fail(
                            f"{member} expands to {info.file_size / 1048576:.0f} MB, "
                            f"past the {u1gcode.MAX_BYTES // 1048576} MB the planner "
                            "reads")
                    data = zf.read(member)
            except zipfile.BadZipFile:
                return self._fail("that 3MF could not be read as a ZIP archive")
        try:
            text = u1gcode.decode(data)
            evidence = u1gcode.analyse(text, physical=4)
        except u1gcode.GcodeError as exc:
            return self._fail(str(exc))
        evidence["file"] = name
        evidence["fingerprint"] = u1gcode.fingerprint(data)
        evidence["plan_text"] = u1gcode.plan_text(evidence, name)
        return self._json(200, evidence)

    def _replan(self):
        """Recount how many copies fit for a new spacing, from the cached parse."""
        try:
            req = json.loads(self._body(1 << 16).decode("utf-8"))
        except Exception as exc:
            return self._fail(f"bad request: {exc}")
        sess = _get(req.get("id", ""))
        if not sess or not sess.get("source"):
            return self._fail("that session has expired, please drop the file again", 404)
        try:
            capacity = u1.plate_capacity(
                sess["source"],
                gap=max(0.0, float(req.get("gap") or 5.0)),
                avoid_tower=bool(req.get("avoid_tower", True)),
                profile_root=_profile_root,
                machine=str(req.get("machine") or u1.DEFAULT_MACHINE),
                process=str(req.get("process") or u1.DEFAULT_PROCESS),
                filament_profile=str(req.get("filament") or u1.DEFAULT_FILAMENT),
                supports=str(req.get("supports") or "auto"),
                carry=bool(req.get("carry", True)),
            )
        except u1.ConvertError as exc:
            return self._fail(str(exc))
        return self._json(200, {"capacity": capacity})

    # -- api ----------------------------------------------------------------------
    def _analyze(self):
        try:
            name = urllib.parse.unquote(self.headers.get("X-Filename") or "model.3mf")
        except Exception:
            name = "model.3mf"
        try:
            data = self._body(MAX_UPLOAD)
        except ValueError as exc:
            return self._fail(str(exc))

        if not data.startswith(b"PK\x03\x04"):
            return self._fail("that is not a 3MF file (no ZIP header)")

        token = uuid.uuid4().hex
        src = os.path.join(_workdir, token + ".3mf")
        with open(src, "wb") as fh:
            fh.write(data)

        project = None
        source = None
        problem = None
        try:
            with zipfile.ZipFile(src) as zf:
                try:
                    project = u1p.read_project(zf)
                    problem = u1p.legacy_path_problem(zf, project)
                except u1.ConvertError:
                    project, problem = None, None
                if not problem:
                    try:
                        source = u1.read_source(zf)
                    except u1.ConvertError as exc:
                        source, problem = None, str(exc)
                if project is not None and problem:
                    info = self._project_info(zf, project, {})
                elif source is not None:
                    info = u1.describe(source, _profile_root)
                    info["multipart"] = False
                else:
                    raise u1.ConvertError(problem or "this file could not be read")
        except u1.ConvertError as exc:
            os.remove(src)
            return self._fail(str(exc))
        except Exception as exc:
            os.remove(src)
            traceback.print_exc()
            return self._fail(f"could not read that file: {exc}")

        with _sessions_lock:
            _sessions[token] = {
                "created": time.time(), "src": src, "name": name, "source": source,
                "project": project, "problem": problem,
                "logs": [], "state": "new", "error": None,
            }
        info["id"] = token
        info["filename"] = name
        info["profile_root"] = _profile_root
        self._json(200, info)

    def _project_info(self, zf, project, req) -> dict:
        """Assessment for a selection, in the shape the page renders."""
        selection = u1p.select(project, req.get("plate"), req.get("objects"))
        filaments = req.get("filaments") or []
        plan = u1p.plan_for(
            zf, project, selection,
            [str(f.get("color") or "") for f in filaments],
            [str(f.get("type") or "") for f in filaments],
            _mapping_of(req), bool(req.get("approximate", True)),
            require_explicit=False)
        info = u1p.analyse(zf, project, selection, plan)
        info["multipart"] = True
        info["selection"] = {"plate": selection.plate_id, "objects": selection.as_ids()}
        info["mapping"]["errors"] = u1p.validate_plan(zf, project, selection, plan)
        info["profiles"] = _profiles_block()
        info["targets"] = [{"id": name, "label": u1targets.LABELS[name]}
                           for name in u1targets.TARGETS]
        info["defaults"] = {"machine": u1.DEFAULT_MACHINE, "process": u1.DEFAULT_PROCESS,
                            "filament": u1.DEFAULT_FILAMENT}
        return info

    def _plan(self):
        """Re-assess one plate/object selection with the reels the page is showing."""
        try:
            req = json.loads(self._body(1 << 20).decode("utf-8"))
        except Exception as exc:
            return self._fail(f"bad request: {exc}")
        sess = _get(req.get("id", ""))
        if not sess:
            return self._fail("that session has expired, please drop the file again", 404)
        if not sess.get("project"):
            return self._fail("this file is handled by the single-object path")
        try:
            with zipfile.ZipFile(sess["src"]) as zf:
                info = self._project_info(zf, sess["project"], req)
        except BadRequest as exc:
            return self._fail(str(exc))
        except u1.ConvertError as exc:
            return self._fail(str(exc))
        except Exception as exc:
            traceback.print_exc()
            return self._fail(f"could not plan that selection: {exc}")
        return self._json(200, info)

    def _convert(self):
        try:
            req = json.loads(self._body(1 << 20).decode("utf-8"))
        except Exception as exc:
            return self._fail(f"bad request: {exc}")

        sess = _get(req.get("id", ""))
        if not sess:
            return self._fail("that session has expired, please drop the file again", 404)
        if sess["state"] == "working":
            return self._fail("a conversion is already running for this file")

        if sess.get("project") is not None and req.get("objects") is not None:
            return self._convert_project(sess, req)
        if str(req.get("mode") or "") == "spectrum":
            # The single-object path has no concept of recipe ids; a spectrum
            # request that reached it is a mistake, not something to reinterpret.
            return self._fail(
                "a Full Spectrum export needs a plate and the objects to export; "
                "this request did not name them")

        settings = {
            "machine": str(req.get("machine") or u1.DEFAULT_MACHINE),
            "process": str(req.get("process") or u1.DEFAULT_PROCESS),
            "filament": str(req.get("filament") or u1.DEFAULT_FILAMENT),
            "colors": [str(c) for c in (req.get("colors") or [])],
            "types": [str(t) for t in (req.get("types") or [])],
            "copies": max(1, int(req.get("copies") or 1)),
            "gap": max(0.0, float(req.get("gap") if req.get("gap") is not None else 5.0)),
            "reposition": bool(req.get("reposition", True)),
            "avoid_tower": bool(req.get("avoid_tower", True)),
            "supports": str(req.get("supports") or "auto"),
            "carry": bool(req.get("carry", True)),
            "verify": bool(req.get("verify", False)),
            "target": u1targets.normalise(req.get("target")),
        }
        name = os.path.splitext(os.path.basename(sess["name"]))[0] or "model"
        out = os.path.join(_workdir, req["id"] + "_U1.3mf")

        with _sessions_lock:
            sess["logs"] = []
            sess["state"] = "working"
            sess["error"] = None
            sess["download"] = f"{name}-U1.3mf"
            sess["copies"] = settings["copies"]

        def run():
            def sink(line):
                with _sessions_lock:
                    sess["logs"].append(line)

            u1.LOG_SINK = sink
            try:
                with _convert_lock:
                    result = u1.convert(
                        sess["src"], out, _profile_root,
                        settings["filament"], settings["machine"], settings["process"],
                        settings["colors"], settings["types"], settings["reposition"],
                        copies=settings["copies"], gap=settings["gap"],
                        avoid_tower=settings["avoid_tower"],
                        supports=settings["supports"],
                        verify=settings["verify"],
                        carry=settings["carry"],
                    )
                with _sessions_lock:
                    sess["out"] = out
                    sess["copies"] = result.get("copies")
                    sess["capacity"] = result.get("capacity")
                    sess["state"] = "done"
            except u1.ConvertError as exc:
                with _sessions_lock:
                    sess["state"] = "error"
                    sess["error"] = str(exc)
            except Exception as exc:
                traceback.print_exc()
                with _sessions_lock:
                    sess["state"] = "error"
                    sess["error"] = f"unexpected failure: {exc}"
            finally:
                u1.LOG_SINK = None

        threading.Thread(target=run, daemon=True).start()
        return self._json(200, {"id": req["id"], "state": "working"})

    def _convert_project(self, sess, req):
        """Export one plate/object selection of a multi-object project."""
        filaments = req.get("filaments") or []
        try:
            mode = _mode_of(req)
            mapping = _mapping_of(req)
            recipes = _recipes_of(req)
            target = u1targets.normalise(req.get("target"))
        except BadRequest as exc:
            return self._fail(str(exc))
        except u1targets.TargetError as exc:
            return self._fail(str(exc))
        if mode == "approximate" and not mapping:
            return self._fail(
                "an approximation export needs the mapping that was reviewed; the page "
                "sends the suggestions it showed, and /api/plan returns them")
        if mode == "spectrum":
            if not mapping:
                return self._fail(
                    "a Full Spectrum export needs the reviewed mapping: which source "
                    "colour goes to which reel or mixture")
            if not recipes:
                return self._fail(
                    "a Full Spectrum export needs at least one reviewed mixture recipe")
            try:
                import u1spectrum
                u1spectrum.check(u1.TARGET_SLOTS, recipes)
            except u1spectrum.SpectrumError as exc:
                # Refused before the export starts, so the page can say why.
                return self._fail(str(exc))
        settings = {
            "plate": req.get("plate"),
            "objects": [str(o) for o in (req.get("objects") or [])],
            "mode": mode,
            "filaments": [
                {"color": str(f.get("color") or ""), "type": str(f.get("type") or "PLA")}
                for f in filaments
            ],
            "mapping": mapping,
            "recipes": recipes,
            "machine": str(req.get("machine") or u1.DEFAULT_MACHINE),
            "process": str(req.get("process") or u1.DEFAULT_PROCESS),
            "filament": str(req.get("filament") or u1.DEFAULT_FILAMENT),
            "supports": str(req.get("supports") or "auto"),
            "carry": bool(req.get("carry", True)),
            "verify": bool(req.get("verify", False)),
            "target": target,
        }
        name = os.path.splitext(os.path.basename(sess["name"]))[0] or "model"
        out = os.path.join(_workdir, req["id"] + "_U1.3mf")

        with _sessions_lock:
            sess["logs"] = []
            sess["state"] = "working"
            sess["error"] = None
            sess["download"] = f"{name}-U1.3mf"
            sess["copies"] = 1

        def run():
            def sink(line):
                with _sessions_lock:
                    sess["logs"].append(line)

            u1.LOG_SINK = sink
            try:
                with _convert_lock:
                    result = u1.convert_project(
                        sess["src"], out,
                        plate=settings["plate"], objects=settings["objects"],
                        slots=[f["color"] for f in settings["filaments"]],
                        slot_types=[f["type"] for f in settings["filaments"]],
                        mapping=settings["mapping"] or None,
                        approximate=(settings["mode"] == "approximate"),
                        mode=settings["mode"],
                        spectrum=({"recipes": settings["recipes"]}
                                  if settings["mode"] == "spectrum" else None),
                        profile_root=_profile_root,
                        machine=settings["machine"], process=settings["process"],
                        filament_profile=settings["filament"],
                        supports=settings["supports"], carry=settings["carry"],
                        copies=1, verify=settings["verify"], target=settings["target"],
                    )
                with _sessions_lock:
                    sess["out"] = out
                    sess["state"] = "done"
                    sess["result"] = {k: v for k, v in result.items()
                                      if k not in ("mesh_stats",)}
            except u1.ConvertError as exc:
                with _sessions_lock:
                    sess["state"] = "error"
                    sess["error"] = str(exc)
            except Exception as exc:
                traceback.print_exc()
                with _sessions_lock:
                    sess["state"] = "error"
                    sess["error"] = f"unexpected failure: {exc}"
            finally:
                u1.LOG_SINK = None

        threading.Thread(target=run, daemon=True).start()
        return self._json(200, {"id": req["id"], "state": "working"})


# --------------------------------------------------------------------------------------

def main(argv=None) -> int:
    global _workdir, _profile_root

    ap = argparse.ArgumentParser(prog="u1ui.py",
                                 description="Local web UI for the 3MF to U1 converter.")
    ap.add_argument("--port", type=int, default=8756)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--profile-dir", help="Orca profiles directory (auto-detected)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args(argv)

    try:
        _profile_root = u1.find_profile_root(args.profile_dir)
    except u1.ConvertError as exc:
        _profile_root = None
        print(f"warning: {exc}\n"
              "warning: falling back to the bundled base settings\n", file=sys.stderr)

    _workdir = tempfile.mkdtemp(prefix="u1convert-")
    url = f"http://{args.host}:{args.port}/"

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print(f"error: cannot listen on {args.host}:{args.port} ({exc})", file=sys.stderr)
        print("       try a different port, e.g.  python u1ui.py --port 9000",
              file=sys.stderr)
        shutil.rmtree(_workdir, ignore_errors=True)
        return 1

    print(f"u1convert UI running at {url}")
    if _profile_root:
        print(f"Orca profiles: {_profile_root}")
    print("drop a .3mf onto the page to convert it.  Ctrl+C here to stop.")

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping")
    finally:
        httpd.server_close()
        shutil.rmtree(_workdir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
