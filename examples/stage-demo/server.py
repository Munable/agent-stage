"""Stage-demo HTTP server: NDJSON trace events in, stage frames out.

Stdlib only. The browser page (or curl) POSTs NDJSON trace events to /turn
and receives one NDJSON stage frame per director decision plus a summary
line — the external-harness ingestion path of the adapter contract.

    python examples/stage-demo/server.py
    curl --data-binary @trace.ndjson http://127.0.0.1:8766/turn
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SRC))

from agent_stage import NdjsonIngestStats, iter_ndjson_trace_events  # noqa: E402


def _load_sibling(name: str):
    spec = importlib.util.spec_from_file_location(
        f"stage_demo_{name}", Path(__file__).with_name(f"{name}.py")
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


harness = _load_sibling("harness")
stage_setup = _load_sibling("stage_setup")

INDEX = """<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Agent Stage Demo</title>
<body style="margin:0; background:#f3ead8; color:#2f2419; font-family:ui-rounded, 'SF Pro Rounded', sans-serif;">
  <main style="max-width:48rem; margin:0 auto; padding:2rem 1.25rem 3rem;">
    <h1 style="margin:0 0 .5rem;">Agent Stage Demo</h1>
    <p style="margin:0 0 1rem; max-width:38rem; line-height:1.5;">
      Scripted director events, real browser-side StageManager playback, and the
      reference renderer running end to end.
    </p>
    <div style="display:flex; gap:.75rem; align-items:center; margin-bottom:1rem;">
      <button id="run" style="padding:.7rem 1rem; border-radius:999px; border:0; background:#2f2419; color:#fff;">
        Run scripted turn
      </button>
      <span id="status" style="font-size:.95rem; opacity:.75;">Loading...</span>
    </div>
    <div id="stage-root"></div>
  </main>
  <script type="module">
    import { attachStageDemo } from "/dist/stage-demo-player.js";

    await attachStageDemo({
      root: document.getElementById("stage-root"),
      runButton: document.getElementById("run"),
      statusNode: document.getElementById("status"),
      traceUrl: "/trace.ndjson",
      turnUrl: "/turn",
      configUrl: "/stage-config.json",
    });
  </script>
</body>
</html>
"""


DIST_ROOT = ROOT / "dist"


async def respond_to_turn(lines: Iterable[bytes | str], output: Any) -> NdjsonIngestStats:
    """Socket-free core: ingest NDJSON events, stream NDJSON frames."""
    stats = NdjsonIngestStats()
    director = stage_setup.build_director()
    messages: list[dict] = [{"role": "system", "content": stage_setup.SYSTEM_PROMPT}]
    batch: list[dict] = []
    frames = 0
    for event in iter_ndjson_trace_events(lines, stats=stats):
        batch.append(event.to_stage_signal())
        if event.type.value not in stage_setup.FLUSH_EVENT_TYPES:
            continue
        frame = await director(messages, batch)
        batch = []
        if frame is None:
            continue
        frames += 1
        output.write((json.dumps(frame, ensure_ascii=False) + "\n").encode("utf-8"))
    summary = {"type": "turn_summary", "frames": frames, "dropped_events": stats.dropped}
    output.write((json.dumps(summary, ensure_ascii=False) + "\n").encode("utf-8"))
    return stats


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/stage-config.json":
            body = json.dumps(
                {
                    "assetDirectory": stage_setup.ASSET_DIRECTORY,
                    "reflexTable": stage_setup.REFLEX_TABLE,
                    "pacing": stage_setup.DEMO_PACING,
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/trace.ndjson":
            body = harness.scripted_turn_ndjson().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/dist/"):
            rel = self.path[len("/dist/"):]
            target = (DIST_ROOT / rel).resolve()
            if not str(target).startswith(str(DIST_ROOT.resolve())) or not target.is_file():
                self.send_response(404)
                self.end_headers()
                return
            body = target.read_bytes()
            self.send_response(200)
            content_type, _ = mimetypes.guess_type(str(target))
            self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        body = INDEX.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/turn":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.end_headers()
        asyncio.run(respond_to_turn(body.splitlines(), self.wfile))

    def log_message(self, *args: Any) -> None:
        pass


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    print("stage-demo listening on http://127.0.0.1:8766", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
