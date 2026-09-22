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

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_UPLOAD = 600 * 1024 * 1024
SESSION_TTL = 6 * 3600
TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")

_sessions: dict[str, dict] = {}
_sessions_lock = threading.Lock()
_convert_lock = threading.Lock()
_workdir = ""
_profile_root = None


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
        return self._fail("not found", 404)

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

        try:
            with zipfile.ZipFile(src) as zf:
                source = u1.read_source(zf)
            info = u1.describe(source, _profile_root)
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
                "logs": [], "state": "new", "error": None,
            }
        info["id"] = token
        info["filename"] = name
        info["profile_root"] = _profile_root
        self._json(200, info)

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
            "verify": bool(req.get("verify", False)),
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
