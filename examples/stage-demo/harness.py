"""Scripted fake harness for the stage demo.

A neutral "trail guide" agent turn expressed as canonical trace events —
no model, no API key. Demonstrates all three adapter entry points: direct
TraceEvent construction, the TurnEventStream push bridge, and the NDJSON
wire form.
"""

from __future__ import annotations

import asyncio
import json

from agent_stage import PublicTraceType, TraceEvent, TurnEventStream


def scripted_turn(turn_id: str = "demo0001") -> list[TraceEvent]:
    return [
        TraceEvent(
            type=PublicTraceType.OBSERVE,
            summary="Reading the request for an easy waterfall hike",
            turn_id=turn_id,
        ),
        TraceEvent(
            type=PublicTraceType.PLAN,
            summary="I will search the trail index first",
            turn_id=turn_id,
        ),
        TraceEvent(
            type=PublicTraceType.TOOL_CALL,
            summary="Searching trails near the lake",
            tool_name="search_trails",
            payload={"args": {"difficulty": "easy", "feature": "waterfall"}},
            turn_id=turn_id,
        ),
        TraceEvent(
            type=PublicTraceType.TOOL_RESULT,
            summary="Found two matching trails",
            tool_name="search_trails",
            payload={"result": {"matches": ["Silver Falls Loop", "Mossy Creek Path"]}},
            turn_id=turn_id,
        ),
        TraceEvent(
            type=PublicTraceType.ARTIFACT,
            summary="Prepared the trail recommendation card",
            payload={"artifact_type": "note"},
            turn_id=turn_id,
        ),
        TraceEvent(
            type=PublicTraceType.FINAL,
            summary="Silver Falls Loop fits best: easy, shaded, waterfall view",
            turn_id=turn_id,
        ),
    ]


async def scripted_event_source(turn_id: str = "demo0001"):
    """The push-bridge form: a concurrent producer feeding TurnEventStream."""
    stream = TurnEventStream(turn_id=turn_id)

    async def produce() -> None:
        for event in scripted_turn(turn_id):
            stream.emit(event)
            await asyncio.sleep(0)
        stream.close()

    producer = asyncio.create_task(produce())
    async for event in stream:
        yield event
    await producer


def scripted_turn_ndjson(turn_id: str = "demo0001") -> str:
    """The wire form an external client would POST: one event dict per line."""
    return "\n".join(
        json.dumps(event.to_dict(), ensure_ascii=False)
        for event in scripted_turn(turn_id)
    ) + "\n"
