import type { RenderState } from "./stage-manager.js";

const EMOJI_BY_STATE: Readonly<Record<string, string>> = {
  idle: "🙂",
  thinking: "🤔",
  working: "🔧",
  presenting: "📋",
  celebrating: "🎉",
};

const STYLE_ID = "agent-stage-reference-renderer";

export const REFERENCE_RENDERER_CSS = `
.asr-stage {
  display: grid;
  gap: 14px;
  max-width: 28rem;
  padding: 18px;
  border-radius: 24px;
  background:
    radial-gradient(circle at top, rgba(255, 244, 214, 0.9), rgba(255, 244, 214, 0) 45%),
    linear-gradient(160deg, #f8f1dd, #f1dcc3 58%, #e7c9b7);
  color: #2f2419;
  box-shadow: 0 18px 48px rgba(90, 53, 26, 0.16);
  font-family: ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", sans-serif;
}

.asr-actor {
  position: relative;
  min-height: 5rem;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.asr-actorGlyph {
  grid-area: 1 / 1;
  font-size: 4.5rem;
  line-height: 1;
  transition: opacity 120ms linear, transform 120ms linear;
}

.asr-actorGlyph[data-layer="outgoing"] {
  transform: translateX(-6%) scale(0.96);
}

.asr-label {
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.72;
}

.asr-bubble {
  min-height: 1.6rem;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(90, 53, 26, 0.12);
  font-size: 0.98rem;
}

.asr-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.asr-badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(47, 36, 25, 0.08);
  font-size: 0.78rem;
}

.asr-card {
  min-height: 3.5rem;
  margin: 0;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(47, 36, 25, 0.06);
  font: 0.78rem/1.45 ui-monospace, "SFMono-Regular", monospace;
  white-space: pre-wrap;
}
`.trim();

export type ReferenceRenderView = {
  readonly actorEmoji: string;
  readonly outgoingEmoji: string | null;
  readonly labelText: string;
  readonly bubbleText: string;
  readonly cardText: string;
  readonly badges: readonly string[];
  readonly incomingOpacity: number;
  readonly outgoingOpacity: number;
};

export type ReferenceRenderer = {
  readonly render: (state: RenderState | null) => void;
  readonly destroy: () => void;
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

const emojiOf = (state: string): string => EMOJI_BY_STATE[state] ?? "🎭";

const labelOf = (state: RenderState | null): string =>
  state ? `${state.turnId} · ${state.frame.character_state}` : "Awaiting frames";

const bubbleOf = (state: RenderState | null): string =>
  state?.frame.thinking_text ?? "";

const cardOf = (state: RenderState | null): string =>
  state?.frame.card ? JSON.stringify(state.frame.card) : "";

const badgesOf = (state: RenderState | null): string[] => {
  if (!state) return [];
  const badges: string[] = [];
  if (state.frame.fx) badges.push(`fx: ${state.frame.fx}`);
  if (state.frame.prop) badges.push(`prop: ${state.frame.prop}`);
  if (state.frame.voice_tag) badges.push(`voice: ${state.frame.voice_tag}`);
  if (state.reflex) badges.push(`reflex: ${state.reflex.variantId}`);
  const playback = state.playback;
  if (playback?.kind === "loop") badges.push(`loop ${playback.iteration + 1}`);
  if (playback?.kind === "one-shot") badges.push(playback.settled ? "hold" : "beat");
  return badges;
};

export function describeReferenceRenderState(state: RenderState | null): ReferenceRenderView {
  const seamProgress = clamp(state?.seam?.progress ?? 1);
  return {
    actorEmoji: emojiOf(state?.frame.character_state ?? "idle"),
    outgoingEmoji: state?.seam ? emojiOf(state.seam.outgoingFrame.character_state) : null,
    labelText: labelOf(state),
    bubbleText: bubbleOf(state),
    cardText: cardOf(state),
    badges: badgesOf(state),
    incomingOpacity: state?.seam ? seamProgress : 1,
    outgoingOpacity: state?.seam ? 1 - seamProgress : 0,
  };
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = REFERENCE_RENDERER_CSS;
  doc.head.append(style);
}

function requireElement<T extends Element>(value: T | null, role: string): T {
  if (value) return value;
  throw new Error(`reference renderer is missing ${role}`);
}

export function createReferenceRenderer(root: HTMLElement): ReferenceRenderer {
  const doc = root.ownerDocument;
  ensureStyle(doc);
  root.innerHTML = `
    <section class="asr-stage">
      <div class="asr-label" data-asr="label"></div>
      <div class="asr-actor">
        <span class="asr-actorGlyph" data-asr="outgoing" data-layer="outgoing"></span>
        <span class="asr-actorGlyph" data-asr="incoming" data-layer="incoming"></span>
      </div>
      <div class="asr-bubble" data-asr="bubble"></div>
      <div class="asr-badges" data-asr="badges"></div>
      <pre class="asr-card" data-asr="card"></pre>
    </section>
  `;

  const label = requireElement(root.querySelector<HTMLElement>('[data-asr="label"]'), "label");
  const incoming = requireElement(
    root.querySelector<HTMLElement>('[data-asr="incoming"]'),
    "incoming actor",
  );
  const outgoing = requireElement(
    root.querySelector<HTMLElement>('[data-asr="outgoing"]'),
    "outgoing actor",
  );
  const bubble = requireElement(root.querySelector<HTMLElement>('[data-asr="bubble"]'), "bubble");
  const badges = requireElement(root.querySelector<HTMLElement>('[data-asr="badges"]'), "badges");
  const card = requireElement(root.querySelector<HTMLElement>('[data-asr="card"]'), "card");

  const render = (state: RenderState | null): void => {
    const view = describeReferenceRenderState(state);
    label.textContent = view.labelText;
    incoming.textContent = view.actorEmoji;
    incoming.style.opacity = String(view.incomingOpacity);
    outgoing.textContent = view.outgoingEmoji ?? "";
    outgoing.style.opacity = String(view.outgoingOpacity);
    bubble.textContent = view.bubbleText || " ";
    card.textContent = view.cardText || " ";
    badges.replaceChildren(
      ...view.badges.map((text) => {
        const badge = doc.createElement("span");
        badge.className = "asr-badge";
        badge.textContent = text;
        return badge;
      }),
    );
  };

  render(null);
  return {
    render,
    destroy: () => {
      root.textContent = "";
    },
  };
}
