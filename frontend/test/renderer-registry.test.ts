import { describe, expect, it } from "vitest";
import {
  buildRendererRegistry,
  getRendererAsset,
  type ImageSequenceRendererAsset,
  type VideoRendererAsset,
} from "../src/renderer-registry";

const imageAsset: ImageSequenceRendererAsset = {
  asset_id: "seq.guide.wave",
  renderer: "image_sequence",
  anchor: null,
  min_dwell_ms: 320,
  interruptible: true,
  frames: ["wave-0001.png", "wave-0002.png"],
  frame_duration_ms: 80,
};

const videoAsset: VideoRendererAsset = {
  asset_id: "video.guide.idle",
  renderer: "video",
  anchor: "body",
  min_dwell_ms: 400,
  interruptible: false,
  clip: {
    src: "/fixtures/placeholder-hevc-alpha.mov",
    mime_type: 'video/quicktime; codecs="hvc1"',
    codec: "hvc1",
    has_alpha: true,
    width: 64,
    height: 64,
    duration_ms: 600,
  },
};

describe("buildRendererRegistry", () => {
  it("supports both image_sequence and video assets without changing asset_call semantics", () => {
    const registry = buildRendererRegistry([imageAsset, videoAsset]);
    expect(registry["seq.guide.wave"]?.renderer).toBe("image_sequence");
    expect(registry["video.guide.idle"]?.renderer).toBe("video");

    const resolved = getRendererAsset(registry, {
      asset_id: "video.guide.idle",
      renderer: "video",
      anchor: "body",
      min_dwell_ms: 400,
      interruptible: false,
    });
    expect(resolved?.renderer).toBe("video");
    expect(resolved?.asset_id).toBe("video.guide.idle");
  });

  it("rejects asset_call metadata that does not match the registered entry", () => {
    const registry = buildRendererRegistry([videoAsset]);
    const resolved = getRendererAsset(registry, {
      asset_id: "video.guide.idle",
      renderer: "image_sequence",
      anchor: "body",
      min_dwell_ms: 400,
      interruptible: false,
    });
    expect(resolved).toBeNull();
  });
});
