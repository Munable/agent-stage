"""Contract tests for the token catalog schema (v1)."""

from __future__ import annotations

import pytest

from agent_stage.director import stage_frame_violation
import agent_stage.token_catalog as token_catalog
from agent_stage.token_catalog import TokenCatalog, token_catalog_violation


def _catalog_data() -> dict:
    return {
        "character_states": [
            {"id": "idle", "description": "resting"},
            {"id": "think"},
        ],
        "fx": [{"id": "sparkle", "description": "small sparkle burst"}],
        "props": [{"id": "pan", "description": "frying pan"}],
        "card_types": [{"id": "generic", "description": "free-form card"}],
        "voice_tags": [{"id": "hello"}],
        "motions": [{"id": "nuri.extra", "ignored": True}],
        "asset_root": "/character/whatever",
    }


def test_valid_catalog_passes_and_extra_keys_are_ignored():
    assert token_catalog_violation(_catalog_data()) is None


def test_token_catalog_docs_reference_package_owned_stage_frame_schema():
    assert "shared/stage_frame_v1.json" not in (token_catalog.__doc__ or "")
    assert "package-owned" in (token_catalog.__doc__ or "")


def test_violations():
    assert token_catalog_violation("nope") == "token catalog must be an object"
    data = _catalog_data()
    del data["fx"]
    assert token_catalog_violation(data) == "missing/empty token kind: fx"
    data = _catalog_data()
    data["props"] = []
    assert token_catalog_violation(data) == "missing/empty token kind: props"
    data = _catalog_data()
    data["card_types"] = [{"id": "generic"}, {"id": "generic"}]
    assert token_catalog_violation(data) == "duplicate card_types id: generic"
    data = _catalog_data()
    data["character_states"] = ["idle"]
    assert token_catalog_violation(data) == "character_states items must be objects"
    data = _catalog_data()
    data["voice_tags"] = [{"id": ""}]
    assert (
        token_catalog_violation(data)
        == "voice_tags items must carry a non-empty string id"
    )


def test_voice_tags_are_optional():
    data = _catalog_data()
    del data["voice_tags"]
    assert token_catalog_violation(data) is None
    catalog = TokenCatalog.from_dict(data)
    assert catalog.voice_tags == ()
    assert catalog.ids("voice_tags") == frozenset()


def test_from_dict_round_trip_and_ids():
    catalog = TokenCatalog.from_dict(_catalog_data())
    assert catalog.ids("character_states") == frozenset({"idle", "think"})
    assert catalog.ids("card_types") == frozenset({"generic"})
    with pytest.raises(ValueError, match="unknown token kind"):
        catalog.ids("motions")
    with pytest.raises(ValueError, match="missing/empty token kind"):
        TokenCatalog.from_dict({})


def test_frame_vocab_feeds_stage_frame_violation():
    from typing import Any

    catalog = TokenCatalog.from_dict(_catalog_data())
    vocab: dict[str, Any] = dict(catalog.frame_vocab())
    assert set(vocab) == {"states", "fx", "props", "voice_tags"}
    frame = {
        "character_state": "idle",
        "thinking_text": None,
        "fx": "sparkle",
        "prop": None,
        "card": {"type": "generic", "data": {}},
        "voice_tag": "hello",
    }
    assert stage_frame_violation(frame, **vocab) is None
    assert stage_frame_violation({**frame, "fx": "explode"}, **vocab)


def test_token_lines_pins_prompt_format_including_empty_description():
    catalog = TokenCatalog.from_dict(_catalog_data())
    assert catalog.token_lines("character_states") == (
        "- `idle` — resting\n- `think`"
    )
    assert catalog.token_lines("fx") == "- `sparkle` — small sparkle burst"
    with pytest.raises(ValueError, match="unknown token kind"):
        catalog.token_lines("motions")
