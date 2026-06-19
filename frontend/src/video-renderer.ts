import type { RenderState } from "./stage-manager.js";
import {
  getRendererAsset,
  type RendererRegistry,
  type VideoRendererAsset,
} from "./renderer-registry.js";

export type VideoRenderLayer = {
  readonly assetId: string;
  readonly src: string;
  readonly mimeType: string;
  readonly currentTimeMs: number;
  readonly opacity: number;
  readonly kind: "loop" | "one-shot";
  readonly settled: boolean;
};

export type VideoRenderPlan = {
  readonly incoming: VideoRenderLayer | null;
  readonly outgoing: VideoRenderLayer | null;
};

export type VideoRenderer = {
  readonly render: (state: RenderState | null) => void;
  readonly destroy: () => void;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const layerFromAsset = (
  asset: VideoRendererAsset,
  progress: number,
  opacity: number,
  settled: boolean,
): VideoRenderLayer => ({
  assetId: asset.asset_id,
  src: asset.clip.src,
  mimeType: asset.clip.mime_type,
  currentTimeMs: clamp(progress, 0, 1) * asset.clip.duration_ms,
  opacity,
  kind: settled ? "one-shot" : "loop",
  settled,
});

function incomingLayerOf(
  state: RenderState,
  registry: RendererRegistry,
): VideoRenderLayer | null {
  const asset = getRendererAsset(registry, state.frame.asset_call);
  if (!asset || asset.renderer !== "video") return null;
  const playback = state.playback;
  if (playback?.kind === "one-shot") {
    return {
      assetId: asset.asset_id,
      src: asset.clip.src,
      mimeType: asset.clip.mime_type,
      currentTimeMs: playback.progress * asset.clip.duration_ms,
      opacity: state.seam?.progress ?? 1,
      kind: "one-shot",
      settled: playback.settled,
    };
  }
  return {
    assetId: asset.asset_id,
    src: asset.clip.src,
    mimeType: asset.clip.mime_type,
    currentTimeMs: (playback?.progress ?? 0) * asset.clip.duration_ms,
    opacity: state.seam?.progress ?? 1,
    kind: "loop",
    settled: false,
  };
}

function outgoingLayerOf(
  state: RenderState,
  registry: RendererRegistry,
): VideoRenderLayer | null {
  const seam = state.seam;
  if (!seam) return null;
  const asset = getRendererAsset(registry, seam.outgoingFrame.asset_call);
  if (!asset || asset.renderer !== "video") return null;
  return {
    assetId: asset.asset_id,
    src: asset.clip.src,
    mimeType: asset.clip.mime_type,
    currentTimeMs: 0,
    opacity: 1 - seam.progress,
    kind: "loop",
    settled: false,
  };
}

export function describeVideoRenderPlan(
  state: RenderState | null,
  registry: RendererRegistry,
): VideoRenderPlan | null {
  if (!state) return null;
  const incoming = incomingLayerOf(state, registry);
  const outgoing = outgoingLayerOf(state, registry);
  if (!incoming && !outgoing) return null;
  return { incoming, outgoing };
}

function applyLayer(video: HTMLVideoElement, layer: VideoRenderLayer | null): void {
  if (!layer) {
    video.style.opacity = "0";
    video.removeAttribute("src");
    return;
  }
  if (video.getAttribute("src") !== layer.src) video.src = layer.src;
  video.dataset.assetId = layer.assetId;
  video.dataset.kind = layer.kind;
  video.dataset.settled = String(layer.settled);
  video.style.opacity = layer.opacity.toFixed(3);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  if (Math.abs(video.currentTime * 1000 - layer.currentTimeMs) > 34) {
    video.currentTime = layer.currentTimeMs / 1000;
  }
  video.pause();
}

export function createVideoRenderer(
  root: HTMLElement,
  registry: RendererRegistry,
): VideoRenderer {
  root.style.position = "relative";
  root.style.display = "grid";
  root.style.overflow = "hidden";
  root.innerHTML = `
    <div data-video-layer="outgoing"></div>
    <div data-video-layer="incoming"></div>
  `;
  const outgoing = document.createElement("video");
  const incoming = document.createElement("video");
  outgoing.style.position = incoming.style.position = "absolute";
  outgoing.style.inset = incoming.style.inset = "0";
  outgoing.style.width = incoming.style.width = "100%";
  outgoing.style.height = incoming.style.height = "100%";
  outgoing.style.objectFit = incoming.style.objectFit = "contain";
  const outgoingHost = root.querySelector<HTMLElement>('[data-video-layer="outgoing"]');
  const incomingHost = root.querySelector<HTMLElement>('[data-video-layer="incoming"]');
  if (!outgoingHost || !incomingHost) throw new Error("video renderer host missing");
  outgoingHost.append(outgoing);
  incomingHost.append(incoming);

  return {
    render: (state) => {
      const plan = describeVideoRenderPlan(state, registry);
      applyLayer(incoming, plan?.incoming ?? null);
      applyLayer(outgoing, plan?.outgoing ?? null);
    },
    destroy: () => {
      root.textContent = "";
    },
  };
}
