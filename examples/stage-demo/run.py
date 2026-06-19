"""Headless stage-demo turn: scripted harness -> director -> frames.

Prints a JSON summary to stdout. No API key, no LLM, only public agent_stage
APIs. The example-local batching below is deliberately simple and is not an
extraction of any production flush policy.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SRC))


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


async def run_turn() -> dict:
    director = stage_setup.build_director()
    messages: list[dict] = [{"role": "system", "content": stage_setup.SYSTEM_PROMPT}]
    batch: list[dict] = []
    frames: list[dict] = []
    violations = 0
    async for event in harness.scripted_event_source():
        batch.append(event.to_stage_signal())
        if event.type.value not in stage_setup.FLUSH_EVENT_TYPES:
            continue
        frame = await director(messages, batch)
        batch = []
        if frame is None:
            continue
        if stage_setup.stage_frame_violation(
            frame, **stage_setup.CATALOG.frame_vocab(), asset_calls=stage_setup.ASSET_CALLS
        ):
            violations += 1
        frames.append(frame)
    return {
        "frames": len(frames),
        "states": [frame["character_state"] for frame in frames],
        "cards": [frame["card"]["type"] for frame in frames if frame.get("card")],
        "violations": violations,
    }


def main() -> None:
    print(json.dumps(asyncio.run(run_turn()), ensure_ascii=False))


if __name__ == "__main__":
    main()
