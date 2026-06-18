# Stage Manager

The Stage Manager is the client-side runtime that turns the Stage Director's
stream of `StageFrame`s into smooth playback. The Director decides *what* to
perform; the Stage Manager decides *when* — it queues frames, holds each one long
enough to read, drops frames from turns the user has moved past, and hands the
renderer a single "draw this now" state on every animation tick.

```
Stage Director (server, LLM) ──StageFrame stream──▶ Stage Manager (client) ──▶ Renderer
```

It runs entirely on the client, makes no model calls, and keeps no clock of its
own — `tick(nowMs)` is driven by the host's animation loop. That keeps it a pure
function of its inputs, so it is tested with plain values (see
`frontend/test/stage-manager.test.ts`).

## What the runtime covers now

`frontend/src/stage-manager.ts` now implements the scheduler spine plus the
first three renderer-facing motion primitives:

- **Queue + advance** — frames play in arrival order; the server may run ahead.
- **Min-dwell** — a frame is held for `asset_call.min_dwell_ms` so the character
  never flickers, unless it is `interruptible` and a newer frame is ready.
- **Turn isolation** — frames carry a `turnId`; once a newer turn starts, the
  older turn's frames (queued or on screen) are abandoned.
- **Seam** — same-turn handoffs expose a short shared transition window in
  `RenderState.seam`, giving renderers the outgoing frame, handoff start time,
  and normalized progress toward the new pose. Cross-turn switches do not seam:
  stale turns are dropped outright.
- **Reflex** — waiting frames can emit deterministic local micro-reactions from
  an injected table. Matching prefers `asset_id`, then `character_state`;
  reflex is suppressed while a seam is active so the handoff motion stays clean.
- **Loop / one-shot** — app-owned asset directory data is parsed into playback
  semantics. Looping assets expose a repeating phase; one-shot beats must play
  through once before the scheduler will yield them, then they settle into a
  held final pose.

## What to build on it next

1. **Pacing policy** — how aggressively to catch up when the server runs far ahead.

Keep each addition reproducible from `(frames + turn lifecycle + nowMs)` and
cover it with tests in the same style as the seed.
