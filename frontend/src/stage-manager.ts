// Deterministic playback scheduler for a Stage Director frame stream.
//
// The Director decides what to perform; this decides when. Frames are queued and
// each one is held on screen long enough to read before the next takes over;
// `tick(nowMs)` returns the single frame to draw right now. The scheduler owns no
// clock and no hidden state, so its output is fully determined by what was
// ingested — which is what lets it be tested without a model or real timers.
// Seam, reflex, and loop handling build on this spine; see docs/stage_manager.md.
import type { StageFrame, StageFrameAssetCall } from "./stage-frame.js";

/** A Director frame tagged with the turn that produced it. */
export type TurnFrame = { readonly turnId: string; readonly frame: StageFrame };

/** The frame to draw now, carrying the timing the renderer needs to honour it. */
export type RenderSeam = {
  readonly outgoingFrame: StageFrame;
  readonly outgoingTurnId: string;
  readonly outgoingEnteredAtMs: number;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly progress: number;
};

export type StageAssetPlayback =
  | { readonly kind: "loop"; readonly durationMs: number }
  | { readonly kind: "one-shot"; readonly durationMs: number };

export type StageAssetPlaybackCatalog = Readonly<Record<string, StageAssetPlayback>>;

export type StageAssetDirectoryEntry = StageFrameAssetCall & {
  readonly playback: StageAssetPlayback | null;
};

export type ParsedStageAssetDirectory = {
  readonly assetCatalog: Readonly<Record<string, Omit<StageFrameAssetCall, "asset_id">>>;
  readonly playbackCatalog: StageAssetPlaybackCatalog;
};

export type ReflexVariant = {
  readonly id: string;
  readonly durationMs: number;
};

export type ReflexEntry = {
  readonly afterMs: number;
  readonly intervalMs: number;
  readonly variants: readonly ReflexVariant[];
};

export type ReflexTable = Readonly<Record<string, ReflexEntry>>;

export type RenderReflex = {
  readonly key: string;
  readonly variantId: string;
  readonly slotIndex: number;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly progress: number;
};

export type RenderPlayback =
  | {
      readonly kind: "loop";
      readonly assetId: string;
      readonly startedAtMs: number;
      readonly durationMs: number;
      readonly iteration: number;
      readonly progress: number;
    }
  | {
      readonly kind: "one-shot";
      readonly assetId: string;
      readonly startedAtMs: number;
      readonly durationMs: number;
      readonly progress: number;
      readonly settled: boolean;
    };

export type StagePacingPolicy =
  | { readonly kind: "preserve" }
  | { readonly kind: "drop-intermediate"; readonly maxPendingFrames: number };

/** The frame to draw now, plus the local motion metadata that keeps it alive. */
export type RenderState = {
  readonly frame: StageFrame;
  readonly turnId: string;
  readonly enteredAtMs: number;
  readonly minDwellMs: number;
  readonly interruptible: boolean;
  readonly seam: RenderSeam | null;
  readonly reflex: RenderReflex | null;
  readonly playback: RenderPlayback | null;
};

export type StageManagerOptions = {
  /** Dwell for frames that carry no asset_call timing of their own. */
  readonly defaultMinDwellMs?: number;
  /** Shared window for blending the outgoing pose into the incoming one. */
  readonly seamMs?: number;
  /** App-owned micro-motions keyed by asset id first, then by character state. */
  readonly reflexTable?: ReflexTable;
  /** Override how a frame resolves the reflex entries that may match it. */
  readonly getReflexKeys?: (frame: StageFrame) => readonly string[];
  /** Parsed asset playback semantics keyed by asset id. */
  readonly playbackCatalog?: StageAssetPlaybackCatalog;
  /** How aggressively the scheduler should shed backlog when the server runs ahead. */
  readonly pacing?: StagePacingPolicy;
};

const minDwellOf = (frame: StageFrame, fallbackMs: number): number =>
  frame.asset_call?.min_dwell_ms ?? fallbackMs;

const interruptibleOf = (frame: StageFrame): boolean =>
  frame.asset_call?.interruptible ?? true;

const reflexKeysOf = (frame: StageFrame): readonly string[] =>
  frame.asset_call?.asset_id
    ? [frame.asset_call.asset_id, frame.character_state]
    : [frame.character_state];

const progressOf = (elapsedMs: number, durationMs: number): number => {
  if (durationMs <= 0) return 1;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= durationMs) return 1;
  return elapsedMs / durationMs;
};

export function parseStageAssetDirectory(
  entries: readonly StageAssetDirectoryEntry[],
): ParsedStageAssetDirectory {
  const assetCatalog: Record<string, Omit<StageFrameAssetCall, "asset_id">> = {};
  const playbackCatalog: Record<string, StageAssetPlayback> = {};

  for (const entry of entries) {
    assetCatalog[entry.asset_id] = {
      renderer: entry.renderer,
      anchor: entry.anchor,
      min_dwell_ms: entry.min_dwell_ms,
      interruptible: entry.interruptible,
    };
    if (entry.playback) playbackCatalog[entry.asset_id] = entry.playback;
  }

  return { assetCatalog, playbackCatalog };
}

type ActiveRender = {
  readonly turn: TurnFrame;
  readonly enteredAtMs: number;
  readonly seam:
    | {
        readonly outgoing: { readonly turn: TurnFrame; readonly enteredAtMs: number };
        readonly startedAtMs: number;
      }
    | null;
};

export class StageManager {
  private readonly pacing: StagePacingPolicy;
  private readonly defaultMinDwellMs: number;
  private readonly seamMs: number;
  private readonly reflexTable: ReflexTable;
  private readonly getReflexKeys: (frame: StageFrame) => readonly string[];
  private readonly playbackCatalog: StageAssetPlaybackCatalog;
  private pending: TurnFrame[] = [];
  private active: ActiveRender | null = null;
  private currentTurnId: string | null = null;

  constructor({
    pacing = { kind: "drop-intermediate", maxPendingFrames: 1 },
    defaultMinDwellMs = 320,
    seamMs = 120,
    reflexTable = {},
    getReflexKeys = reflexKeysOf,
    playbackCatalog = {},
  }: StageManagerOptions = {}) {
    this.pacing =
      pacing.kind === "drop-intermediate"
        ? { kind: "drop-intermediate", maxPendingFrames: Math.max(1, pacing.maxPendingFrames) }
        : pacing;
    this.defaultMinDwellMs = defaultMinDwellMs;
    this.seamMs = seamMs;
    this.reflexTable = reflexTable;
    this.getReflexKeys = getReflexKeys;
    this.playbackCatalog = playbackCatalog;
  }

  /** Make `turnId` the live turn and abandon frames still queued from older ones. */
  startTurn(turnId: string): void {
    this.currentTurnId = turnId;
    this.pending = this.pending.filter((tf) => tf.turnId === turnId);
  }

  /** Queue a frame for playback; frames from a turn that is not live are dropped. */
  ingest(turnFrame: TurnFrame): void {
    if (turnFrame.turnId !== this.currentTurnId) return;
    this.pending.push(turnFrame);
    this.applyPacing();
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
      this.active = {
        turn: next,
        enteredAtMs: nowMs,
        seam: this.buildSeam(next, nowMs),
      };
    }

    const active = this.active;
    if (!active) return null;
    const { frame } = active.turn;
    const seam = this.renderSeam(active, nowMs);
    return {
      frame,
      turnId: active.turn.turnId,
      enteredAtMs: active.enteredAtMs,
      minDwellMs: minDwellOf(frame, this.defaultMinDwellMs),
      interruptible: interruptibleOf(frame),
      seam,
      reflex: this.renderReflex(active, nowMs, seam),
      playback: this.renderPlayback(active, nowMs),
    };
  }

  // Whether the active frame will yield to the one waiting behind it.
  private canAdvance(nowMs: number): boolean {
    const active = this.active;
    if (!active) return true; // nothing is playing yet
    if (active.turn.turnId !== this.currentTurnId) return true; // its turn was left behind
    if (!this.isPlaybackSettled(active, nowMs)) return false; // one-shot beats must land first
    if (interruptibleOf(active.turn.frame)) return true; // this beat may be cut short
    return nowMs - active.enteredAtMs >= minDwellOf(active.turn.frame, this.defaultMinDwellMs);
  }

  // Only same-turn handoffs get to share a seam; stale turns must disappear outright.
  private buildSeam(
    next: TurnFrame,
    nowMs: number,
  ): ActiveRender["seam"] {
    const active = this.active;
    if (!active || this.seamMs <= 0) return null;
    if (active.turn.turnId !== next.turnId) return null;
    return {
      outgoing: { turn: active.turn, enteredAtMs: active.enteredAtMs },
      startedAtMs: nowMs,
    };
  }

  private renderSeam(active: ActiveRender, nowMs: number): RenderSeam | null {
    const seam = active.seam;
    if (!seam) return null;
    const elapsedMs = nowMs - seam.startedAtMs;
    if (elapsedMs >= this.seamMs) return null;
    return {
      outgoingFrame: seam.outgoing.turn.frame,
      outgoingTurnId: seam.outgoing.turn.turnId,
      outgoingEnteredAtMs: seam.outgoing.enteredAtMs,
      startedAtMs: seam.startedAtMs,
      durationMs: this.seamMs,
      progress: progressOf(elapsedMs, this.seamMs),
    };
  }

  // Reflex stays local to the client: the Director never has to mint these tiny beats.
  private renderReflex(
    active: ActiveRender,
    nowMs: number,
    seam: RenderSeam | null,
  ): RenderReflex | null {
    if (seam) return null;
    if (active.turn.turnId !== this.currentTurnId) return null;
    const match = this.matchReflexEntry(active.turn.frame);
    if (!match) return null;

    const baseAtMs = this.reflexBaseAt(active);
    const elapsedMs = nowMs - baseAtMs;
    if (elapsedMs < match.entry.afterMs) return null;
    if (match.entry.intervalMs <= 0 || match.entry.variants.length === 0) return null;

    const slotIndex = Math.floor((elapsedMs - match.entry.afterMs) / match.entry.intervalMs);
    if (slotIndex < 0) return null;

    const variant = match.entry.variants[slotIndex % match.entry.variants.length];
    if (variant.durationMs <= 0) return null;

    const startedAtMs = baseAtMs + match.entry.afterMs + slotIndex * match.entry.intervalMs;
    const activeForMs = nowMs - startedAtMs;
    if (activeForMs < 0 || activeForMs >= variant.durationMs) return null;

    return {
      key: match.key,
      variantId: variant.id,
      slotIndex,
      startedAtMs,
      durationMs: variant.durationMs,
      progress: progressOf(activeForMs, variant.durationMs),
    };
  }

  private reflexBaseAt(active: ActiveRender): number {
    const seam = active.seam;
    if (!seam) return active.enteredAtMs;
    return Math.max(active.enteredAtMs, seam.startedAtMs + this.seamMs);
  }

  private matchReflexEntry(
    frame: StageFrame,
  ): { readonly key: string; readonly entry: ReflexEntry } | null {
    for (const key of this.getReflexKeys(frame)) {
      const entry = this.reflexTable[key];
      if (entry) return { key, entry };
    }
    return null;
  }

  private renderPlayback(active: ActiveRender, nowMs: number): RenderPlayback | null {
    const assetId = active.turn.frame.asset_call?.asset_id;
    if (!assetId) return null;
    const playback = this.playbackCatalog[assetId];
    if (!playback || playback.durationMs <= 0) return null;

    const elapsedMs = Math.max(0, nowMs - active.enteredAtMs);
    if (playback.kind === "loop") {
      const iteration = Math.floor(elapsedMs / playback.durationMs);
      const startedAtMs = active.enteredAtMs + iteration * playback.durationMs;
      return {
        kind: "loop",
        assetId,
        startedAtMs,
        durationMs: playback.durationMs,
        iteration,
        progress: progressOf(nowMs - startedAtMs, playback.durationMs),
      };
    }

    const settled = elapsedMs >= playback.durationMs;
    return {
      kind: "one-shot",
      assetId,
      startedAtMs: active.enteredAtMs,
      durationMs: playback.durationMs,
      progress: settled ? 1 : progressOf(elapsedMs, playback.durationMs),
      settled,
    };
  }

  private isPlaybackSettled(active: ActiveRender, nowMs: number): boolean {
    const assetId = active.turn.frame.asset_call?.asset_id;
    if (!assetId) return true;
    const playback = this.playbackCatalog[assetId];
    if (!playback || playback.kind !== "one-shot" || playback.durationMs <= 0) return true;
    return nowMs - active.enteredAtMs >= playback.durationMs;
  }

  // Keep the newest pending frame and any beats that would look wrong if skipped.
  private applyPacing(): void {
    const pacing = this.pacing;
    if (pacing.kind !== "drop-intermediate") return;
    while (this.pending.length > pacing.maxPendingFrames) {
      const dropIndex = this.findDroppablePendingIndex();
      if (dropIndex < 0) return;
      this.pending.splice(dropIndex, 1);
    }
  }

  private findDroppablePendingIndex(): number {
    for (let index = 0; index < this.pending.length - 1; index += 1) {
      if (this.isPacingDroppable(this.pending[index].frame)) return index;
    }
    return -1;
  }

  private isPacingDroppable(frame: StageFrame): boolean {
    if (!interruptibleOf(frame)) return false;
    const assetId = frame.asset_call?.asset_id;
    if (!assetId) return true;
    const playback = this.playbackCatalog[assetId];
    return playback?.kind !== "one-shot";
  }
}
