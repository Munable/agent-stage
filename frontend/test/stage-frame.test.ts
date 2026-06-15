import { describe, expect, it } from "vitest";
import {
  decodeStageFrame,
  type StageFrameRegistries,
} from "../src/stage-frame";

const registries: StageFrameRegistries = {
  states: new Set(["idle", "think"]),
  fx: new Set(["sparkle"]),
  props: new Set(["pan"]),
  voiceTags: new Set(["hello"]),
  assetCatalog: {
    "seq.idle": {
      renderer: "image_sequence",
      anchor: null,
      min_dwell_ms: 400,
      interruptible: true,
    },
  },
  validateCard: (type, data) => type === "note" && typeof data.text === "string",
};

const baseFrame = {
  character_state: "idle",
  thinking_text: null,
  fx: null,
  prop: null,
  card: null,
};

describe("decodeStageFrame", () => {
  it("decodes a minimal valid frame and ignores app extension fields", () => {
    const frame = decodeStageFrame({ ...baseFrame, motion_id: "whatever" }, registries);
    expect(frame).not.toBeNull();
    expect(frame?.character_state).toBe("idle");
    expect(frame?.card).toBeNull();
    expect(frame?.asset_call).toBeNull();
  });

  it("rejects unregistered character states, fx, props, and voice tags", () => {
    expect(decodeStageFrame({ ...baseFrame, character_state: "dance" }, registries)).toBeNull();
    expect(decodeStageFrame({ ...baseFrame, fx: "explode" }, registries)).toBeNull();
    expect(decodeStageFrame({ ...baseFrame, prop: "sword" }, registries)).toBeNull();
    expect(decodeStageFrame({ ...baseFrame, voice_tag: "scream" }, registries)).toBeNull();
  });

  it("requires asset_call to match the registered catalog entry verbatim", () => {
    const valid = decodeStageFrame(
      {
        ...baseFrame,
        asset_call: {
          asset_id: "seq.idle",
          renderer: "image_sequence",
          anchor: null,
          min_dwell_ms: 400,
          interruptible: true,
        },
      },
      registries,
    );
    expect(valid?.asset_call?.asset_id).toBe("seq.idle");
    const tampered = decodeStageFrame(
      {
        ...baseFrame,
        asset_call: {
          asset_id: "seq.idle",
          renderer: "image_sequence",
          anchor: null,
          min_dwell_ms: 9999,
          interruptible: true,
        },
      },
      registries,
    );
    expect(tampered).toBeNull();
  });

  it("validates card envelopes through the app callback and sanitizes payloads", () => {
    const ok = decodeStageFrame(
      { ...baseFrame, card: { type: "note", data: { text: "hi", api_key: "sk-aaaaaaaaaaaaaaaa" } } },
      registries,
    );
    expect(ok?.card?.type).toBe("note");
    expect(ok?.card?.data).not.toHaveProperty("api_key");
    const bad = decodeStageFrame(
      { ...baseFrame, card: { type: "unknown", data: {} } },
      registries,
    );
    expect(bad).toBeNull();
  });

  it("sanitizes thinking_text before it reaches the stage", () => {
    const frame = decodeStageFrame(
      { ...baseFrame, thinking_text: "working sk-abcdefghijklmnop1234" },
      registries,
    );
    expect(frame?.thinking_text).toContain("[redacted_api_key]");
  });

  it("rejects frames missing required generic fields", () => {
    expect(decodeStageFrame({ character_state: "idle" }, registries)).toBeNull();
  });
});
