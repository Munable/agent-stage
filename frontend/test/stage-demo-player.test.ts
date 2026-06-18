import { describe, expect, it } from "vitest";
import {
  buildStageDemoManager,
  parseStageDemoLine,
  type StageDemoConfig,
} from "../src/stage-demo-player";

describe("parseStageDemoLine", () => {
  it("decodes stage frames and turn summaries from the demo stream", () => {
    const frame = parseStageDemoLine(
      JSON.stringify({
        character_state: "thinking",
        thinking_text: "Reading",
        fx: null,
        prop: null,
        card: null,
      }),
    );
    const summary = parseStageDemoLine(
      JSON.stringify({ type: "turn_summary", frames: 4, dropped_events: 0 }),
    );

    expect(frame?.type).toBe("stage_frame");
    if (frame?.type === "stage_frame") {
      expect(frame.frame.character_state).toBe("thinking");
    }
    expect(summary).toEqual({ type: "turn_summary", frames: 4, droppedEvents: 0 });
  });
});

describe("buildStageDemoManager", () => {
  it("wires asset playback and reflex tables into the browser runtime", () => {
    const config: StageDemoConfig = {
      assetDirectory: [
        {
          asset_id: "emoji.thinking.loop",
          renderer: "emoji",
          anchor: null,
          min_dwell_ms: 320,
          interruptible: true,
          playback: { kind: "loop", durationMs: 300 },
        },
      ],
      reflexTable: {
        "emoji.thinking.loop": {
          afterMs: 0,
          intervalMs: 200,
          variants: [{ id: "blink", durationMs: 80 }],
        },
      },
    };
    const sm = buildStageDemoManager(config);
    sm.startTurn("t1");
    sm.ingest({
      turnId: "t1",
      frame: {
        character_state: "thinking",
        thinking_text: "Reading",
        fx: null,
        prop: null,
        card: null,
        asset_call: {
          asset_id: "emoji.thinking.loop",
          renderer: "emoji",
          anchor: null,
          min_dwell_ms: 320,
          interruptible: true,
        },
      },
    });

    const rs = sm.tick(0);
    expect(rs?.playback?.kind).toBe("loop");
    expect(rs?.reflex?.variantId).toBe("blink");
  });
});
