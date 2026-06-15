"""Gate-2 acceptance: the stage-demo example end-to-end on public APIs only."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEMO_DIR = ROOT / "examples" / "stage-demo"


def _scrubbed_env() -> dict[str, str]:
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(ROOT / "src")}
    assert "DEEPSEEK_API_KEY" not in env and "OPENROUTER_API_KEY" not in env
    return env


def _load_server_module():
    spec = importlib.util.spec_from_file_location(
        "stage_demo_server", DEMO_DIR / "server.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_run_py_produces_valid_frames_without_keys():
    proc = subprocess.run(
        [sys.executable, str(DEMO_DIR / "run.py")],
        capture_output=True,
        text=True,
        env=_scrubbed_env(),
        timeout=60,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    summary = json.loads(proc.stdout.strip().splitlines()[-1])
    assert summary["violations"] == 0
    assert summary["frames"] >= 4
    for state in ("thinking", "working", "presenting", "celebrating"):
        assert state in summary["states"], summary
    assert summary["cards"] == ["note"]


def test_respond_to_turn_streams_frames_and_counts_drops():
    server = _load_server_module()
    clean_lines = server.harness.scripted_turn_ndjson().splitlines()

    output = BytesIO()
    stats = asyncio.run(server.respond_to_turn(clean_lines, output))
    lines = [json.loads(line) for line in output.getvalue().decode("utf-8").splitlines()]
    summary = lines[-1]
    assert summary["type"] == "turn_summary"
    assert summary["dropped_events"] == 0
    assert stats.parsed == len(clean_lines)
    frames = lines[:-1]
    assert len(frames) == summary["frames"] >= 4
    vocab = server.stage_setup.CATALOG.frame_vocab()
    for frame in frames:
        assert (
            server.stage_setup.stage_frame_violation(
                frame, **vocab, asset_calls=server.stage_setup.ASSET_CALLS
            )
            is None
        )

    dirty_lines = ["garbage line", json.dumps({"type": "dance", "summary": "x"}), *clean_lines]
    output = BytesIO()
    asyncio.run(server.respond_to_turn(dirty_lines, output))
    summary = json.loads(output.getvalue().decode("utf-8").splitlines()[-1])
    assert summary["dropped_events"] == 2


def test_http_loopback_end_to_end():
    server_module = _load_server_module()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server_module.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        with urllib.request.urlopen(f"{base}/trace.ndjson", timeout=10) as response:
            trace = response.read()
        request = urllib.request.Request(f"{base}/turn", data=trace, method="POST")
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
        lines = [json.loads(line) for line in body.splitlines()]
        assert lines[-1]["type"] == "turn_summary"
        assert lines[-1]["frames"] >= 4
        assert lines[-1]["dropped_events"] == 0
        assert any(frame.get("character_state") == "celebrating" for frame in lines[:-1])
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


def test_demo_uses_only_public_apis():
    for path in sorted(DEMO_DIR.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        for forbidden in ("import backend", "from backend", "agentic_product_runtime"):
            assert forbidden not in text, f"{path.name} references {forbidden}"


def test_demo_runs_when_copied_out_of_repo(tmp_path):
    target = tmp_path / "stage-demo-copy"
    shutil.copytree(DEMO_DIR, target)
    proc = subprocess.run(
        [sys.executable, str(target / "run.py")],
        capture_output=True,
        text=True,
        env=_scrubbed_env(),
        timeout=60,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    summary = json.loads(proc.stdout.strip().splitlines()[-1])
    assert summary["violations"] == 0
