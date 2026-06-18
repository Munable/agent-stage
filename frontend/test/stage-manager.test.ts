import { describe, expect, it } from "vitest";
import {
  parseStageAssetDirectory,
  StageManager,
  type TurnFrame,
} from "../src/stage-manager";
import type { StageFrame } from "../src/stage-frame";

function frame(
  state: string,
  opts: { minDwellMs?: number; interruptible?: boolean; assetId?: string } = {},
): StageFrame {
  const hasAsset =
    opts.minDwellMs !== undefined || opts.interruptible !== undefined || opts.assetId !== undefined;
  return {
    character_state: state,
    thinking_text: null,
    fx: null,
    prop: null,
    card: null,
    asset_call: hasAsset
      ? {
          asset_id: opts.assetId ?? state,
          renderer: "test",
          anchor: null,
          min_dwell_ms: opts.minDwellMs ?? 320,
          interruptible: opts.interruptible ?? true,
        }
      : null,
  };
}

const tf = (turnId: string, f: StageFrame): TurnFrame => ({ turnId, frame: f });

describe("parseStageAssetDirectory", () => {
  it("splits a shared asset directory into frame and playback catalogs", () => {
    const parsed = parseStageAssetDirectory([
      {
        asset_id: "emoji.idle.loop",
        renderer: "emoji",
        anchor: null,
        min_dwell_ms: 400,
        interruptible: true,
        playback: { kind: "loop", durationMs: 600 },
      },
      {
        asset_id: "emoji.ta-da",
        renderer: "emoji",
        anchor: "body",
        min_dwell_ms: 180,
        interruptible: true,
        playback: { kind: "one-shot", durationMs: 220 },
      },
    ]);

    expect(parsed.assetCatalog["emoji.idle.loop"]).toEqual({
      renderer: "emoji",
      anchor: null,
      min_dwell_ms: 400,
      interruptible: true,
    });
    expect(parsed.playbackCatalog["emoji.idle.loop"]).toEqual({
      kind: "loop",
      durationMs: 600,
    });
    expect(parsed.playbackCatalog["emoji.ta-da"]).toEqual({
      kind: "one-shot",
      durationMs: 220,
    });
  });
});

describe("StageManager", () => {
  it("returns null before anything is activated", () => {
    expect(new StageManager().tick(0)).toBeNull();
  });

  it("starts cold, then exposes a seam while one frame flows into the next", () => {
    const sm = new StageManager({ seamMs: 120 });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("idle", { minDwellMs: 400, interruptible: true })));

    expect(sm.tick(0)?.seam).toBeNull();
    expect(sm.tick(0)?.reflex).toBeNull();

    sm.ingest(tf("t1", frame("answer", { minDwellMs: 400, interruptible: false })));

    const entering = sm.tick(50);
    expect(entering?.frame.character_state).toBe("answer");
    expect(entering?.seam?.outgoingFrame.character_state).toBe("idle");
    expect(entering?.seam?.outgoingTurnId).toBe("t1");
    expect(entering?.seam?.outgoingEnteredAtMs).toBe(0);
    expect(entering?.seam?.startedAtMs).toBe(50);
    expect(entering?.seam?.durationMs).toBe(120);
    expect(entering?.seam?.progress).toBe(0);

    expect(sm.tick(110)?.seam?.progress).toBeCloseTo(0.5);
    expect(sm.tick(170)?.seam).toBeNull();
  });

  it("emits deterministic reflex variants while waiting between Director frames", () => {
    const sm = new StageManager({
      reflexTable: {
        think: {
          afterMs: 80,
          intervalMs: 200,
          variants: [
            { id: "blink", durationMs: 40 },
            { id: "tilt", durationMs: 60 },
          ],
        },
      },
    });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("think", { minDwellMs: 999, interruptible: false })));

    expect(sm.tick(0)?.reflex).toBeNull();
    expect(sm.tick(79)?.reflex).toBeNull();

    const first = sm.tick(80)?.reflex;
    expect(first?.key).toBe("think");
    expect(first?.variantId).toBe("blink");
    expect(first?.slotIndex).toBe(0);
    expect(first?.startedAtMs).toBe(80);
    expect(first?.durationMs).toBe(40);
    expect(first?.progress).toBe(0);

    expect(sm.tick(100)?.reflex?.progress).toBeCloseTo(0.5);
    expect(sm.tick(121)?.reflex).toBeNull();

    const second = sm.tick(280)?.reflex;
    expect(second?.variantId).toBe("tilt");
    expect(second?.slotIndex).toBe(1);
    expect(second?.startedAtMs).toBe(280);
    expect(second?.durationMs).toBe(60);
  });

  it("prefers asset-specific reflex entries over the generic character state", () => {
    const sm = new StageManager({
      reflexTable: {
        think: {
          afterMs: 0,
          intervalMs: 200,
          variants: [{ id: "state-blink", durationMs: 80 }],
        },
        "seq.think": {
          afterMs: 0,
          intervalMs: 200,
          variants: [{ id: "asset-bob", durationMs: 80 }],
        },
      },
    });
    sm.startTurn("t1");
    sm.ingest(
      tf("t1", frame("think", { minDwellMs: 999, interruptible: false, assetId: "seq.think" })),
    );

    const reflex = sm.tick(0)?.reflex;
    expect(reflex?.key).toBe("seq.think");
    expect(reflex?.variantId).toBe("asset-bob");
  });

  it("loops asset playback while a looping frame stays active", () => {
    const parsed = parseStageAssetDirectory([
      {
        asset_id: "emoji.idle.loop",
        renderer: "emoji",
        anchor: null,
        min_dwell_ms: 400,
        interruptible: true,
        playback: { kind: "loop", durationMs: 300 },
      },
    ]);
    const sm = new StageManager({ playbackCatalog: parsed.playbackCatalog });
    sm.startTurn("t1");
    sm.ingest(
      tf("t1", frame("idle", { minDwellMs: 400, interruptible: true, assetId: "emoji.idle.loop" })),
    );

    const first = sm.tick(0)?.playback;
    expect(first?.kind).toBe("loop");
    expect(first?.startedAtMs).toBe(0);
    expect(first?.durationMs).toBe(300);
    expect(first?.iteration).toBe(0);
    expect(first?.progress).toBe(0);

    expect(sm.tick(150)?.playback?.progress).toBeCloseTo(0.5);

    const secondLoop = sm.tick(350)?.playback;
    expect(secondLoop?.kind).toBe("loop");
    expect(secondLoop?.startedAtMs).toBe(300);
    expect(secondLoop?.iteration).toBe(1);
    expect(secondLoop?.progress).toBeCloseTo(50 / 300);
  });

  it("plays a one-shot beat once, then holds its final pose", () => {
    const parsed = parseStageAssetDirectory([
      {
        asset_id: "emoji.ta-da",
        renderer: "emoji",
        anchor: null,
        min_dwell_ms: 180,
        interruptible: true,
        playback: { kind: "one-shot", durationMs: 220 },
      },
    ]);
    const sm = new StageManager({ playbackCatalog: parsed.playbackCatalog });
    sm.startTurn("t1");
    sm.ingest(
      tf("t1", frame("celebrating", { minDwellMs: 180, interruptible: true, assetId: "emoji.ta-da" })),
    );

    const opening = sm.tick(0)?.playback;
    expect(opening?.kind).toBe("one-shot");
    expect(opening?.startedAtMs).toBe(0);
    expect(opening?.durationMs).toBe(220);
    expect(opening?.progress).toBe(0);
    expect(opening?.settled).toBe(false);

    expect(sm.tick(110)?.playback?.progress).toBeCloseTo(0.5);

    const settled = sm.tick(300)?.playback;
    expect(settled?.kind).toBe("one-shot");
    expect(settled?.progress).toBe(1);
    expect(settled?.settled).toBe(true);
  });

  it("holds a non-interruptible frame for its min-dwell, then advances", () => {
    const sm = new StageManager();
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("result", { minDwellMs: 400, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("result");
    sm.ingest(tf("t1", frame("idle")));
    expect(sm.tick(100)?.frame.character_state).toBe("result"); // 100ms < 400ms dwell
    expect(sm.tick(400)?.frame.character_state).toBe("idle"); // dwell satisfied
  });

  it("cuts an interruptible frame as soon as a newer frame is ready", () => {
    const sm = new StageManager();
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("analyze", { minDwellMs: 400, interruptible: true })));
    expect(sm.tick(0)?.frame.character_state).toBe("analyze");
    sm.ingest(tf("t1", frame("result", { minDwellMs: 400, interruptible: false })));
    expect(sm.tick(50)?.frame.character_state).toBe("result"); // cut early
  });

  it("does not cut a one-shot beat before it has played through once", () => {
    const parsed = parseStageAssetDirectory([
      {
        asset_id: "emoji.ta-da",
        renderer: "emoji",
        anchor: null,
        min_dwell_ms: 80,
        interruptible: true,
        playback: { kind: "one-shot", durationMs: 220 },
      },
    ]);
    const sm = new StageManager({ playbackCatalog: parsed.playbackCatalog });
    sm.startTurn("t1");
    sm.ingest(
      tf("t1", frame("celebrating", { minDwellMs: 80, interruptible: true, assetId: "emoji.ta-da" })),
    );
    expect(sm.tick(0)?.frame.character_state).toBe("celebrating");

    sm.ingest(tf("t1", frame("idle")));
    expect(sm.tick(100)?.frame.character_state).toBe("celebrating");
    expect(sm.tick(219)?.frame.character_state).toBe("celebrating");
    expect(sm.tick(220)?.frame.character_state).toBe("idle");
  });

  it("catches up by dropping older interruptible backlog frames", () => {
    const sm = new StageManager({
      pacing: { kind: "drop-intermediate", maxPendingFrames: 1 },
    });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("thinking", { minDwellMs: 300, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("thinking");

    sm.ingest(tf("t1", frame("working-1")));
    sm.ingest(tf("t1", frame("working-2")));
    sm.ingest(tf("t1", frame("presenting")));

    expect(sm.tick(299)?.frame.character_state).toBe("thinking");
    expect(sm.tick(300)?.frame.character_state).toBe("presenting");
  });

  it("keeps a pending one-shot beat even when backlog pressure drops other frames", () => {
    const parsed = parseStageAssetDirectory([
      {
        asset_id: "emoji.ta-da",
        renderer: "emoji",
        anchor: null,
        min_dwell_ms: 80,
        interruptible: true,
        playback: { kind: "one-shot", durationMs: 220 },
      },
    ]);
    const sm = new StageManager({
      pacing: { kind: "drop-intermediate", maxPendingFrames: 1 },
      playbackCatalog: parsed.playbackCatalog,
    });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("thinking", { minDwellMs: 100, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("thinking");

    sm.ingest(tf("t1", frame("working-1")));
    sm.ingest(
      tf("t1", frame("celebrating", { minDwellMs: 80, interruptible: true, assetId: "emoji.ta-da" })),
    );
    sm.ingest(tf("t1", frame("idle")));

    expect(sm.tick(100)?.frame.character_state).toBe("celebrating");
    expect(sm.tick(320)?.frame.character_state).toBe("idle");
  });

  it("uses catch-up pacing by default when the queue runs ahead", () => {
    const sm = new StageManager();
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("thinking", { minDwellMs: 200, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("thinking");

    sm.ingest(tf("t1", frame("working-1")));
    sm.ingest(tf("t1", frame("working-2")));
    sm.ingest(tf("t1", frame("presenting")));

    expect(sm.tick(200)?.frame.character_state).toBe("presenting");
  });

  it("holds the active frame when the queue is empty", () => {
    const sm = new StageManager();
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("idle")));
    expect(sm.tick(0)?.frame.character_state).toBe("idle");
    expect(sm.tick(5000)?.frame.character_state).toBe("idle"); // still idle, no flicker
  });

  it("drops a stale-turn active frame and ignores stale-turn ingests", () => {
    const sm = new StageManager();
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("result", { minDwellMs: 999, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("result");

    sm.startTurn("t2"); // t1's active is now stale
    sm.ingest(tf("t1", frame("idle"))); // stale-turn ingest is dropped
    sm.ingest(tf("t2", frame("observe")));

    const rs = sm.tick(10); // stale active dropped even though 999ms dwell is unmet
    expect(rs?.frame.character_state).toBe("observe");
    expect(rs?.turnId).toBe("t2");
  });

  it("settles the last frame after its turn ends and ignores later frames", () => {
    const sm = new StageManager();
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("result", { minDwellMs: 200, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("result");
    sm.endTurn("t1");
    sm.ingest(tf("t1", frame("idle"))); // turn is closed: dropped
    expect(sm.tick(5000)?.frame.character_state).toBe("result"); // holds its final pose
  });

  it("suppresses reflex while a seam is still in flight", () => {
    const sm = new StageManager({
      seamMs: 120,
      reflexTable: {
        answer: {
          afterMs: 0,
          intervalMs: 200,
          variants: [{ id: "settle", durationMs: 80 }],
        },
      },
    });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("idle", { minDwellMs: 400, interruptible: true })));
    expect(sm.tick(0)?.frame.character_state).toBe("idle");

    sm.ingest(tf("t1", frame("answer", { minDwellMs: 999, interruptible: false })));

    const handoff = sm.tick(50);
    expect(handoff?.seam).not.toBeNull();
    expect(handoff?.reflex).toBeNull();

    const settled = sm.tick(170)?.reflex;
    expect(settled?.variantId).toBe("settle");
    expect(settled?.startedAtMs).toBe(170);
    expect(settled?.progress).toBe(0);
  });

  it("does not carry a seam across turns that were left behind", () => {
    const sm = new StageManager({ seamMs: 120 });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("result", { minDwellMs: 999, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("result");

    sm.startTurn("t2");
    sm.ingest(tf("t2", frame("observe")));

    const rs = sm.tick(10);
    expect(rs?.frame.character_state).toBe("observe");
    expect(rs?.turnId).toBe("t2");
    expect(rs?.seam).toBeNull();
  });

  it("drops an in-flight reflex when a newer turn takes over", () => {
    const sm = new StageManager({
      reflexTable: {
        think: {
          afterMs: 20,
          intervalMs: 200,
          variants: [{ id: "blink", durationMs: 80 }],
        },
      },
    });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("think", { minDwellMs: 999, interruptible: false })));
    expect(sm.tick(0)?.frame.character_state).toBe("think");
    expect(sm.tick(25)?.reflex?.variantId).toBe("blink");

    sm.startTurn("t2");
    sm.ingest(tf("t2", frame("observe")));

    const rs = sm.tick(30);
    expect(rs?.frame.character_state).toBe("observe");
    expect(rs?.reflex).toBeNull();
  });

  it("returns null playback when an asset has no parsed playback entry", () => {
    const sm = new StageManager({
      playbackCatalog: parseStageAssetDirectory([]).playbackCatalog,
    });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("idle", { assetId: "emoji.idle.loop" })));

    expect(sm.tick(0)?.playback).toBeNull();
  });
});
