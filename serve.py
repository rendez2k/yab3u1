"""Serves web/ and records the self-test verdict the page sends back.

Headless browsers are awkward to read results from (--dump-dom is unreliable, and
the background task's access log is not captured), so the page beacons its verdict
and this writes it straight to a file.
"""

import http.server
import os
import socketserver
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "web")
RESULT = os.path.join(HERE, "_selftest_result.txt")
OUTPUT = os.path.join(HERE, "_selftest_output.3mf")
PORT = 8231


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/__selftest__/"):
            verdict = parsed.path.rsplit("/", 1)[-1]
            detail = urllib.parse.parse_qs(parsed.query).get("d", [""])[0]
            with open(RESULT, "w", encoding="utf-8") as fh:
                fh.write(f"{verdict}\n{detail}\n")
            self.send_response(204)
            self.end_headers()
            return
        return super().do_GET()

    def do_POST(self):
        """The self-test page posts the archive it built, so the browser's own
        output can be handed to Orca for a real slice."""
        if urllib.parse.urlparse(self.path).path != "/__upload__":
            self.send_response(404)
            self.end_headers()
            return
        size = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(size) if size else b""
        with open(OUTPUT, "wb") as fh:
            fh.write(body)
        print(f"received {len(body):,} bytes from the browser", flush=True)
        self.send_response(204)
        self.end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    if os.path.exists(RESULT):
        os.remove(RESULT)
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"serving {ROOT} on http://127.0.0.1:{PORT}", flush=True)
        httpd.serve_forever()
