// Single authoritative TypeScript copy of the public-surface redaction rules.
// Mirrors agent_stage/sanitizer.py; keep key lists and patterns in sync.

export const SENSITIVE_KEYS = new Set([
  "access_token",
  "api_key",
  "authorization",
  "chain_of_thought",
  "cot",
  "hidden_reasoning",
  "image_base64",
  "image_bytes",
  "image_data",
  "jwt",
  "messages",
  "provider_request",
  "provider_payload",
  "provider_response",
  "provider_result",
  "raw",
  "raw_args",
  "raw_image",
  "raw_image_payload",
  "raw_payload",
  "raw_provider_payload",
  "raw_result",
  "reasoning_content",
  "refresh_token",
  "secret",
  "thoughts",
  "token",
]);
const SENSITIVE_KEY_COMPACTS = new Set(
  Array.from(SENSITIVE_KEYS, (key) => key.replace(/[^a-z0-9]+/g, "")),
);

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;
const OPEN_THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*$/gi;
const OPEN_THINK_RE = /<\/?think>/gi;
const HIDDEN_REASONING_LABEL_RE =
  /\b(?:chain[_-]?of[_-]?thought|hidden[_-]?reasoning|reasoning[_-]?content|cot|thoughts)\s*[:=]\s*[^\r\n]*/gi;
const API_KEY_RE = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+={0,2}\b/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const IMAGE_DATA_URI_RE = /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
const LONG_BASE64_RE = /\b[A-Za-z0-9+/]{160,}={0,2}\b/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_KEY_COMPACTS.has(compact) ||
    normalized.endsWith("_base64") ||
    compact.endsWith("base64") ||
    normalized.startsWith("raw_") ||
    compact.startsWith("raw") ||
    normalized.startsWith("provider_") ||
    compact.startsWith("provider")
  );
}

export function sanitizeText(text: string, maxChars?: number): string {
  const cleaned = text
    .replace(THINK_BLOCK_RE, "[redacted_hidden_reasoning]")
    .replace(OPEN_THINK_BLOCK_RE, "[redacted_hidden_reasoning]")
    .replace(HIDDEN_REASONING_LABEL_RE, "[redacted_hidden_reasoning]")
    .replace(OPEN_THINK_RE, "[redacted_hidden_reasoning]")
    .replace(API_KEY_RE, "[redacted_api_key]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(JWT_RE, "[redacted_jwt]")
    .replace(IMAGE_DATA_URI_RE, "[redacted_image]")
    .replace(LONG_BASE64_RE, "[redacted_base64]")
    .trim();

  if (maxChars === undefined || cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 1))}...`;
}

export function sanitizePayload(value: unknown, maxChars = 480): unknown {
  if (typeof value === "string") return sanitizeText(value, maxChars);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item, maxChars));
  }
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    out[key] = sanitizePayload(item, maxChars);
  }
  return out;
}
