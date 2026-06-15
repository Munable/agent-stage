"""Stage director signal shape.

The dict envelope a stage director consumes for one public work event. Takes
plain fields (not a TraceEvent) so callers that already validated/sanitized
their event can build the signal without re-sanitizing.
"""

from __future__ import annotations

from typing import Any

from agent_stage.events import PublicTraceType


def build_stage_signal(
    *,
    type: PublicTraceType,
    summary: str,
    payload: dict[str, Any],
    event_id: str,
    created_at: str,
    turn_id: str | None = None,
    tool_name: str | None = None,
) -> dict[str, Any]:
    content: dict[str, Any] = {
        "event": type.value,
        "summary": summary,
        "payload": payload,
        "trace_id": event_id,
        "created_at": created_at,
    }
    if turn_id:
        content["turn_id"] = turn_id
    if tool_name:
        content["tool"] = tool_name
    return {"type": "event", "content": content}
