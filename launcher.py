from __future__ import annotations

import json
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn

from app import __version__, main as backend
from app.database import Database, webview_data_dir


def available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_until_ready(url: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("The local Square Drills service did not start in time.")


def server_config(port: int) -> uvicorn.Config:
    # Windowed PyInstaller builds have no stdout/stderr. Keep this fix: Uvicorn's
    # default console formatter otherwise probes unavailable streams.
    return uvicorn.Config(backend.app, host="127.0.0.1", port=port,
                          log_level="warning", access_log=False, log_config=None)


class SaveBeforeClose:
    """Keep the WebView and server alive until the ordered save queue finishes."""

    def __init__(self, window, timeout: float = 10.0) -> None:
        self.window = window
        self.timeout = timeout
        self.allowed = False
        self.pending = False

    def request_close(self):
        if self.allowed or not self.window.events.loaded.is_set():
            return None
        if not self.pending:
            self.pending = True
            # The native closing event runs on the UI thread. Never wait there.
            threading.Thread(target=self._flush, name="square-drills-save", daemon=True).start()
        return False

    def _flush(self) -> None:
        finished = threading.Event()
        result = {}

        def callback(value):
            if isinstance(value, dict):
                result.update(value)
            finished.set()

        try:
            self.window.evaluate_js("""(async () => {
                document.body.inert = true;
                try {
                    document.dispatchEvent(new Event('chess-mobile-pause'));
                    if (window.ChessTools?.flush) await window.ChessTools.flush();
                    return {ok: true};
                } catch (_) { return {ok: false}; }
            })()""", callback)
            if not finished.wait(self.timeout) or result.get("ok") is not True:
                raise RuntimeError("Save did not complete")
            self.allowed = True
            self.window.destroy()
        except Exception:
            try:
                self.window.evaluate_js("document.body.inert = false; document.dispatchEvent(new Event('chess-mobile-resume')); window.ChessTools?.showNotice('Could not finish saving. The app is still open; please try closing it again.', 'error')")
            except Exception:
                pass
        finally:
            self.pending = False


def smoke_test() -> dict:
    """Exercise packaged assets and the real local API using disposable storage.

    This mode never creates a WebView/window or opens the owner's database.
    """
    import webview  # Verify the packaged desktop dependency without opening it.
    assert callable(webview.create_window)
    for relative in ("index.html", "js/app.js", "js/modules/square-drills-core.js",
                     "js/modules/square-drills.js", "css/app.css", "css/square-drills.css"):
        if not (backend.STATIC_DIR / relative).is_file():
            raise RuntimeError(f"Packaged asset missing: {relative}")
    original = backend.database
    with tempfile.TemporaryDirectory(prefix="square-drills-check-") as temporary:
        backend.database = Database(Path(temporary) / "square_drills.db")
        port = available_port()
        url = f"http://127.0.0.1:{port}"
        server = uvicorn.Server(server_config(port))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        try:
            wait_until_ready(url)

            def request(path, method="GET", body=None):
                data = None if body is None else json.dumps(body).encode("utf-8")
                req = urllib.request.Request(url + path, data=data, method=method,
                                             headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=5) as response:
                    return json.load(response)

            assert request("/api/health")["version"] == __version__
            assert request("/api/state/square-drills")["payload"] is None
            assert request("/api/settings/theme") == {"theme": "light"}
            sample = {"attempts": 3, "correct": 2, "answers": {"white": "QB3"}}
            request("/api/state/square-drills", "PUT", {"payload": sample})
            request("/api/settings/theme", "PUT", {"theme": "dark"})
            reopened = Database(backend.database.path)
            reopened.initialize()
            assert reopened.get_module_state("square-drills") == sample
            assert reopened.get_setting("theme") == "dark"
            assert request("/api/state/square-drills")["payload"] == sample
            assert request("/api/state/square-drills", "DELETE")["deleted"] is True
            assert request("/api/settings/theme") == {"theme": "dark"}
            for path in ("/", "/static/js/modules/square-drills.js"):
                with urllib.request.urlopen(url + path, timeout=5) as response:
                    assert response.status == 200 and response.read()
            try:
                request("/api/state/match-tracker")
            except urllib.error.HTTPError as error:
                assert error.code == 404
            else:
                raise AssertionError("Unrelated module API was exposed")
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            if thread.is_alive():
                raise RuntimeError("Smoke-test server did not stop")
            backend.database = original
    return {"ok": True, "version": __version__, "checks": ["bundled assets", "desktop dependency",
            "loopback HTTP", "fresh defaults", "SQLite reopen", "theme", "clear scope", "module isolation"]}


def main() -> None:
    if "--smoke-test" in sys.argv:
        report = None
        if "--smoke-report" in sys.argv:
            report = Path(sys.argv[sys.argv.index("--smoke-report") + 1])
        try:
            result = smoke_test()
        except Exception as error:
            # Avoid a PyInstaller error dialog during background verification.
            result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
        if report is not None:
            report.write_text(json.dumps(result, indent=2), encoding="utf-8")
        raise SystemExit(0 if result["ok"] else 1)

    import webview
    port = available_port()
    url = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(server_config(port))
    thread = threading.Thread(target=server.run, name="square-drills-server", daemon=True)
    thread.start()
    try:
        wait_until_ready(url)
        window = webview.create_window("Square Drills", url, width=1180, height=780, min_size=(900, 640))
        close_guard = SaveBeforeClose(window)
        window.events.closing += close_guard.request_close
        webview.start(debug=False, gui="edgechromium", private_mode=True,
                      storage_path=str(webview_data_dir()))
    finally:
        server.should_exit = True
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
