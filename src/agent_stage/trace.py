"""Canonical public trace event.

The single typed event shape that agent harnesses project their work into.
Construction sanitizes by default (summary and payload pass through the
shared sanitizer); apps that need fail-loud validation instead use
:func:`completeness_violation` together with the sanitizer's
``contains_hidden_reasoning``/``safe_public_text`` checks.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping
from uuid import uuid4

from agent_stage.events import PublicTraceType
from agent_stage.sanitizer import (
    contains_hidden_reasoning,
    contains_hidden_text_marker,
    safe_public_text,
    sanitize_public_payload,
)
from agent_stage.stage_signal import build_stage_signal

TRACE_SCHEMA_VERSION = 1

_TOOL_EVENT_TYPES = {
    PublicTraceType.TOOL_CALL,
    PublicTraceType.TOOL_RESULT,
    PublicTraceType.STATE_UPDATE,
}


def completeness_violation(
    type_: PublicTraceType,
    payload: dict[str, Any],
    tool_name: str | None,
) -> str | None:
    """Return the fail-loud completeness error for an event, or None if valid."""
    if type_ in _TOOL_EVENT_TYPES and not tool_name:
        return f"{type_.value} requires tool_name"
    if type_ == PublicTraceType.STATE_UPDATE and "result" not in payload:
        return "state_update requires result payload"
    return None


@dataclass(frozen=True)
class TraceEvent:
    type: PublicTraceType
    summary: str
    payload: dict[str, Any] = field(default_factory=dict)
    tool_name: str | None = None
    turn_id: str | None = None
    event_id: str = field(default_factory=lambda: uuid4().hex)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    schema_version: int = TRACE_SCHEMA_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "summary",
            safe_public_text(self.summary, fallback="Working on this step", max_chars=160),
        )
        payload = sanitize_public_payload(self.payload)
        object.__setattr__(self, "payload", payload if isinstance(payload, dict) else {})

    def to_dict(self) -> dict[str, Any]:
        payload = sanitize_public_payload(self.payload)
        if not isinstance(payload, dict):
            payload = {}
        return {
            "type": self.type.value,
            "summary": self.summary,
            "payload": copy.deepcopy(payload),
            "tool_name": (
                safe_public_text(self.tool_name, fallback="", max_chars=100)
                if self.tool_name is not None
                else None
            ),
            "turn_id": (
                safe_public_text(self.turn_id, fallback="", max_chars=120)
                if self.turn_id is not None
                else None
            ),
            "event_id": safe_public_text(self.event_id, fallback="", max_chars=120),
            "created_at": safe_public_text(self.created_at, fallback="", max_chars=80),
            "schema_version": self.schema_version,
        }

    def to_stage_signal(self) -> dict[str, Any]:
        return build_stage_signal(
            type=self.type,
            summary=self.summary,
            payload=self.payload,
            event_id=self.event_id,
            created_at=self.created_at,
            turn_id=self.turn_id,
            tool_name=self.tool_name,
        )

    @classmethod
    def from_dict(cls, data: Mapping[str, Any], *, strict: bool = False) -> "TraceEvent":
        """Build an event from its canonical wire dict (see ``to_dict``).

        Default mode sanitizes silently via construction; ``strict=True``
        rejects hidden-reasoning content and incomplete tool events instead,
        checking the RAW input before construction strips the evidence.
        Unknown keys are ignored; ``capability_name`` is accepted as a
        read-side alias for kernel wire dicts; a ``schema_version`` greater
        than ``TRACE_SCHEMA_VERSION`` is rejected.
        """
        if not isinstance(data, Mapping):
            raise ValueError("trace event must be a mapping")
        type_ = PublicTraceType(str(data.get("type")))
        raw_version = data.get("schema_version")
        if raw_version is not None and int(raw_version) > TRACE_SCHEMA_VERSION:
            raise ValueError(f"unsupported trace schema_version: {raw_version}")
        payload_value = data.get("payload")
        raw_payload: dict[str, Any] = payload_value if isinstance(payload_value, dict) else {}
        tool_name = data.get("tool_name")
        if tool_name is None:
            tool_name = data.get("capability_name")
        if not isinstance(tool_name, str):
            tool_name = None
        summary = str(data.get("summary") or "")
        if strict:
            if contains_hidden_reasoning(raw_payload) or contains_hidden_text_marker(summary):
                raise ValueError("trace event must not expose hidden reasoning")
            violation = completeness_violation(type_, raw_payload, tool_name)
            if violation:
                raise ValueError(violation)
        turn_id = data.get("turn_id")
        if not isinstance(turn_id, str):
            turn_id = None
        event_id = data.get("event_id")
        if not (isinstance(event_id, str) and event_id):
            event_id = uuid4().hex
        created_at = data.get("created_at")
        if not (isinstance(created_at, str) and created_at):
            created_at = datetime.now(timezone.utc).isoformat()
        return cls(
            type=type_,
            summary=summary,
            payload=dict(raw_payload),
            tool_name=tool_name,
            turn_id=turn_id,
            event_id=event_id,
            created_at=created_at,
        )
