"""Agent Stage: shared contracts for projecting agent work onto public surfaces.

This package is the authoritative home for the public work-event vocabulary,
redaction rules, director engine, and generic stage-frame contract used by
embedding apps.
"""

from agent_stage.adapter import TraceEventSource, TurnEventStream
from agent_stage.director import (
    FrameModelCall,
    StageDirector,
    StructuredToolCall,
    assemble_director_prompt,
    format_signals,
    stage_frame_violation,
)
from agent_stage.events import PublicTraceType
from agent_stage.ndjson import NdjsonIngestStats, iter_ndjson_trace_events
from agent_stage.stage_signal import build_stage_signal
from agent_stage.token_catalog import TokenCatalog, token_catalog_violation
from agent_stage.trace import TRACE_SCHEMA_VERSION, TraceEvent, completeness_violation
from agent_stage.sanitizer import (
    HIDDEN_KEYS,
    HIDDEN_TEXT_MARKERS,
    LONG_BASE64_LIKE_RE,
    PRIVATE_KEYS,
    REDACTED,
    REDACTED_REASONING,
    SENSITIVE_VALUE_RE,
    contains_hidden_reasoning,
    contains_hidden_text_marker,
    drop_private_keys,
    is_hidden_key,
    is_private_key,
    redact_public_value,
    safe_public_text,
    sanitize_public_payload,
)

__all__ = [
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
