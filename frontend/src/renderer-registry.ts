import type { StageFrameAssetCall } from "./stage-frame.js";

export type BaseRendererAsset = StageFrameAssetCall;

export type ImageSequenceRendererAsset = BaseRendererAsset & {
  readonly renderer: "image_sequence";
  readonly frames: readonly string[];
  readonly frame_duration_ms: number;
};

export type VideoClip = {
  readonly src: string;
  readonly mime_type: string;
  readonly codec: "hvc1";
  readonly has_alpha: true;
  readonly width: number;
  readonly height: number;
  readonly duration_ms: number;
};

export type VideoRendererAsset = BaseRendererAsset & {
  readonly renderer: "video";
  readonly clip: VideoClip;
};

export type RendererAsset = ImageSequenceRendererAsset | VideoRendererAsset;

export type RendererRegistry = Readonly<Record<string, RendererAsset>>;

export function buildRendererRegistry(
  assets: readonly RendererAsset[],
): RendererRegistry {
  const registry: Record<string, RendererAsset> = {};
  for (const asset of assets) registry[asset.asset_id] = asset;
  return registry;
}

export function getRendererAsset(
  registry: RendererRegistry,
  assetCall: StageFrameAssetCall | null | undefined,
): RendererAsset | null {
  if (!assetCall) return null;
  const asset = registry[assetCall.asset_id];
  if (!asset) return null;
  if (asset.renderer !== assetCall.renderer) return null;
  if (asset.anchor !== assetCall.anchor) return null;
  if (asset.min_dwell_ms !== assetCall.min_dwell_ms) return null;
  if (asset.interruptible !== assetCall.interruptible) return null;
  return asset;
}
