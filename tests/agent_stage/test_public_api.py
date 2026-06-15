"""Public API freeze tests for the 0.x agent_stage surface."""

from __future__ import annotations

import agent_stage


EXPECTED_PUBLIC_API = [
    "FrameModelCall",
    "NdjsonIngestStats",
    "PublicTraceType",
    "StageDirector",
    "StructuredToolCall",
    "TRACE_SCHEMA_VERSION",
    "TokenCatalog",
    "TraceEvent",
    "TraceEventSource",
    "TurnEventStream",
    "token_catalog_violation",
    "assemble_director_prompt",
    "build_stage_signal",
    "completeness_violation",
    "format_signals",
    "iter_ndjson_trace_events",
    "stage_frame_violation",
    "HIDDEN_KEYS",
    "HIDDEN_TEXT_MARKERS",
    "LONG_BASE64_LIKE_RE",
    "PRIVATE_KEYS",
    "REDACTED",
    "REDACTED_REASONING",
    "SENSITIVE_VALUE_RE",
    "contains_hidden_reasoning",
    "contains_hidden_text_marker",
    "drop_private_keys",
    "is_hidden_key",
    "is_private_key",
    "redact_public_value",
    "safe_public_text",
    "sanitize_public_payload",
]


def test_public_api_all_is_pinned_for_agent_stage_0x() -> None:
    assert agent_stage.__all__ == EXPECTED_PUBLIC_API


def test_public_api_exports_are_bound() -> None:
    for name in EXPECTED_PUBLIC_API:
        assert getattr(agent_stage, name) is not None, name
