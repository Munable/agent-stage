import { describe, expect, it } from "vitest";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  buildRendererRegistry,
  type VideoRendererAsset,
} from "../src/renderer-registry";
import { describeVideoRenderPlan } from "../src/video-renderer";
import type { RenderState } from "../src/stage-manager";

const placeholderClipPath = join(
  process.cwd(),
  "frontend/test/fixtures/placeholder-hevc-alpha.mov",
);

const videoAsset: VideoRendererAsset = {
  asset_id: "video.guide.idle",
  renderer: "video",
  anchor: null,
  min_dwell_ms: 320,
  interruptible: true,
  clip: {
    src: placeholderClipPath,
    mime_type: 'video/quicktime; codecs="hvc1"',
    codec: "hvc1",
    has_alpha: true,
    width: 64,
    height: 64,
    duration_ms: 600,
  },
};

describe("describeVideoRenderPlan", () => {
  it("seeks a looping HEVC-alpha clip from RenderState playback timing", () => {
    const registry = buildRendererRegistry([videoAsset]);
    const state: RenderState = {
      frame: {
        character_state: "idle",
        thinking_text: null,
        fx: null,
        prop: null,
        card: null,
        asset_call: {
          asset_id: "video.guide.idle",
          renderer: "video",
          anchor: null,
          min_dwell_ms: 320,
          interruptible: true,
        },
      },
      turnId: "t1",
      enteredAtMs: 1000,
      minDwellMs: 320,
      interruptible: true,
      seam: null,
      reflex: null,
      playback: {
        kind: "loop",
        assetId: "video.guide.idle",
        startedAtMs: 1600,
        durationMs: 600,
        iteration: 1,
        progress: 0.5,
      },
    };

    const plan = describeVideoRenderPlan(state, registry);
    expect(plan?.incoming?.assetId).toBe("video.guide.idle");
    expect(plan?.incoming?.currentTimeMs).toBeCloseTo(300);
    expect(plan?.incoming?.kind).toBe("loop");
    expect(plan?.outgoing).toBeNull();
  });

  it("crossfades outgoing and incoming video layers during a seam", () => {
    const registry = buildRendererRegistry([
      videoAsset,
      {
        ...videoAsset,
        asset_id: "video.guide.wave",
        clip: { ...videoAsset.clip, src: "/fixtures/wave.mov" },
      },
    ]);
    const state: RenderState = {
      frame: {
        character_state: "idle",
        thinking_text: null,
        fx: null,
        prop: null,
        card: null,
        asset_call: {
          asset_id: "video.guide.idle",
          renderer: "video",
          anchor: null,
          min_dwell_ms: 320,
          interruptible: true,
        },
      },
      turnId: "t1",
      enteredAtMs: 1000,
      minDwellMs: 320,
      interruptible: true,
      seam: {
        outgoingFrame: {
          character_state: "working",
          thinking_text: null,
          fx: null,
          prop: null,
          card: null,
          asset_call: {
            asset_id: "video.guide.wave",
            renderer: "video",
            anchor: null,
            min_dwell_ms: 320,
            interruptible: true,
          },
        },
        outgoingTurnId: "t1",
        outgoingEnteredAtMs: 700,
        startedAtMs: 1000,
        durationMs: 120,
        progress: 0.25,
      },
      reflex: null,
      playback: {
        kind: "one-shot",
        assetId: "video.guide.idle",
        startedAtMs: 1000,
        durationMs: 600,
        progress: 0.25,
        settled: false,
      },
    };

    const plan = describeVideoRenderPlan(state, registry);
    expect(plan?.incoming?.opacity).toBeCloseTo(0.25);
    expect(plan?.outgoing?.opacity).toBeCloseTo(0.75);
    expect(plan?.outgoing?.assetId).toBe("video.guide.wave");
  });

  it("uses the generated placeholder HEVC-alpha clip fixture", () => {
    expect(statSync(placeholderClipPath).size).toBeGreaterThan(0);
  });
});
