"""Contract tests for the canonical agent_stage event model."""

from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

from agent_stage import (
    TRACE_SCHEMA_VERSION,
    PublicTraceType,
    TraceEvent,
    build_stage_signal,
    completeness_violation,
)

ROOT = Path(__file__).resolve().parents[2]


def test_trace_schema_version_is_current_public_wire_version():
    assert TRACE_SCHEMA_VERSION == 1


def test_to_dict_uses_canonical_tool_name_key_and_stamps_schema_version():
    event = TraceEvent(
        type=PublicTraceType.TOOL_CALL,
        summary="calling a tool",
        payload={"args": {"q": "rice"}},
        tool_name="lookup",
        turn_id="abc123ef",
    )
    data = event.to_dict()
    assert data["type"] == "tool_call"
    assert data["tool_name"] == "lookup"
    assert "capability_name" not in data
    assert data["schema_version"] == TRACE_SCHEMA_VERSION
    assert set(data) == {
        "type",
        "summary",
        "payload",
        "tool_name",
        "turn_id",
        "event_id",
        "created_at",
        "schema_version",
    }


def test_construction_sanitizes_summary_and_payload():
    event = TraceEvent(
        type=PublicTraceType.OBSERVE,
        summary="reading input sk-abcdefghijklmnop1234",
        payload={
            "api_key": "sk-abcdefghijklmnop1234",
            "note": "Bearer abcdefghijklmnop.1234",
            "kcal": 520.0,
            "bad_float": math.inf,
        },
    )
    assert "sk-" not in event.summary
    assert "api_key" not in event.payload
    assert "[redacted]" in event.payload["note"]
    assert event.payload["kcal"] == 520.0
    assert event.payload["bad_float"] == "[redacted]"


def test_to_dict_payload_is_isolated_from_event():
    event = TraceEvent(
        type=PublicTraceType.FINAL,
        summary="done",
        payload={"result": {"items": ["rice"]}},
    )
    data = event.to_dict()
    data["payload"]["result"]["items"].append("mutation")
    assert event.payload["result"]["items"] == ["rice"]


def test_empty_summary_falls_back_to_public_default():
    event = TraceEvent(type=PublicTraceType.PLAN, summary="<think>secret</think>")
    assert event.summary == "Working on this step"


def test_completeness_violation_rules():
    assert (
        completeness_violation(PublicTraceType.TOOL_CALL, {}, None)
        == "tool_call requires tool_name"
    )
    assert (
        completeness_violation(PublicTraceType.STATE_UPDATE, {}, "update_state")
        == "state_update requires result payload"
    )
    assert (
        completeness_violation(PublicTraceType.STATE_UPDATE, {"result": {}}, "update_state")
        is None
    )
    assert completeness_violation(PublicTraceType.FINAL, {}, None) is None


def test_stage_signal_shape_matches_director_contract():
    signal = build_stage_signal(
        type=PublicTraceType.TOOL_RESULT,
        summary="tool returned",
        payload={"result": {"ok": True}},
        event_id="evt1",
        created_at="2026-06-13T00:00:00+00:00",
        turn_id="abc123ef",
        tool_name="lookup",
    )
    assert signal == {
        "type": "event",
        "content": {
            "event": "tool_result",
            "summary": "tool returned",
            "payload": {"result": {"ok": True}},
            "trace_id": "evt1",
            "created_at": "2026-06-13T00:00:00+00:00",
            "turn_id": "abc123ef",
            "tool": "lookup",
        },
    }
    bare = build_stage_signal(
        type=PublicTraceType.OBSERVE,
        summary="s",
        payload={},
        event_id="e",
        created_at="c",
    )
    assert "turn_id" not in bare["content"]
    assert "tool" not in bare["content"]


def test_trace_event_stage_signal_delegates_to_builder():
    event = TraceEvent(
        type=PublicTraceType.TOOL_CALL,
        summary="calling",
        payload={"args": {}},
        tool_name="lookup",
        turn_id="abc123ef",
    )
    signal = event.to_stage_signal()
    assert signal["content"]["event"] == "tool_call"
    assert signal["content"]["tool"] == "lookup"
    assert signal["content"]["trace_id"] == event.event_id


def test_agent_stage_imports_without_pydantic():
    code = (
        "import sys; sys.modules['pydantic'] = None; "
        "import agent_stage, agent_stage.trace, agent_stage.stage_signal, "
        "agent_stage.events, agent_stage.sanitizer, agent_stage.adapter, "
        "agent_stage.director, agent_stage.token_catalog, agent_stage.ndjson; "
        "print('ok')"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert "ok" in proc.stdout
