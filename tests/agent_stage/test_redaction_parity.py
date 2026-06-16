from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from agent_stage.sanitizer import (
    contains_hidden_reasoning,
    drop_private_keys,
    safe_public_text,
    sanitize_public_payload,
)

ROOT = Path(__file__).resolve().parents[2]


def _fixture() -> dict[str, Any]:
    return json.loads((ROOT / "tests" / "parity" / "redaction_cases.json").read_text(encoding="utf-8"))


def _decode_special_values(value: Any) -> Any:
    if value == "__NON_FINITE_NAN__":
        return math.nan
    if value == "__NON_FINITE_INFINITY__":
        return math.inf
    if isinstance(value, dict):
        return {key: _decode_special_values(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_decode_special_values(child) for child in value]
    return value


@pytest.mark.parametrize("case", _fixture()["payload_cases"], ids=lambda case: case["name"])
def test_python_sanitizer_matches_redaction_payload_fixture(case: dict[str, Any]) -> None:
    assert sanitize_public_payload(_decode_special_values(case["input"])) == case["expected"]


@pytest.mark.parametrize("case", _fixture()["text_cases"], ids=lambda case: case["name"])
def test_python_safe_public_text_matches_redaction_fixture(case: dict[str, Any]) -> None:
    assert (
        safe_public_text(
            case["input"],
            fallback=case["fallback"],
            max_chars=case["max_chars"],
        )
        == case["expected"]
    )


@pytest.mark.parametrize(
    "case",
    _fixture()["drop_private_key_cases"],
    ids=lambda case: case["name"],
)
def test_python_drop_private_keys_matches_redaction_fixture(case: dict[str, Any]) -> None:
    assert drop_private_keys(case["input"]) == case["expected"]


@pytest.mark.parametrize(
    "case",
    _fixture()["hidden_reasoning_cases"],
    ids=lambda case: case["name"],
)
def test_python_hidden_reasoning_detection_matches_redaction_fixture(case: dict[str, Any]) -> None:
    assert contains_hidden_reasoning(case["input"]) is case["expected"]
