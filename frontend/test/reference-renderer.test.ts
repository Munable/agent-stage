import { describe, expect, it } from "vitest";
import { describeReferenceRenderState } from "../src/reference-renderer";
import type { RenderState } from "../src/stage-manager";
import type { StageFrame } from "../src/stage-frame";

function frame(state: string): StageFrame {
  return {
    character_state: state,
    thinking_text: null,
    fx: null,
    prop: null,
    card: null,
    asset_call: null,
  };
}

describe("describeReferenceRenderState", () => {
  it("turns seam, reflex, and loop playback into a renderer-friendly view", () => {
    const renderState: RenderState = {
      frame: {
        character_state: "working",
        thinking_text: "Checking the trails",
        fx: "sparkle",
        prop: "map",
        card: { type: "note", data: { title: "Trail picks", items: 2 } },
        asset_call: null,
      },
      turnId: "t1",
      enteredAtMs: 500,
      minDwellMs: 320,
      interruptible: true,
      seam: {
        outgoingFrame: frame("idle"),
        outgoingTurnId: "t1",
        outgoingEnteredAtMs: 0,
        startedAtMs: 500,
        durationMs: 120,
        progress: 0.25,
      },
      reflex: {
        key: "working",
        variantId: "blink",
        slotIndex: 1,
        startedAtMs: 560,
        durationMs: 80,
        progress: 0.5,
      },
      playback: {
        kind: "loop",
        assetId: "emoji.working.loop",
        startedAtMs: 300,
        durationMs: 200,
        iteration: 1,
        progress: 0.5,
      },
    };

    const view = describeReferenceRenderState(renderState);
    expect(view.actorEmoji).toBe("🔧");
    expect(view.outgoingEmoji).toBe("🙂");
    expect(view.bubbleText).toBe("Checking the trails");
    expect(view.cardText).toContain('"title":"Trail picks"');
    expect(view.badges).toContain("fx: sparkle");
    expect(view.badges).toContain("prop: map");
    expect(view.badges).toContain("reflex: blink");
    expect(view.badges).toContain("loop 2");
    expect(view.incomingOpacity).toBeCloseTo(0.25);
    expect(view.outgoingOpacity).toBeCloseTo(0.75);
  });

  it("describes a settled one-shot beat without an outgoing seam", () => {
    const renderState: RenderState = {
      frame: {
        character_state: "celebrating",
        thinking_text: null,
        fx: null,
        prop: null,
        card: null,
        voice_tag: "tada",
        asset_call: null,
      },
      turnId: "t1",
      enteredAtMs: 1000,
      minDwellMs: 320,
      interruptible: true,
      seam: null,
      reflex: null,
      playback: {
        kind: "one-shot",
        assetId: "emoji.ta-da",
        startedAtMs: 1000,
        durationMs: 220,
        progress: 1,
        settled: true,
      },
    };

    const view = describeReferenceRenderState(renderState);
    expect(view.actorEmoji).toBe("🎉");
    expect(view.outgoingEmoji).toBeNull();
    expect(view.badges).toContain("voice: tada");
    expect(view.badges).toContain("hold");
    expect(view.incomingOpacity).toBe(1);
    expect(view.outgoingOpacity).toBe(0);
  });
});
