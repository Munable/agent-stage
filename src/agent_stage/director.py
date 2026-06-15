"""Stage director core.

The harness-agnostic call engine that turns one batch of public work signals
into one presentation frame: forced structured-output model call, strict
history pairing (assistant tool_call + synthetic tool result), pop-on-failure,
and a safe-frame fallback. Prompt texts, frame vocabulary/validation, and the
model binding are injected by the embedding app; this module never imports an
LLM client.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Protocol, Sequence


def format_signals(signals: list[dict]) -> str:
    parts = []
    for s in signals:
        if s["type"] == "text":
            parts.append(f'[TEXT] {s["content"]}')
        elif s["type"] == "event":
            parts.append(f'[EVENT] {json.dumps(s["content"], ensure_ascii=False)}')
    return "\n".join(parts)


def assemble_director_prompt(
    persona: str,
    vocabulary_sections: Sequence[str],
    sequencing_rules: str,
    examples: str,
) -> str:
    """Join the director system prompt slots in canonical order."""
    return "\n\n".join([persona, *vocabulary_sections, sequencing_rules, examples])


@dataclass(frozen=True)
class StructuredToolCall:
    """One forced structured-output call returned by a model adapter.

    ``arguments_json`` is kept as the raw string so it can be written back
    into the conversation history verbatim.
    """

    call_id: str
    name: str
    arguments_json: str


class FrameModelCall(Protocol):
    """Model binding: messages + an opaque tool spec -> one structured call.

    Return None when the model produced no structured call (the director
    emits its safe frame); raise to signal a failed call.
    """

    def __call__(
        self, messages: list[dict], tool_spec: dict
    ) -> Awaitable[StructuredToolCall | None]: ...


class StageDirector:
    """One-shot director: one signal batch in, one validated frame out.

    Semantics (pinned by the embedding app's contract tests):
    - empty formatted batch returns None without touching history;
    - on success, history gains exactly [user, assistant tool_call,
      synthetic tool "ok"] entries;
    - on no-tool-call, model failure, validation failure, or timeout, the
      user message is popped and the safe frame is returned;
    - cancellation pops the user message and re-raises;
    - an optional lock serializes the append/await/append sequence.
    """

    def __init__(
        self,
        *,
        tool_spec: dict,
        model_call: FrameModelCall,
        validate_frame: Callable[[dict], dict],
        safe_frame: Callable[[], dict],
        on_fallback: Callable[[str, int, BaseException | None], None] | None = None,
        timeout_s: float = 20.0,
    ) -> None:
        self._tool_spec = tool_spec
        self._model_call = model_call
        self._validate_frame = validate_frame
        self._safe_frame = safe_frame
        self._on_fallback = on_fallback
        self._timeout_s = timeout_s

    async def __call__(
        self,
        messages: list[dict],
        signals: list[dict],
        lock: Optional[asyncio.Lock] = None,
    ) -> Optional[dict]:
        signal_text = format_signals(signals)
        if not signal_text:
            return None
        if lock is None:
            return await self._call(messages, signal_text, signal_count=len(signals))
        async with lock:
            return await self._call(messages, signal_text, signal_count=len(signals))

    async def _call(
        self,
        messages: list[dict],
        signal_text: str,
        *,
        signal_count: int,
    ) -> Optional[dict]:
        messages.append({"role": "user", "content": signal_text})
        try:
            tool_call = await asyncio.wait_for(
                self._model_call(messages, self._tool_spec),
                timeout=self._timeout_s,
            )
            if tool_call is None:
                messages.pop()
                return self._fallback("no_tool_call", signal_count, None)

            args_str = tool_call.arguments_json or "{}"
            valid_frame = self._validate_frame(json.loads(args_str))

            messages.append({
                "role": "assistant", "content": None,
                "tool_calls": [{
                    "id": tool_call.call_id, "type": "function",
                    "function": {"name": tool_call.name, "arguments": args_str},
                }],
            })
            messages.append(
                {"role": "tool", "tool_call_id": tool_call.call_id, "content": "ok"}
            )
            return valid_frame
        except asyncio.CancelledError:
            messages.pop()
            raise
        except Exception as exc:
            messages.pop()
            return self._fallback("director_call_failed", signal_count, exc)

    def _fallback(
        self, reason: str, signal_count: int, error: BaseException | None
    ) -> dict:
        if self._on_fallback is not None:
            self._on_fallback(reason, signal_count, error)
        return self._safe_frame()


def stage_frame_violation(
    frame: Any,
    *,
    states: frozenset[str] | set[str],
    fx: frozenset[str] | set[str] = frozenset(),
    props: frozenset[str] | set[str] = frozenset(),
    voice_tags: frozenset[str] | set[str] = frozenset(),
    asset_calls: dict[str, dict] | None = None,
) -> str | None:
    """Validate a frame dict against stage_frame_v1.json with injected
    vocabularies. Returns the first violation, or None when valid.

    Embedding apps with stricter contracts can wrap this with app-specific
    validation.
    """
    if not isinstance(frame, dict):
        return "frame must be an object"
    for field in ("character_state", "thinking_text", "fx", "prop", "card"):
        if field not in frame:
            return f"missing required field: {field}"
    state = frame["character_state"]
    if not isinstance(state, str) or state not in states:
        return f"unregistered character_state: {state!r}"
    if frame["thinking_text"] is not None and not isinstance(frame["thinking_text"], str):
        return "thinking_text must be a string or null"
    if frame["fx"] is not None and frame["fx"] not in fx:
        return f"unregistered fx: {frame['fx']!r}"
    if frame["prop"] is not None and frame["prop"] not in props:
        return f"unregistered prop: {frame['prop']!r}"
    card = frame["card"]
    if card is not None:
        if not isinstance(card, dict) or not isinstance(card.get("type"), str) or not isinstance(card.get("data"), dict):
            return "card must be a {type, data} envelope or null"
    voice_tag = frame.get("voice_tag")
    if voice_tag is not None and voice_tag not in voice_tags:
        return f"unregistered voice_tag: {voice_tag!r}"
    asset_call = frame.get("asset_call")
    if asset_call is not None:
        if not isinstance(asset_call, dict) or not isinstance(asset_call.get("asset_id"), str):
            return "asset_call must carry a string asset_id or be null"
        registered = (asset_calls or {}).get(asset_call["asset_id"])
        if registered is None:
            return f"unregistered asset_id: {asset_call['asset_id']!r}"
        if asset_call != registered:
            return "asset_call must match the registered catalog entry verbatim"
    return None
