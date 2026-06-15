# Harness Adapter Contract (v1)

How any agent harness feeds work events into `agent_stage`.

## The contract

An adapter is anything that yields `agent_stage.TraceEvent` for one turn —
formally `agent_stage.TraceEventSource = AsyncIterable[TraceEvent]`. Adapter
construction (what inputs start a turn) is harness-specific and out of scope.
The contract versions with `TRACE_SCHEMA_VERSION` (`agent_stage/trace.py`);
there is no separate adapter version number.

## Lifecycle semantics

| Concern | Contract |
| --- | --- |
| Scope | One stream per turn; never reused. |
| Turn start | First yielded event (conventionally `observe`). No start marker. |
| Turn end | Stream exhaustion ONLY. `error` events may be recoverable mid-turn; never infer turn end from event types. |
| Missing terminal | Exhaustion without a terminal event is abnormal; consumer returns the stage to idle. Adapters should synthesize an `error` first. |
| `turn_id` | Same value stamped on every event of the stream (`TurnEventStream` does this). |
| Stale events | Consumer drops `event.turn_id != active_turn_id`. |
| Ordering | Per-turn FIFO. No cross-turn guarantee. |
| Backpressure | None toward the harness: `emit()` is non-blocking fire-and-forget; slow consumers batch/coalesce. |
| Cancellation | Consumer stops iterating / calls `close()`; later `emit()` returns False; late events dropped by the stale-turn check. |
| Duplicates | `event_id` is unique; out-of-process consumers may dedupe on it. |

## Wire form and ingestion

`TraceEvent.to_dict()` is the canonical JSON object. The inverse is
`TraceEvent.from_dict(data, strict=False)`:

- default mode sanitizes silently via construction (trusted in-process
  harnesses, lenient ingestion: `try: from_dict(...) except ValueError: drop`);
- `strict=True` fails loud on hidden-reasoning content and incomplete tool
  events, checking the raw input before construction strips the evidence
  (HTTP ingestion should use this and reject per bad event).

Forward compatibility: unknown top-level keys are ignored; unknown event
types raise (lenient ingestion drops-and-counts); `capability_name` is
accepted as a read-side alias for kernel wire dicts; `schema_version` greater
than `TRACE_SCHEMA_VERSION` is rejected.

`agent_stage.iter_ndjson_trace_events(lines, strict=, stats=)` is the
canonical NDJSON ingestion implementation of these semantics (one event dict
per line; lenient drop-and-count or strict line-numbered rejection).

## Adapter patterns

- In-process harness: construct `TraceEvent` directly. Construction sanitizes
  public fields before consumers see them.
- Wire ingestion: decode `TraceEvent.to_dict()` objects with
  `TraceEvent.from_dict(...)` or `iter_ndjson_trace_events(...)`.
- Push-to-pull bridge: use `TurnEventStream` when a harness emits events from
  callbacks or a message bus.
- Scripted demo: `examples/stage-demo` shows a no-key trace source and a
  scripted frame model call.
