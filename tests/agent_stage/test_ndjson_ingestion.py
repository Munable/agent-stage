"""Tests for NDJSON trace-event ingestion."""

from __future__ import annotations

import json

import pytest

from agent_stage import (
    NdjsonIngestStats,
    PublicTraceType,
    TraceEvent,
    iter_ndjson_trace_events,
)


def _lines() -> list[str]:
    events = [
        TraceEvent(type=PublicTraceType.OBSERVE, summary="reading", turn_id="abc123ef"),
        TraceEvent(
            type=PublicTraceType.TOOL_CALL,
            summary="calling",
            tool_name="search",
            turn_id="abc123ef",
        ),
        TraceEvent(type=PublicTraceType.FINAL, summary="done", turn_id="abc123ef"),
    ]
    return [json.dumps(event.to_dict(), ensure_ascii=False) for event in events]


def test_round_trips_str_and_bytes_lines_and_skips_blanks():
    lines = _lines()
    mixed: list[str | bytes] = [lines[0], "", "   ", lines[1].encode("utf-8"), lines[2]]
    stats = NdjsonIngestStats()
    events = list(iter_ndjson_trace_events(mixed, stats=stats))
    assert [event.type for event in events] == [
        PublicTraceType.OBSERVE,
        PublicTraceType.TOOL_CALL,
        PublicTraceType.FINAL,
    ]
    assert stats.parsed == 3
    assert stats.dropped == 0


def test_lenient_mode_drops_and_counts_bad_lines():
    lines = _lines()
    bad: list[str] = [
        "not json at all",
        json.dumps({"type": "dance", "summary": "x"}),
        json.dumps({"type": "final", "summary": "x", "schema_version": 99}),
        json.dumps(["not", "a", "mapping"]),
    ]
    stats = NdjsonIngestStats()
    events = list(iter_ndjson_trace_events([*bad, *lines], stats=stats))
    assert len(events) == 3
    assert stats.parsed == 3
    assert stats.dropped == 4


def test_strict_mode_raises_with_line_number():
    lines = [_lines()[0], "garbage"]
    with pytest.raises(ValueError, match="line 2:"):
        list(iter_ndjson_trace_events(lines, strict=True))


def test_strict_mode_enforces_red_lines_per_event():
    line = json.dumps({"type": "tool_call", "summary": "x"})
    with pytest.raises(ValueError, match="tool_call requires tool_name"):
        list(iter_ndjson_trace_events([line], strict=True))
    stats = NdjsonIngestStats()
    assert list(iter_ndjson_trace_events([line], stats=stats)) != []
    assert stats.parsed == 1


def test_stats_accumulate_across_calls():
    stats = NdjsonIngestStats()
    list(iter_ndjson_trace_events(_lines(), stats=stats))
    list(iter_ndjson_trace_events(["bad"], stats=stats))
    assert stats.parsed == 3
    assert stats.dropped == 1
