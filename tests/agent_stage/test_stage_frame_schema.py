"""Tests for the package-owned generic stage_frame schema."""

from __future__ import annotations

import json
from importlib import resources
from pathlib import Path
from typing import Any

from agent_stage.director import stage_frame_violation

ROOT = Path(__file__).resolve().parents[2]


def _package_schema() -> dict[str, Any]:
    ref = resources.files("agent_stage").joinpath("stage_frame_v1.json")
    return json.loads(ref.read_text(encoding="utf-8"))


def _shared_schema() -> dict[str, Any]:
    path = ROOT / "schema" / "stage_frame_v1.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_stage_frame_schema_is_owned_by_agent_stage_package() -> None:
    schema = _package_schema()
    assert schema["stage_frame_version"] == 1
    assert schema["frame_type"] == "stage_frame"
    assert schema["asset_call"]["required_fields"] == [
        "asset_id",
        "renderer",
        "anchor",
        "min_dwell_ms",
        "interruptible",
    ]


def test_schema_directory_copy_mirrors_package_schema() -> None:
    assert _shared_schema() == _package_schema()


def test_stage_frame_schema_remains_format_neutral() -> None:
    schema = _package_schema()
    serialized = json.dumps(schema, sort_keys=True)
    assert schema["field_kinds"]["asset_call"] == "asset_call_or_null"
    assert "renderer" in schema["asset_call"]["required_fields"]
    assert "image_sequence" not in serialized
    assert "video" not in serialized


def test_stage_frame_validator_docs_reference_owned_schema() -> None:
    assert "shared/stage_frame_v1.json" not in (stage_frame_violation.__doc__ or "")
