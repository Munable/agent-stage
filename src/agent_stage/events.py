"""Public work-event vocabulary (v1).

The event types an agent harness may expose on public surfaces: the eight
product-level events from the product master document plus ``artifact`` for
provenance-checked canonical outputs. New values are additive and require a
protocol review.
"""

from __future__ import annotations

from enum import Enum


class PublicTraceType(str, Enum):
    OBSERVE = "observe"
    PLAN = "plan"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    STATE_UPDATE = "state_update"
    ARTIFACT = "artifact"
    ASK_USER = "ask_user"
    FINAL = "final"
    ERROR = "error"
