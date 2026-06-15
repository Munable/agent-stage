"""Contract tests for the harness adapter interface (v1)."""

from __future__ import annotations

import asyncio

import pytest

from agent_stage import (
    PublicTraceType,
    TraceEvent,
    TraceEventSource,
    TurnEventStream,
)


def _event(**overrides: object) -> TraceEvent:
    base: dict = dict(
        type=PublicTraceType.TOOL_CALL,
        summary="calling a tool",
        payload={"args": {"q": "rice"}},
        tool_name="lookup",
        turn_id="abc123ef",
    )
    base.update(overrides)
    return TraceEvent(**base)


def test_from_dict_round_trips_canonical_wire_dict():
    event = _event()
    data = event.to_dict()
    rebuilt = TraceEvent.from_dict(data)
    assert rebuilt.to_dict() == data


def test_from_dict_regenerates_missing_identity_fields():
    rebuilt = TraceEvent.from_dict({"type": "observe", "summary": "hi"})
    assert rebuilt.event_id
    assert rebuilt.created_at


def test_from_dict_rejects_unknown_type_and_newer_schema():
    with pytest.raises(ValueError):
        TraceEvent.from_dict({"type": "dance", "summary": "x"})
    with pytest.raises(ValueError):
        TraceEvent.from_dict({"type": "final", "summary": "x", "schema_version": 99})
    with pytest.raises(ValueError):
        TraceEvent.from_dict("not a mapping")  # type: ignore[arg-type]


def test_from_dict_ignores_unknown_keys_and_accepts_capability_name_alias():
    rebuilt = TraceEvent.from_dict(
        {
            "type": "tool_call",
            "summary": "calling",
            "capability_name": "lookup",
            "future_field": {"anything": 1},
        }
    )
    assert rebuilt.tool_name == "lookup"


def test_from_dict_strict_fails_loud_on_red_lines():
    with pytest.raises(ValueError, match="hidden reasoning"):
        TraceEvent.from_dict(
            {"type": "final", "summary": "ok", "payload": {"reasoning_content": "x"}},
            strict=True,
        )
    with pytest.raises(ValueError, match="tool_call requires tool_name"):
        TraceEvent.from_dict({"type": "tool_call", "summary": "x"}, strict=True)
    with pytest.raises(ValueError, match="state_update requires result"):
        TraceEvent.from_dict(
            {"type": "state_update", "summary": "x", "tool_name": "update_state"},
            strict=True,
        )


def test_from_dict_default_mode_sanitizes_silently():
    rebuilt = TraceEvent.from_dict(
        {
            "type": "final",
            "summary": "done sk-abcdefghijklmnop1234",
            "payload": {"reasoning_content": "x", "note": "ok"},
        }
    )
    assert "sk-" not in rebuilt.summary
    assert "reasoning_content" not in rebuilt.payload
    assert rebuilt.payload["note"] == "ok"


@pytest.mark.asyncio
async def test_turn_event_stream_is_fifo_and_stamps_turn_id():
    stream = TurnEventStream(turn_id="abc123ef")
    assert stream.emit(_event(turn_id=None, summary="first"))
    assert stream.emit(_event(summary="second"))
    stream.close()
    events = [event async for event in stream]
    assert [event.summary for event in events] == ["first", "second"]
    assert all(event.turn_id == "abc123ef" for event in events)


@pytest.mark.asyncio
async def test_turn_event_stream_close_is_idempotent_and_rejects_late_emits():
    stream = TurnEventStream(turn_id="abc123ef")
    stream.close()
    stream.close()
    assert stream.emit(_event()) is False
    events = [event async for event in stream]
    assert events == []


@pytest.mark.asyncio
async def test_turn_event_stream_supports_concurrent_producer():
    stream = TurnEventStream(turn_id="abc123ef")

    async def produce():
        for index in range(3):
            stream.emit(_event(summary=f"step {index}"))
            await asyncio.sleep(0)
        stream.close()

    producer = asyncio.create_task(produce())
    events = [event async for event in stream]
    await producer
    assert len(events) == 3


@pytest.mark.asyncio
async def test_scripted_trace_event_source_is_a_conforming_adapter():
    async def scripted_adapter() -> TraceEventSource:
        yield TraceEvent(
            type=PublicTraceType.OBSERVE,
            summary="received input",
            turn_id="adapter-turn",
        )
        yield TraceEvent(
            type=PublicTraceType.TOOL_CALL,
            summary="calling tool",
            payload={"args": {"title": "Adapter"}},
            tool_name="create_note",
            turn_id="adapter-turn",
        )
        yield TraceEvent(
            type=PublicTraceType.TOOL_RESULT,
            summary="tool returned",
            payload={"result": {"status": "created"}},
            tool_name="create_note",
            turn_id="adapter-turn",
        )
        yield TraceEvent(
            type=PublicTraceType.FINAL,
            summary="done",
            turn_id="adapter-turn",
        )

    events = [event async for event in scripted_adapter()]
    assert [event.type for event in events] == [
        PublicTraceType.OBSERVE,
        PublicTraceType.TOOL_CALL,
        PublicTraceType.TOOL_RESULT,
        PublicTraceType.FINAL,
    ]
    assert all(event.turn_id == "adapter-turn" for event in events)
