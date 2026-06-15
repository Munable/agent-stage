// Generic stage_frame decoder (shared/stage_frame_v1.json).
// Owns the slot semantics of a presentation frame; token VALUES, card payload
// contracts, and app extension fields are supplied by the embedding app through
// StageFrameRegistries.
import { sanitizePayload, sanitizeText } from "./sanitize";

export type StageFrameCard = { type: string; data: Record<string, unknown> };

export type StageFrameAssetCall = {
  asset_id: string;
  renderer: string;
  anchor: string | null;
  min_dwell_ms: number;
  interruptible: boolean;
};

export type StageFrame = {
  character_state: string;
  thinking_text: string | null;
  fx: string | null;
  prop: string | null;
  card: StageFrameCard | null;
  voice_tag?: string | null;
  asset_call?: StageFrameAssetCall | null;
};

export type StageFrameRegistries = {
  states: ReadonlySet<string>;
  fx: ReadonlySet<string>;
  props: ReadonlySet<string>;
  voiceTags: ReadonlySet<string>;
  assetCatalog: Readonly<Record<string, Omit<StageFrameAssetCall, "asset_id">>>;
  validateCard: (type: string, data: Record<string, unknown>) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function decodeCardEnvelope(
  value: unknown,
  registries: StageFrameRegistries,
): StageFrameCard | null | undefined {
  if (value === null || value === undefined) return value;
  if (!isRecord(value)) return undefined;
  const type = value.type;
  const data = value.data;
  if (typeof type !== "string") return undefined;
  if (!isRecord(data)) return undefined;
  if (!registries.validateCard(type, data)) return undefined;
  const publicData = sanitizePayload(data);
  if (!isRecord(publicData)) return undefined;
  return { type, data: publicData };
}

function decodeAssetCallShape(
  value: unknown,
  catalog: StageFrameRegistries["assetCatalog"],
): StageFrameAssetCall | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const assetId = value.asset_id;
  if (typeof assetId !== "string") return undefined;
  const entry = catalog[assetId];
  if (!entry) return undefined;
  if (value.renderer !== entry.renderer) return undefined;
  if (value.anchor !== entry.anchor) return undefined;
  if (value.min_dwell_ms !== entry.min_dwell_ms) return undefined;
  if (value.interruptible !== entry.interruptible) return undefined;
  return {
    asset_id: assetId,
    renderer: entry.renderer,
    anchor: entry.anchor,
    min_dwell_ms: entry.min_dwell_ms,
    interruptible: entry.interruptible,
  };
}

export function decodeStageFrame(
  value: unknown,
  registries: StageFrameRegistries,
): StageFrame | null {
  if (!isRecord(value)) return null;
  const characterState = value.character_state;
  const fx = value.fx;
  const prop = value.prop;
  const card = decodeCardEnvelope(value.card, registries);
  const assetCall = decodeAssetCallShape(value.asset_call, registries.assetCatalog);
  if (typeof characterState !== "string" || !registries.states.has(characterState)) {
    return null;
  }
  if (!isStringOrNull(value.thinking_text)) return null;
  if (!(fx === null || (typeof fx === "string" && registries.fx.has(fx)))) return null;
  if (!(prop === null || (typeof prop === "string" && registries.props.has(prop)))) {
    return null;
  }
  if (card === undefined) return null;
  if (assetCall === undefined) return null;
  if (!isStringOrNull(value.voice_tag) && value.voice_tag !== undefined) return null;
  if (typeof value.voice_tag === "string" && !registries.voiceTags.has(value.voice_tag)) {
    return null;
  }
  return {
    character_state: characterState,
    thinking_text:
      typeof value.thinking_text === "string"
        ? sanitizeText(value.thinking_text, 480)
        : value.thinking_text,
    fx: fx as string | null,
    prop: prop as string | null,
    card: card ?? null,
    voice_tag: value.voice_tag as string | null | undefined,
    asset_call: assetCall ?? null,
  };
}
