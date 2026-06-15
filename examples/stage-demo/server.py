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
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

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
<body style="font-family: system-ui; max-width: 40rem; margin: 2rem auto;">
  <h1>Agent Stage Demo</h1>
  <div id="stage" style="font-size: 4rem;">🙂</div>
  <div id="bubble" style="min-height: 1.5rem; color: #555;"></div>
  <pre id="card" style="background: #f6f6f6; padding: .5rem;"></pre>
  <button id="run">Run scripted turn</button>
  <script>
    const EMOJI = {idle: "🙂", thinking: "🤔", working: "🔧",
                   presenting: "📋", celebrating: "🎉"};
    const stage = document.getElementById("stage");
    const bubble = document.getElementById("bubble");
    const card = document.getElementById("card");
    document.getElementById("run").onclick = async () => {
      card.textContent = "";
      const trace = await (await fetch("/trace.ndjson")).text();
      const res = await fetch("/turn", { method: "POST", body: trace });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const frame = JSON.parse(line);
          if (frame.type === "turn_summary") continue;
          stage.textContent = EMOJI[frame.character_state] || "🙂";
          bubble.textContent = frame.thinking_text || "";
          if (frame.card) card.textContent = JSON.stringify(frame.card, null, 2);
          await new Promise(r => setTimeout(r, 400));
        }
      }
    };
  </script>
</body>
</html>
"""


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
        if self.path == "/trace.ndjson":
            body = harness.scripted_turn_ndjson().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
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
