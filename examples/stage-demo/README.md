# Stage Demo

A neutral, no-key, end-to-end demo of the agent-stage layer: a scripted
harness emits canonical trace events, a `StageDirector` (with a deterministic
scripted model call — no LLM) translates them into validated stage frames,
and a stdlib HTTP server ingests the same events as NDJSON from the browser.

Uses ONLY public `agent_stage` APIs; no app backend or private harness.

## Run

```bash
python examples/stage-demo/run.py        # headless: prints a JSON summary
python examples/stage-demo/server.py     # open http://127.0.0.1:8766
```

External-harness path (any language, plain NDJSON over HTTP):

```bash
curl -s http://127.0.0.1:8766/trace.ndjson > /tmp/trace.ndjson
curl -s --data-binary @/tmp/trace.ndjson http://127.0.0.1:8766/turn
```

## Plugging a real model

Implement the `FrameModelCall` protocol (async callable taking
`(messages, tool_spec)` and returning a `StructuredToolCall`) and pass it to
`stage_setup.build_director(model_call=...)`. See
`docs/agent_stage_director_configuration.md` for the full recipe.
