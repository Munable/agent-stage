import { createReferenceRenderer, type ReferenceRenderer } from "./reference-renderer.js";
import {
  parseStageAssetDirectory,
  StageManager,
  type ReflexTable,
  type StageAssetDirectoryEntry,
  type StagePacingPolicy,
} from "./stage-manager.js";
import type { StageFrame } from "./stage-frame.js";

export type StageDemoConfig = {
  readonly assetDirectory: readonly StageAssetDirectoryEntry[];
  readonly reflexTable?: ReflexTable;
  readonly pacing?: StagePacingPolicy;
};

export type StageDemoFrameMessage = {
  readonly type: "stage_frame";
  readonly frame: StageFrame;
};

export type StageDemoTurnSummary = {
  readonly type: "turn_summary";
  readonly frames: number;
  readonly droppedEvents: number;
};

export type StageDemoLine = StageDemoFrameMessage | StageDemoTurnSummary;

export type StageDemoPlayerOptions = {
  readonly root: HTMLElement;
  readonly runButton: HTMLButtonElement;
  readonly statusNode?: HTMLElement | null;
  readonly traceUrl: string;
  readonly turnUrl: string;
  readonly configUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStageDemoLine(line: string): StageDemoLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.type === "turn_summary") {
    if (typeof parsed.frames !== "number" || typeof parsed.dropped_events !== "number") return null;
    return {
      type: "turn_summary",
      frames: parsed.frames,
      droppedEvents: parsed.dropped_events,
    };
  }
  if (
    typeof parsed.character_state !== "string" ||
    !("thinking_text" in parsed) ||
    !("fx" in parsed) ||
    !("prop" in parsed) ||
    !("card" in parsed)
  ) {
    return null;
  }
  return { type: "stage_frame", frame: parsed as StageFrame };
}

export function buildStageDemoManager(config: StageDemoConfig): StageManager {
  const parsed = parseStageAssetDirectory(config.assetDirectory);
  return new StageManager({
    playbackCatalog: parsed.playbackCatalog,
    reflexTable: config.reflexTable ?? {},
    pacing: config.pacing,
  });
}

async function readStreamLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      await onLine(trimmed);
    }
  }
  const finalLine = buffer.trim();
  if (finalLine) await onLine(finalLine);
}

export async function attachStageDemo(options: StageDemoPlayerOptions): Promise<{
  readonly run: () => Promise<void>;
  readonly destroy: () => void;
}> {
  const config = (await (await fetch(options.configUrl)).json()) as StageDemoConfig;
  let manager = buildStageDemoManager(config);
  let renderer: ReferenceRenderer = createReferenceRenderer(options.root);
  let turnCounter = 0;
  let rafId = 0;
  let running = false;

  const setStatus = (text: string): void => {
    if (options.statusNode) options.statusNode.textContent = text;
  };

  const paint = (): void => {
    renderer.render(manager.tick(performance.now()));
    rafId = requestAnimationFrame(paint);
  };

  const resetStage = (): void => {
    manager = buildStageDemoManager(config);
  };

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    options.runButton.disabled = true;
    setStatus("Running scripted turn...");
    resetStage();
    const turnId = `demo-${turnCounter++}`;
    let activatedTurn = false;
    manager.startTurn(turnId);

    try {
      const trace = await (await fetch(options.traceUrl)).text();
      const response = await fetch(options.turnUrl, { method: "POST", body: trace });
      if (!response.body) throw new Error("stage demo response has no body");
      await readStreamLines(response.body, (line) => {
        const decoded = parseStageDemoLine(line);
        if (!decoded) return;
        if (decoded.type === "turn_summary") {
          setStatus(`Played ${decoded.frames} frame(s), dropped ${decoded.droppedEvents} event(s).`);
          return;
        }
        manager.ingest({ turnId, frame: decoded.frame });
        if (!activatedTurn) {
          renderer.render(manager.tick(performance.now()));
          activatedTurn = true;
        }
      });
    } finally {
      running = false;
      options.runButton.disabled = false;
    }
  };

  options.runButton.addEventListener("click", () => {
    void run();
  });
  paint();
  setStatus("Ready.");

  return {
    run,
    destroy: () => {
      cancelAnimationFrame(rafId);
      renderer.destroy();
    },
  };
}
