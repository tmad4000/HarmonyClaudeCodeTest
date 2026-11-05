"""Read-only local review server; no microphone, uploads, or remote commands."""

import argparse
import http.server
import socketserver
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        allowed = path in ("index.html", "demo.js", "demo.css", "README.md") or (
            path.startswith("artifacts/")
            and Path(path).suffix in (".wav", ".json", ".png", ".txt")
        )
        resolved = (ROOT / path).resolve()
        if (
            not allowed
            or not resolved.is_relative_to(ROOT.resolve())
            or not resolved.is_file()
        ):
            self.send_error(404)
            return
        super().do_GET()

    def list_directory(self, path):
        self.send_error(404)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    a = p.parse_args()
    with socketserver.ThreadingTCPServer(("127.0.0.1", a.port), Handler) as server:
        print(f"Review server on port {a.port}; Ctrl-C stops it.", flush=True)
        server.serve_forever()
