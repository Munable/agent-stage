// Public text and payload hygiene for agent-visible surfaces.
// Mirrors src/agent_stage/sanitizer.py; keep key lists and patterns in sync.

export const HIDDEN_KEYS = new Set([
  "chain_of_thought",
  "cot",
  "hidden_reasoning",
  "reasoning_content",
  "thoughts",
]);

export const PRIVATE_KEYS = new Set([
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
]);

export const HIDDEN_TEXT_MARKERS = new Set([
  "chain_of_thought",
  "chain-of-thought",
  "hidden_reasoning",
  "reasoning_content",
  "<think",
  "</think",
]);

export const REDACTED = "[redacted]";
export const REDACTED_REASONING = "[internal_reasoning_redacted]";

export const SENSITIVE_VALUE_RE =
  /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|data:image\/[^;,\s]+;base64,[A-Za-z0-9+/=_-]+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/gi;

export const LONG_BASE64_LIKE_RE =
  /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/]{96,}={0,2}(?![A-Za-z0-9+/=_-])/g;

const HIDDEN_WORD_RE = /(?<![a-z0-9_])(cot|thoughts)(?![a-z0-9_])/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactKey(key: unknown): string {
  return String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const HIDDEN_COMPACT = new Set(Array.from(HIDDEN_KEYS, (key) => compactKey(key)));
const PRIVATE_COMPACT = new Set(Array.from(PRIVATE_KEYS, (key) => compactKey(key)));

export function isHiddenKey(key: unknown): boolean {
  const normalized = String(key).trim().toLowerCase();
  return HIDDEN_KEYS.has(normalized) || HIDDEN_COMPACT.has(compactKey(key));
}

export function isPrivateKey(key: unknown): boolean {
  const normalized = String(key).trim().toLowerCase();
  const compact = compactKey(key);
  return (
    PRIVATE_KEYS.has(normalized) ||
    PRIVATE_COMPACT.has(compact) ||
    normalized.endsWith("_base64") ||
    compact.endsWith("base64") ||
    (normalized.startsWith("raw_") && normalized !== "raw") ||
    (compact.startsWith("raw") && compact !== "raw") ||
    (normalized.startsWith("provider_") && normalized !== "provider") ||
    (compact.startsWith("provider") && compact !== "provider")
  );
}

export function containsHiddenTextMarker(value: string): boolean {
  const lowered = value.toLowerCase();
  for (const marker of Array.from(HIDDEN_TEXT_MARKERS)) {
    if (lowered.includes(marker)) return true;
  }
  return HIDDEN_WORD_RE.test(lowered);
}

export function containsHiddenReasoning(value: unknown): boolean {
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (isHiddenKey(key)) return true;
      if (containsHiddenReasoning(child)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((item) => containsHiddenReasoning(item));
  if (typeof value === "string") return containsHiddenTextMarker(value);
  return false;
}

export function redactPublicValue(value: unknown): string {
  const text = String(value || "");
  return text.replace(SENSITIVE_VALUE_RE, REDACTED).replace(LONG_BASE64_LIKE_RE, REDACTED);
}

export function safePublicText(
  value: unknown,
  options: { fallback?: string; maxChars?: number } = {},
): string {
  const fallback = options.fallback ?? "";
  const maxChars = options.maxChars ?? 160;
  const text = redactPublicValue(value).trim().split(/\s+/).filter(Boolean).join(" ");
  if (!text || containsHiddenTextMarker(text)) return fallback;
  return text.slice(0, maxChars);
}

export function sanitizePublicPayload(value: unknown): unknown {
  if (isRecord(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (isHiddenKey(key) || isPrivateKey(key)) continue;
      cleaned[String(key)] = sanitizePublicPayload(child);
    }
    return cleaned;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePublicPayload(item));
  if (typeof value === "string" && containsHiddenTextMarker(value)) {
    return REDACTED_REASONING;
  }
  if (typeof value === "string") return redactPublicValue(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED;
  if (value === undefined) return safePublicText(value, { fallback: REDACTED });
  return safePublicText(value, { fallback: REDACTED, maxChars: 160 });
}

export function dropPrivateKeys(value: unknown): unknown {
  if (isRecord(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (isPrivateKey(key)) continue;
      cleaned[key] = dropPrivateKeys(child);
    }
    return cleaned;
  }
  if (Array.isArray(value)) return value.map((item) => dropPrivateKeys(item));
  if (typeof value === "string") return redactPublicValue(value);
  return value;
}

// Backward-compatible TypeScript aliases retained for existing consumers.
export const SENSITIVE_KEYS = new Set([
  ...Array.from(HIDDEN_KEYS),
  ...Array.from(PRIVATE_KEYS),
]);
export const isSensitiveKey = (key: string): boolean => isHiddenKey(key) || isPrivateKey(key);
export const sanitizeText = (text: string, maxChars?: number): string =>
  safePublicText(text, {
    maxChars: maxChars ?? Number.MAX_SAFE_INTEGER,
  });
export const sanitizePayload = (value: unknown, _maxChars = 480): unknown =>
  sanitizePublicPayload(value);
