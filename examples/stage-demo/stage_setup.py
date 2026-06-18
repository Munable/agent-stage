"""Stage configuration recipe for the demo.

The runnable form of docs/agent_stage_director_configuration.md: a token
catalog, a director system prompt assembled from slots, a deterministic
scripted FrameModelCall (no LLM, no key), and a StageDirector wired through
only public agent_stage APIs.

Plugging a real model: implement the FrameModelCall protocol (async callable
taking (messages, tool_spec) and returning a StructuredToolCall) and pass it
to build_director(model_call=...). No key-reading code ships here.
"""

from __future__ import annotations

import json
from typing import Any

from agent_stage import (
    StageDirector,
    StructuredToolCall,
    TokenCatalog,
    assemble_director_prompt,
    stage_frame_violation,
)

CATALOG = TokenCatalog.from_dict(
    {
        "character_states": [
            {"id": "idle", "description": "resting between turns"},
            {"id": "thinking", "description": "reading and planning"},
            {"id": "working", "description": "running a tool"},
            {"id": "presenting", "description": "showing a result"},
            {"id": "celebrating", "description": "wrapping up happily"},
        ],
        "fx": [{"id": "sparkle", "description": "small sparkle burst"}],
        "props": [{"id": "map", "description": "trail map"}],
        "card_types": [{"id": "note", "description": "free-form note card"}],
        "voice_tags": [{"id": "tada", "description": "happy chirp"}],
    }
)

ASSET_DIRECTORY: list[dict[str, Any]] = [
    {
        "asset_id": "emoji.guide.idle",
        "renderer": "emoji",
        "anchor": None,
        "min_dwell_ms": 400,
        "interruptible": True,
        "playback": {"kind": "loop", "durationMs": 900},
    },
    {
        "asset_id": "emoji.guide.thinking",
        "renderer": "emoji",
        "anchor": None,
        "min_dwell_ms": 360,
        "interruptible": False,
        "playback": {"kind": "loop", "durationMs": 820},
    },
    {
        "asset_id": "emoji.guide.working",
        "renderer": "emoji",
        "anchor": None,
        "min_dwell_ms": 320,
        "interruptible": False,
        "playback": {"kind": "loop", "durationMs": 700},
    },
    {
        "asset_id": "emoji.guide.presenting",
        "renderer": "emoji",
        "anchor": None,
        "min_dwell_ms": 220,
        "interruptible": True,
        "playback": {"kind": "one-shot", "durationMs": 320},
    },
    {
        "asset_id": "emoji.guide.celebrating",
        "renderer": "emoji",
        "anchor": None,
        "min_dwell_ms": 220,
        "interruptible": True,
        "playback": {"kind": "one-shot", "durationMs": 420},
    },
]

ASSET_CALLS: dict[str, dict] = {
    entry["asset_id"]: {
        "asset_id": entry["asset_id"],
        "renderer": entry["renderer"],
        "anchor": entry["anchor"],
        "min_dwell_ms": entry["min_dwell_ms"],
        "interruptible": entry["interruptible"],
    }
    for entry in ASSET_DIRECTORY
}

STATE_TO_ASSET_ID = {
    "idle": "emoji.guide.idle",
    "thinking": "emoji.guide.thinking",
    "working": "emoji.guide.working",
    "presenting": "emoji.guide.presenting",
    "celebrating": "emoji.guide.celebrating",
}

REFLEX_TABLE: dict[str, dict] = {
    "emoji.guide.idle": {
        "afterMs": 180,
        "intervalMs": 900,
        "variants": [{"id": "blink", "durationMs": 90}],
    },
    "emoji.guide.thinking": {
        "afterMs": 120,
        "intervalMs": 760,
        "variants": [
            {"id": "blink", "durationMs": 80},
            {"id": "tilt", "durationMs": 120},
        ],
    },
    "emoji.guide.working": {
        "afterMs": 90,
        "intervalMs": 620,
        "variants": [{"id": "tap", "durationMs": 110}],
    },
}

DEMO_PACING = {"kind": "preserve"}

_EVENT_TO_STATE = {
    "observe": ("thinking", "Let me read this"),
    "plan": ("thinking", "Making a plan"),
    "tool_call": ("working", "Checking the trails"),
    "tool_result": ("working", "Got the results"),
    "state_update": ("working", "Saving progress"),
    "artifact": ("presenting", "Here is the card"),
    "ask_user": ("idle", None),
    "final": ("celebrating", None),
    "error": ("idle", None),
}

PERSONA = (
    "You are the stage director for a friendly trail-guide character. "
    "You translate the agent's public work events into one stage frame per "
    "decision, never inventing facts."
)
SEQUENCING_RULES = (
    "Rules: observe/plan -> thinking; tool activity -> working; artifact -> "
    "presenting with the note card; final -> celebrating. Never repeat a "
    "card after it was shown."
)
EXAMPLES = (
    'Example: [EVENT] {"event": "tool_call"} -> '
    '{"character_state": "working", "thinking_text": "Checking the trails", '
    '"fx": null, "prop": null, "card": null}'
)

SYSTEM_PROMPT = assemble_director_prompt(
    PERSONA,
    [
        "## character_state\n" + CATALOG.token_lines("character_states"),
        "## fx\n" + CATALOG.token_lines("fx"),
        "## prop\n" + CATALOG.token_lines("props"),
        "## card.type\n" + CATALOG.token_lines("card_types"),
    ],
    SEQUENCING_RULES,
    EXAMPLES,
)

TOOL_SPEC = {
    "name": "emit_stage_frame",
    "description": "Emit exactly one stage frame for the signal batch.",
    "parameters": {
        "type": "object",
        "properties": {
            "character_state": {
                "type": "string",
                "enum": sorted(CATALOG.ids("character_states")),
            },
            "thinking_text": {"type": ["string", "null"]},
            "fx": {"type": ["string", "null"], "enum": sorted(CATALOG.ids("fx")) + [None]},
            "prop": {
                "type": ["string", "null"],
                "enum": sorted(CATALOG.ids("props")) + [None],
            },
            "card": {"type": ["object", "null"]},
            "asset_call": {"type": ["object", "null"]},
        },
        "required": ["character_state"],
    },
}


def _last_event_type(messages: list[dict]) -> str:
    for line in reversed(messages[-1]["content"].splitlines()):
        if line.startswith("[EVENT] "):
            try:
                return str(json.loads(line[len("[EVENT] "):]).get("event") or "observe")
            except json.JSONDecodeError:
                return "observe"
    return "observe"


async def scripted_model_call(
    messages: list[dict], tool_spec: dict
) -> StructuredToolCall | None:
    """Deterministic FrameModelCall: maps the batch's last event to a frame."""
    event_type = _last_event_type(messages)
    state, thinking = _EVENT_TO_STATE.get(event_type, ("idle", None))
    frame: dict[str, Any] = {
        "character_state": state,
        "thinking_text": thinking,
        "fx": "sparkle" if state == "celebrating" else None,
        "prop": None,
        "card": (
            {"type": "note", "data": {"title": "Trail picks", "items": 2}}
            if event_type == "artifact"
            else None
        ),
    }
    if state == "celebrating":
        frame["voice_tag"] = "tada"
    asset_id = STATE_TO_ASSET_ID.get(state)
    if asset_id is not None:
        frame["asset_call"] = ASSET_CALLS[asset_id]
    return StructuredToolCall(
        call_id=f"scripted-{event_type}",
        name=tool_spec["name"],
        arguments_json=json.dumps(frame, ensure_ascii=False),
    )


def validate_frame(parsed: dict) -> dict:
    violation = stage_frame_violation(
        parsed, **CATALOG.frame_vocab(), asset_calls=ASSET_CALLS
    )
    if violation:
        raise ValueError(violation)
    return parsed


def safe_frame() -> dict:
    return {
        "character_state": "idle",
        "thinking_text": None,
        "fx": None,
        "prop": None,
        "card": None,
    }


def build_director(model_call=scripted_model_call) -> StageDirector:
    return StageDirector(
        tool_spec=TOOL_SPEC,
        model_call=model_call,
        validate_frame=validate_frame,
        safe_frame=safe_frame,
    )


FLUSH_EVENT_TYPES = {
    "plan", "tool_call", "tool_result", "artifact", "final", "ask_user", "error",
}
