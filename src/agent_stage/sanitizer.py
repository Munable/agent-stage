"""Public text and payload hygiene for agent-visible surfaces.

Single authoritative implementation of the redaction rules used before data
reaches public presentation layers.
"""

from __future__ import annotations

import math
import re
from typing import Any

HIDDEN_KEYS = {"chain_of_thought", "cot", "hidden_reasoning", "reasoning_content", "thoughts"}
PRIVATE_KEYS = {
    "access_token",
    "api_key",
    "authorization",
    "image_base64",
    "image_bytes",
    "image_data",
    "jwt",
    "provider_payload",
    "provider_request",
    "provider_response",
    "provider_result",
    "raw_args",
    "raw_image",
    "raw_image_payload",
    "raw_payload",
    "raw_provider_payload",
    "raw_result",
    "refresh_token",
    "secret",
    "token",
}
HIDDEN_TEXT_MARKERS = {
    "chain_of_thought",
    "chain-of-thought",
    "hidden_reasoning",
    "reasoning_content",
    "<think",
    "</think",
}
SENSITIVE_VALUE_RE = re.compile(
    r"(?i)("
    r"sk-[A-Za-z0-9_-]{12,}"
    r"|Bearer\s+[A-Za-z0-9._-]{12,}"
    r"|data:image/[^;,\s]+;base64,[A-Za-z0-9+/=_-]+"
    r"|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}"
    r")"
)
LONG_BASE64_LIKE_RE = re.compile(
    r"(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/]{96,}={0,2}(?![A-Za-z0-9+/=_-])"
)
REDACTED = "[redacted]"
REDACTED_REASONING = "[internal_reasoning_redacted]"

_HIDDEN_WORD_RE = re.compile(r"(?<![a-z0-9_])(cot|thoughts)(?![a-z0-9_])")


def _compact_key(key: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(key).strip().lower())


_HIDDEN_COMPACT = {_compact_key(item) for item in HIDDEN_KEYS}
_PRIVATE_COMPACT = {_compact_key(item) for item in PRIVATE_KEYS}


def is_hidden_key(key: Any) -> bool:
    normalized = str(key).strip().lower()
    return normalized in HIDDEN_KEYS or _compact_key(key) in _HIDDEN_COMPACT


def is_private_key(key: Any) -> bool:
    normalized = str(key).strip().lower()
    compact = _compact_key(key)
    return (
        normalized in PRIVATE_KEYS
        or compact in _PRIVATE_COMPACT
        or normalized.endswith("_base64")
        or compact.endswith("base64")
        or (normalized.startswith("raw_") and normalized != "raw")
        or (compact.startswith("raw") and compact != "raw")
        or (normalized.startswith("provider_") and normalized != "provider")
        or (compact.startswith("provider") and compact != "provider")
    )


def contains_hidden_text_marker(value: str) -> bool:
    lowered = value.lower()
    if any(marker in lowered for marker in HIDDEN_TEXT_MARKERS):
        return True
    return bool(_HIDDEN_WORD_RE.search(lowered))


def contains_hidden_reasoning(value: Any) -> bool:
    """Return whether a value tree contains hidden-reasoning keys or markers."""
    if isinstance(value, dict):
        for key, child in value.items():
            if is_hidden_key(key):
                return True
            if contains_hidden_reasoning(child):
                return True
        return False
    if isinstance(value, list):
        return any(contains_hidden_reasoning(item) for item in value)
    if isinstance(value, str):
        return contains_hidden_text_marker(value)
    return False


def redact_public_value(value: Any) -> str:
    text = str(value or "")
    text = SENSITIVE_VALUE_RE.sub(REDACTED, text)
    return LONG_BASE64_LIKE_RE.sub(REDACTED, text)


def safe_public_text(value: Any, *, fallback: str = "", max_chars: int = 160) -> str:
    text = " ".join(redact_public_value(value).strip().split())
    if not text or contains_hidden_text_marker(text):
        return fallback
    return text[:max_chars]


def sanitize_public_payload(value: Any) -> Any:
    """Drop hidden/private keys and redact sensitive or hidden string values."""
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, child in value.items():
            if is_hidden_key(key) or is_private_key(key):
                continue
            cleaned[str(key)] = sanitize_public_payload(child)
        return cleaned
    if isinstance(value, list):
        return [sanitize_public_payload(item) for item in value]
    if isinstance(value, str) and contains_hidden_text_marker(value):
        return REDACTED_REASONING
    if isinstance(value, str):
        return redact_public_value(value)
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else REDACTED
    return safe_public_text(value, fallback=REDACTED, max_chars=160)


def drop_private_keys(value: Any) -> Any:
    """Drop private keys and redact string values, keeping hidden keys intact.

    Unlike :func:`sanitize_public_payload`, hidden-reasoning keys are NOT
    removed here, so a validator can fail loudly on them instead of silently
    accepting a payload that tried to smuggle hidden reasoning.
    """
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, child in value.items():
            if is_private_key(key):
                continue
            cleaned[key] = drop_private_keys(child)
        return cleaned
    if isinstance(value, list):
        return [drop_private_keys(item) for item in value]
    if isinstance(value, str):
        return redact_public_value(value)
    return value
