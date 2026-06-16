# Agent Stage

Agent Stage is a small, harness-independent presentation runtime for turning
public agent work events into stage frames. It owns the public event model,
redaction rules, stage-director call engine, token catalog helpers, NDJSON
ingestion, and the generic `stage_frame` contract.

The package is designed to sit downstream of any agent harness. A harness emits
sanitized public `TraceEvent` objects; Agent Stage maps those public events into
signals and validates presentation frames. Hidden reasoning, provider payloads,
credentials, app databases, and private tool internals stay outside this layer.

## Source Boundary

This repository is the open-source boundary for Agent Stage. Registry
publication is optional and requires a separate explicit decision; downstream
apps should treat the GitHub source as the canonical public boundary.

The package metadata remains in place so the repository can be used as:

- Python source package: `agent-stage`
- TypeScript source package metadata: `agent-stage-core`
- License: Apache-2.0

## From Source

```bash
python -m pip install -e ".[dev]"
npm install
npm test -- --run
npm run build
```

## Python Example

```python
from agent_stage import PublicTraceType, TraceEvent, build_stage_signal

event = TraceEvent(
    type=PublicTraceType.TOOL_CALL,
    summary="Looking up a nutrition fact",
    payload={"args": {"query": "rice"}},
    tool_name="nutrition_lookup",
)

signal = build_stage_signal(
    type=event.type,
    summary=event.summary,
    payload=event.payload,
    event_id=event.event_id,
    created_at=event.created_at,
    tool_name=event.tool_name,
)
```

## TypeScript Example

```ts
import { decodeStageFrame } from "agent-stage-core";
```

The renderer example is pending asset-format decision.

## Demo

`examples/stage-demo` is a no-key scripted demo. It uses public Agent Stage APIs
only and does not import any private app backend or reference harness.

```bash
python examples/stage-demo/run.py
python examples/stage-demo/server.py
```

## Schema

The generic frame contract lives in:

- Python package data: `src/agent_stage/stage_frame_v1.json`
- Repository schema copy: `schema/stage_frame_v1.json`

The contract is format-neutral. It carries an `asset_call.renderer` slot but
does not implement or require a concrete renderer.

## Model Calls

Agent Stage tests do not make paid model calls. Live canaries are manual and
belong to downstream apps when they change model-visible prompts, toolsets, or
production director wiring.
