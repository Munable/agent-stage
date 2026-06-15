"""Harness adapter contract (v1).

An adapter is any async iterable of :class:`TraceEvent` scoped to ONE turn.
Stream exhaustion is the only authoritative end-of-turn signal: a well-formed
turn ends with a terminal event (``final``, ``ask_user``, or an ``error``
carrying terminal markers) as its last event, but ``error`` events may also
occur mid-turn and be recoverable, so consumers must never infer turn end
from event types. Ordering is per-turn FIFO; stale-turn filtering is the
consumer's one-line ``event.turn_id != active_turn_id`` check.

The contract versions with ``TRACE_SCHEMA_VERSION`` — there is no separate
adapter version number.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import AsyncIterable, AsyncIterator

from agent_stage.trace import TraceEvent

TraceEventSource = AsyncIterable[TraceEvent]


class TurnEventStream:
    """Push-to-pull bridge for callback-shaped harnesses (one per turn).

    ``emit()`` is non-blocking fire-and-forget: presentation must never block
    the agent. ``close()`` ends iteration and is idempotent; emits after close
    return False so a cancelled harness can stop early. Events are stamped
    with the stream's turn_id so stale-turn drops work downstream.
    """

    def __init__(self, *, turn_id: str | None = None) -> None:
        self.turn_id = turn_id
        self._queue: asyncio.Queue[TraceEvent | None] = asyncio.Queue()
        self._closed = False

    def emit(self, event: TraceEvent) -> bool:
        if self._closed:
            return False
        if self.turn_id is not None and event.turn_id != self.turn_id:
            event = replace(event, turn_id=self.turn_id)
        self._queue.put_nowait(event)
        return True

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._queue.put_nowait(None)

    async def __aiter__(self) -> AsyncIterator[TraceEvent]:
        while (event := await self._queue.get()) is not None:
            yield event
