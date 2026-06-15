"""Behavior tests for the stage director call engine."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from agent_stage.director import (
    StageDirector,
    StructuredToolCall,
    assemble_director_prompt,
    format_signals,
    stage_frame_violation,
)

TOOL_SPEC = {"type": "function", "function": {"name": "emit_frame"}}


def _director(model_call, **overrides):
    fallbacks: list[tuple[str, int, BaseException | None]] = []
    options: dict[str, Any] = dict(
        tool_spec=TOOL_SPEC,
        model_call=model_call,
        validate_frame=lambda parsed: {"validated": parsed},
        safe_frame=lambda: {"safe": True},
        on_fallback=lambda reason, count, error: fallbacks.append((reason, count, error)),
    )
    options.update(overrides)
    return StageDirector(**options), fallbacks


def _tool_call(args: dict) -> StructuredToolCall:
    return StructuredToolCall(
        call_id="call-1", name="emit_frame", arguments_json=json.dumps(args)
    )


def test_format_signals_mixed_batch():
    formatted = format_signals(
        [
            {"type": "text", "content": "thinking"},
            {"type": "event", "content": {"event": "tool_call", "tool": "lookup"}},
            {"type": "unknown", "content": "dropped"},
        ]
    )
    assert formatted == (
        '[TEXT] thinking\n[EVENT] {"event": "tool_call", "tool": "lookup"}'
    )


def test_assemble_director_prompt_joins_slots_in_order():
    assert assemble_director_prompt("p", ["v1", "v2"], "rules", "examples") == (
        "p\n\nv1\n\nv2\n\nrules\n\nexamples"
    )


@pytest.mark.asyncio
async def test_success_appends_strict_history_pairing():
    async def model_call(messages, tool_spec):
        assert tool_spec is TOOL_SPEC
        return _tool_call({"character_state": "idle"})

    director, fallbacks = _director(model_call)
    messages: list[dict] = [{"role": "system", "content": "persona"}]
    frame = await director(messages, [{"type": "text", "content": "hi"}])
    assert frame == {"validated": {"character_state": "idle"}}
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "tool"]
    assert messages[2]["tool_calls"][0]["id"] == "call-1"
    assert messages[3] == {"role": "tool", "tool_call_id": "call-1", "content": "ok"}
    assert fallbacks == []


@pytest.mark.asyncio
async def test_empty_batch_returns_none_without_history_change():
    async def model_call(messages, tool_spec):
        raise AssertionError("must not be called")

    director, _ = _director(model_call)
    messages = [{"role": "system", "content": "persona"}]
    assert await director(messages, []) is None
    assert len(messages) == 1


@pytest.mark.asyncio
async def test_no_tool_call_pops_user_message_and_returns_safe_frame():
    async def model_call(messages, tool_spec):
        return None

    director, fallbacks = _director(model_call)
    messages = [{"role": "system", "content": "persona"}]
    frame = await director(messages, [{"type": "text", "content": "hi"}])
    assert frame == {"safe": True}
    assert len(messages) == 1
    assert fallbacks == [("no_tool_call", 1, None)]


@pytest.mark.asyncio
async def test_validation_failure_pops_and_falls_back():
    async def model_call(messages, tool_spec):
        return _tool_call({"character_state": "bad"})

    def reject(parsed):
        raise ValueError("invalid frame")

    director, fallbacks = _director(model_call, validate_frame=reject)
    messages = [{"role": "system", "content": "persona"}]
    frame = await director(messages, [{"type": "text", "content": "hi"}])
    assert frame == {"safe": True}
    assert len(messages) == 1
    assert fallbacks[0][0] == "director_call_failed"
    assert isinstance(fallbacks[0][2], ValueError)


@pytest.mark.asyncio
async def test_cancellation_pops_and_reraises():
    async def model_call(messages, tool_spec):
        raise asyncio.CancelledError()

    director, fallbacks = _director(model_call)
    messages = [{"role": "system", "content": "persona"}]
    with pytest.raises(asyncio.CancelledError):
        await director(messages, [{"type": "text", "content": "hi"}])
    assert len(messages) == 1
    assert fallbacks == []


@pytest.mark.asyncio
async def test_lock_serializes_concurrent_calls():
    order: list[str] = []

    async def model_call(messages, tool_spec):
        order.append("start")
        await asyncio.sleep(0.01)
        order.append("end")
        return _tool_call({"character_state": "idle"})

    director, _ = _director(model_call)
    lock = asyncio.Lock()
    messages = [{"role": "system", "content": "persona"}]
    await asyncio.gather(
        director(messages, [{"type": "text", "content": "a"}], lock),
        director(messages, [{"type": "text", "content": "b"}], lock),
    )
    assert order == ["start", "end", "start", "end"]
    assert [m["role"] for m in messages] == [
        "system", "user", "assistant", "tool", "user", "assistant", "tool",
    ]


def test_public_surface_is_stable():
    import inspect

    import agent_stage

    for name in (
        "StageDirector",
        "FrameModelCall",
        "StructuredToolCall",
        "assemble_director_prompt",
        "format_signals",
        "stage_frame_violation",
    ):
        assert hasattr(agent_stage, name), name

    assert list(inspect.signature(StageDirector.__init__).parameters) == [
        "self", "tool_spec", "model_call", "validate_frame", "safe_frame",
        "on_fallback", "timeout_s",
    ]
    assert list(inspect.signature(assemble_director_prompt).parameters) == [
        "persona", "vocabulary_sections", "sequencing_rules", "examples",
    ]
    assert list(inspect.signature(stage_frame_violation).parameters) == [
        "frame", "states", "fx", "props", "voice_tags", "asset_calls",
    ]


def test_stage_frame_violation_rules():
    vocab: dict[str, Any] = dict(
        states={"idle"},
        fx={"sparkle"},
        props={"pan"},
        voice_tags={"hello"},
        asset_calls={
            "seq.idle": {
                "asset_id": "seq.idle",
                "renderer": "image_sequence",
                "anchor": None,
                "min_dwell_ms": 400,
                "interruptible": True,
            }
        },
    )
    base = {
        "character_state": "idle",
        "thinking_text": None,
        "fx": None,
        "prop": None,
        "card": None,
    }
    assert stage_frame_violation(base, **vocab) is None
    assert stage_frame_violation({**base, "character_state": "dance"}, **vocab)
    assert stage_frame_violation({**base, "fx": "explode"}, **vocab)
    assert stage_frame_violation({**base, "card": {"type": 1, "data": {}}}, **vocab)
    assert stage_frame_violation({"character_state": "idle"}, **vocab)
    good_call = dict(vocab["asset_calls"]["seq.idle"])
    assert stage_frame_violation({**base, "asset_call": good_call}, **vocab) is None
    tampered = {**good_call, "min_dwell_ms": 9999}
    assert stage_frame_violation({**base, "asset_call": tampered}, **vocab)
