// Deterministic playback scheduler for a Stage Director frame stream.
//
// The Director decides what to perform; this decides when. Frames are queued and
// each one is held on screen long enough to read before the next takes over;
// `tick(nowMs)` returns the single frame to draw right now. The scheduler owns no
// clock and no hidden state, so its output is fully determined by what was
// ingested — which is what lets it be tested without a model or real timers.
// Seam, reflex, and loop handling build on this spine; see docs/stage_manager.md.
import type { StageFrame } from "./stage-frame.js";

/** A Director frame tagged with the turn that produced it. */
export type TurnFrame = { readonly turnId: string; readonly frame: StageFrame };

/** The frame to draw now, carrying the timing the renderer needs to honour it. */
export type RenderState = {
  readonly frame: StageFrame;
  readonly turnId: string;
  readonly enteredAtMs: number;
  readonly minDwellMs: number;
  readonly interruptible: boolean;
};

export type StageManagerOptions = {
  /** Dwell for frames that carry no asset_call timing of their own. */
  readonly defaultMinDwellMs?: number;
};

const minDwellOf = (frame: StageFrame, fallbackMs: number): number =>
  frame.asset_call?.min_dwell_ms ?? fallbackMs;

const interruptibleOf = (frame: StageFrame): boolean =>
  frame.asset_call?.interruptible ?? true;

export class StageManager {
  private readonly defaultMinDwellMs: number;
  private pending: TurnFrame[] = [];
  private active: { readonly turn: TurnFrame; readonly enteredAtMs: number } | null = null;
  private currentTurnId: string | null = null;

  constructor({ defaultMinDwellMs = 320 }: StageManagerOptions = {}) {
    this.defaultMinDwellMs = defaultMinDwellMs;
  }

  /** Make `turnId` the live turn and abandon frames still queued from older ones. */
  startTurn(turnId: string): void {
    this.currentTurnId = turnId;
    this.pending = this.pending.filter((tf) => tf.turnId === turnId);
  }

  /** Queue a frame for playback; frames from a turn that is not live are dropped. */
  ingest(turnFrame: TurnFrame): void {
    if (turnFrame.turnId === this.currentTurnId) this.pending.push(turnFrame);
  }

  /** Close `turnId`: stop accepting frames for it and let the last one settle. */
  endTurn(turnId: string): void {
    if (turnId !== this.currentTurnId) return;
    this.pending = [];
    this.currentTurnId = null;
  }

  /** Resolve the frame to draw at `nowMs`; null only before the first frame plays. */
  tick(nowMs: number): RenderState | null {
    const next = this.pending[0];
    if (next && this.canAdvance(nowMs)) {
      this.pending.shift();
      this.active = { turn: next, enteredAtMs: nowMs };
    }

    const active = this.active;
    if (!active) return null;
    const { frame } = active.turn;
    return {
      frame,
      turnId: active.turn.turnId,
      enteredAtMs: active.enteredAtMs,
      minDwellMs: minDwellOf(frame, this.defaultMinDwellMs),
      interruptible: interruptibleOf(frame),
    };
  }

  // Whether the active frame will yield to the one waiting behind it.
  private canAdvance(nowMs: number): boolean {
    const active = this.active;
    if (!active) return true; // nothing is playing yet
    if (active.turn.turnId !== this.currentTurnId) return true; // its turn was left behind
    if (interruptibleOf(active.turn.frame)) return true; // this beat may be cut short
    return nowMs - active.enteredAtMs >= minDwellOf(active.turn.frame, this.defaultMinDwellMs);
  }
}
