import { describe, expect, it } from "vitest";
import { StageManager, type TurnFrame } from "../src/stage-manager";
import type { StageFrame } from "../src/stage-frame";

function frame(
  state: string,
  opts: { minDwellMs?: number; interruptible?: boolean } = {},
): StageFrame {
  const hasAsset = opts.minDwellMs !== undefined || opts.interruptible !== undefined;
  return {
    character_state: state,
    thinking_text: null,
    fx: null,
    prop: null,
    card: null,
    asset_call: hasAsset
      ? {
          asset_id: state,
          renderer: "test",
          anchor: null,
          min_dwell_ms: opts.minDwellMs ?? 320,
          interruptible: opts.interruptible ?? true,
        }
      : null,
  };
}

const tf = (turnId: string, f: StageFrame): TurnFrame => ({ turnId, frame: f });

describe("StageManager", () => {
  it("returns null before anything is activated", () => {
    expect(new StageManager().tick(0)).toBeNull();
  });

  it("starts cold, then exposes a seam while one frame flows into the next", () => {
    const sm = new StageManager({ seamMs: 120 });
    sm.startTurn("t1");
    sm.ingest(tf("t1", frame("idle", { minDwellMs: 400, interruptible: true })));

    expect(sm.tick(0)?.seam).toBeNull();

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
});
