"""NDJSON trace-event ingestion.

The canonical implementation of the wire-ingestion semantics documented in
the harness adapter contract: one JSON object per line, each the canonical
``TraceEvent.to_dict()`` shape. Lenient mode drops-and-counts bad lines;
strict mode raises on the first bad line with a 1-based line number.

Synchronous generator on purpose: HTTP bodies arrive as complete or chunked
byte streams; an async variant adds nothing for stdlib servers and can be
trivially wrapped later.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Iterable, Iterator

from agent_stage.trace import TraceEvent


@dataclass
class NdjsonIngestStats:
    parsed: int = 0
    dropped: int = 0


def iter_ndjson_trace_events(
    lines: Iterable[str | bytes],
    *,
    strict: bool = False,
    stats: NdjsonIngestStats | None = None,
) -> Iterator[TraceEvent]:
    for line_number, raw_line in enumerate(lines, start=1):
        text = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else raw_line
        text = text.strip()
        if not text:
            continue
        try:
            event = TraceEvent.from_dict(json.loads(text), strict=strict)
        except (json.JSONDecodeError, ValueError, TypeError) as exc:
            if strict:
                raise ValueError(f"line {line_number}: {exc}") from exc
            if stats is not None:
                stats.dropped += 1
            continue
        if stats is not None:
            stats.parsed += 1
        yield event
