"""Stage token catalog (schema v1).

A token catalog supplies the VALUES for the registered-token slots declared
by the package-owned ``stage_frame_v1.json`` schema. It is a plain dict: each
kind is a non-empty list of items shaped ``{"id": str, "description"?: str,
...}``; extra item keys and extra top-level keys are allowed and ignored (the
schema owns the slots, the embedding app owns its instance data).
``voice_tags`` is optional.
Motions, transitions, and asset data are app instance data, not part of the
token schema.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

REQUIRED_KINDS = ("character_states", "fx", "props", "card_types")
TOKEN_KINDS = REQUIRED_KINDS + ("voice_tags",)


def _items_violation(kind: str, items: Any, *, required: bool) -> str | None:
    if items is None and not required:
        return None
    if not isinstance(items, list) or (required and not items):
        return f"missing/empty token kind: {kind}"
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            return f"{kind} items must be objects"
        token_id = item.get("id")
        if not isinstance(token_id, str) or not token_id:
            return f"{kind} items must carry a non-empty string id"
        if token_id in seen:
            return f"duplicate {kind} id: {token_id}"
        seen.add(token_id)
    return None


def token_catalog_violation(data: Any) -> str | None:
    """Return the first schema-v1 violation, or None when valid."""
    if not isinstance(data, dict):
        return "token catalog must be an object"
    for kind in REQUIRED_KINDS:
        violation = _items_violation(kind, data.get(kind), required=True)
        if violation:
            return violation
    return _items_violation("voice_tags", data.get("voice_tags"), required=False)


@dataclass(frozen=True)
class TokenCatalog:
    character_states: tuple[dict, ...]
    fx: tuple[dict, ...]
    props: tuple[dict, ...]
    card_types: tuple[dict, ...]
    voice_tags: tuple[dict, ...] = ()

    @classmethod
    def from_dict(cls, data: dict) -> "TokenCatalog":
        violation = token_catalog_violation(data)
        if violation:
            raise ValueError(violation)
        return cls(
            character_states=tuple(dict(item) for item in data["character_states"]),
            fx=tuple(dict(item) for item in data["fx"]),
            props=tuple(dict(item) for item in data["props"]),
            card_types=tuple(dict(item) for item in data["card_types"]),
            voice_tags=tuple(dict(item) for item in data.get("voice_tags") or ()),
        )

    def _items(self, kind: str) -> tuple[dict, ...]:
        if kind not in TOKEN_KINDS:
            raise ValueError(f"unknown token kind: {kind}")
        return getattr(self, kind)

    def ids(self, kind: str) -> frozenset[str]:
        return frozenset(item["id"] for item in self._items(kind))

    def frame_vocab(self) -> dict[str, frozenset[str]]:
        """Vocabulary kwargs for ``stage_frame_violation`` (card payloads are
        app-validated, so card_types is deliberately excluded)."""
        return {
            "states": self.ids("character_states"),
            "fx": self.ids("fx"),
            "props": self.ids("props"),
            "voice_tags": self.ids("voice_tags"),
        }

    def token_lines(self, kind: str) -> str:
        """Director-prompt vocabulary lines, one token per line."""
        return "\n".join(
            f'- `{it["id"]}` — {it.get("description", "")}'.rstrip(" —")
            for it in self._items(kind)
        )
