"""Local dev server that mimics Vercel's cleanUrls: /stp-to-stl serves stp-to-stl.html,
/stp-to-stl.html redirects to /stp-to-stl, and missing pages get 404.html.

    python3 tools/serve.py [port]
"""
import http.server
import mimetypes
import os
import sys

mimetypes.add_type("image/webp", ".webp")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class CleanUrlHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _route(self):
        path, _, query = self.path.partition("?")
        if path.endswith(".html") and path != "/404.html":
            clean = path[:-5]
            if clean == "/index":
                clean = "/"
            self.send_response(308)
            self.send_header("Location", clean + ("?" + query if query else ""))
            self.end_headers()
            return False
        local = os.path.join(ROOT, path.lstrip("/"))
        if path != "/" and not os.path.splitext(path)[1] and os.path.isfile(local + ".html"):
            self.path = path + ".html" + ("?" + query if query else "")
        return True

    def send_error(self, code, message=None, explain=None):
        page = os.path.join(ROOT, "404.html")
        if code == 404 and os.path.isfile(page):
            body = open(page, "rb").read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def do_GET(self):
        if self._route():
            super().do_GET()

    def do_HEAD(self):
        if self._route():
            super().do_HEAD()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    http.server.ThreadingHTTPServer(("0.0.0.0", port), CleanUrlHandler).serve_forever()
