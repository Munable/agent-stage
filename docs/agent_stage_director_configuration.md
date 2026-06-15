# Stage Director Configuration

The stable recipe for configuring `agent_stage.StageDirector` in an embedding
app. The neutral runnable form is the stage-demo example.

## Prompt slots

`assemble_director_prompt(persona, vocabulary_sections, sequencing_rules,
examples)` joins the system prompt slots with blank lines, in that order.
An embedding app typically instantiates it with persona, asset catalog prompt,
token catalog, sequencing rules, and few-shot examples.

## Constructor injections

`StageDirector(tool_spec=, model_call=, validate_frame=, safe_frame=,
on_fallback=None, timeout_s=20.0)`:

- `tool_spec`: opaque provider-shaped dict passed through to `model_call`
  verbatim.
- `model_call`: a `FrameModelCall` — async, returns a `StructuredToolCall`
  or None when the model produced no structured call. The package never
  imports an LLM client.
- `validate_frame`: parsed tool args -> canonical frame dict; raise to
  trigger the safe frame. Apps with stricter contracts validate here; generic
  consumers raise on `stage_frame_violation(frame, **vocab)`.
- `safe_frame`: zero-argument factory for the graceful-degradation frame.
- `on_fallback(reason, signal_count, error)`: observation hook for
  `no_tool_call` / `director_call_failed` fallbacks.

Engine semantics (history pairing, pop-on-failure, cancellation, lock
serialization, empty-batch None) are pinned by
`tests/agent_stage/test_director_core.py`.

## Vocabulary and catalog injection

Token values come from a `TokenCatalog` (schema v1,
`agent_stage/token_catalog.py`): `catalog.frame_vocab()` feeds
`stage_frame_violation`, `catalog.token_lines(kind)` renders prompt
vocabulary sections. `asset_call` outputs must equal the registered catalog
entry verbatim (`schema/stage_frame_v1.json` rule); pass the registered calls
as `asset_calls=` to `stage_frame_violation`.

## Stability

The frame shape versions with `stage_frame_v1.json`'s `stage_frame_version`.
The constructor surface is append-only: new parameters are keyword-only with
defaults. The signatures above are pinned by
`tests/agent_stage/test_director_core.py::test_public_surface_is_stable`.
