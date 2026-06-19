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
  --asr-glow: 0.18;
  display: grid;
  gap: 14px;
  max-width: 28rem;
  padding: 18px;
  border-radius: 24px;
  background:
    radial-gradient(circle at top, rgba(255, 244, 214, 0.9), rgba(255, 244, 214, 0) 45%),
    linear-gradient(160deg, #f8f1dd, #f1dcc3 58%, #e7c9b7);
  color: #2f2419;
  box-shadow:
    0 18px 48px rgba(90, 53, 26, 0.16),
    0 0 90px rgba(255, 212, 132, calc(var(--asr-glow) * 0.28));
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
  transition: opacity 90ms linear, transform 90ms linear, filter 90ms linear;
  will-change: transform, opacity, filter;
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
  readonly incomingTransform: string;
  readonly outgoingTransform: string;
  readonly incomingFilter: string;
  readonly outgoingFilter: string;
  readonly stageGlowOpacity: number;
};

export type ReferenceRenderer = {
  readonly render: (state: RenderState | null) => void;
  readonly destroy: () => void;
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress;
const smooth = (progress: number): number => {
  const p = clamp(progress);
  return p * p * (3 - 2 * p);
};

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

type ActorPose = {
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly blur: number;
  readonly glow: number;
};

const idlePose = (): ActorPose => ({
  x: 0,
  y: 0,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  blur: 0,
  glow: 0.16,
});

const poseOfState = (state: string): ActorPose => {
  switch (state) {
    case "thinking":
      return { x: -2, y: -4, rotate: -6, scaleX: 1.02, scaleY: 0.98, blur: 0, glow: 0.2 };
    case "working":
      return { x: 2, y: -1, rotate: 4, scaleX: 1.03, scaleY: 0.97, blur: 0, glow: 0.22 };
    case "presenting":
      return { x: 0, y: -6, rotate: 0, scaleX: 1.05, scaleY: 1.02, blur: 0, glow: 0.24 };
    case "celebrating":
      return { x: 0, y: -8, rotate: 0, scaleX: 1.08, scaleY: 1.04, blur: 0, glow: 0.34 };
    default:
      return idlePose();
  }
};

const composePose = (...poses: readonly ActorPose[]): ActorPose =>
  poses.reduce<ActorPose>(
    (acc, pose) => ({
      x: acc.x + pose.x,
      y: acc.y + pose.y,
      rotate: acc.rotate + pose.rotate,
      scaleX: acc.scaleX * pose.scaleX,
      scaleY: acc.scaleY * pose.scaleY,
      blur: acc.blur + pose.blur,
      glow: acc.glow + pose.glow,
    }),
    { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, blur: 0, glow: 0 },
  );

const playbackPoseOf = (state: RenderState | null): ActorPose => {
  const playback = state?.playback;
  if (!playback) return idlePose();
  if (playback.kind === "loop") {
    const phase = playback.progress * Math.PI * 2;
    const bob = Math.sin(phase);
    return {
      x: Math.cos(phase) * 1.5,
      y: bob * -5,
      rotate: Math.sin(phase + Math.PI / 3) * 3.5,
      scaleX: 1 + Math.cos(phase) * 0.025,
      scaleY: 1 + bob * 0.03,
      blur: 0,
      glow: 0.04,
    };
  }
  if (playback.settled) {
    return { x: 0, y: -2, rotate: 0, scaleX: 1.02, scaleY: 1.01, blur: 0, glow: 0.08 };
  }
  const arc = Math.sin(playback.progress * Math.PI);
  return {
    x: 0,
    y: arc * -12,
    rotate: arc * 8,
    scaleX: 1 + arc * 0.12,
    scaleY: 1 + arc * 0.08,
    blur: 0,
    glow: 0.14,
  };
};

const reflexPoseOf = (state: RenderState | null): ActorPose => {
  const reflex = state?.reflex;
  if (!reflex) return idlePose();
  const centered = Math.sin(reflex.progress * Math.PI);
  switch (reflex.variantId) {
    case "blink":
      return {
        x: 0,
        y: centered * 1.5,
        rotate: 0,
        scaleX: 1 + centered * 0.05,
        scaleY: 1 - centered * 0.16,
        blur: 0,
        glow: 0.04,
      };
    case "tilt":
      return {
        x: centered * -4,
        y: centered * -2,
        rotate: centered * -10,
        scaleX: 1,
        scaleY: 1,
        blur: 0,
        glow: 0.04,
      };
    case "tap":
      return {
        x: Math.sin(reflex.progress * Math.PI * 2) * 4,
        y: centered * -3,
        rotate: Math.sin(reflex.progress * Math.PI * 2) * 4,
        scaleX: 1.01,
        scaleY: 0.99,
        blur: 0,
        glow: 0.03,
      };
    default:
      return {
        x: 0,
        y: centered * -2,
        rotate: 0,
        scaleX: 1 + centered * 0.03,
        scaleY: 1 + centered * 0.03,
        blur: 0,
        glow: 0.02,
      };
  }
};

const ambientPoseOf = (state: RenderState | null, nowMs: number): ActorPose => {
  if (!state) return idlePose();
  const elapsedMs = Math.max(0, nowMs - state.enteredAtMs);
  const phase = elapsedMs / 420;
  const bob = Math.sin(phase);
  const sway = Math.cos(phase * 0.7);
  const amplitude = state.seam
    ? 0.24
    : state.playback?.kind === "one-shot" && state.playback.settled
      ? 0.9
      : 0.55;
  return {
    x: sway * 1.8 * amplitude,
    y: bob * -2.4 * amplitude,
    rotate: sway * 1.8 * amplitude,
    scaleX: 1 + bob * 0.01 * amplitude,
    scaleY: 1 + sway * 0.012 * amplitude,
    blur: 0,
    glow: 0.02 * amplitude,
  };
};

const seamIncomingPoseOf = (state: RenderState | null): ActorPose => {
  const seam = state?.seam;
  if (!seam) return idlePose();
  const eased = smooth(seam.progress);
  return {
    x: lerp(12, 0, eased),
    y: lerp(5, 0, eased),
    rotate: lerp(-8, 0, eased),
    scaleX: lerp(0.92, 1, eased),
    scaleY: lerp(0.92, 1, eased),
    blur: lerp(1.6, 0, eased),
    glow: 0.05,
  };
};

const seamOutgoingPoseOf = (state: RenderState | null): ActorPose => {
  const seam = state?.seam;
  if (!seam) return idlePose();
  const eased = smooth(seam.progress);
  return {
    x: lerp(0, -14, eased),
    y: lerp(0, -4, eased),
    rotate: lerp(0, 8, eased),
    scaleX: lerp(1, 0.94, eased),
    scaleY: lerp(1, 0.94, eased),
    blur: lerp(0, 2.4, eased),
    glow: 0.03,
  };
};

const transformOf = (pose: ActorPose): string =>
  `translate3d(${pose.x.toFixed(1)}px, ${pose.y.toFixed(1)}px, 0) rotate(${pose.rotate.toFixed(1)}deg) scale(${pose.scaleX.toFixed(3)}, ${pose.scaleY.toFixed(3)})`;

const filterOf = (pose: ActorPose): string =>
  `drop-shadow(0 12px 18px rgba(90, 53, 26, 0.18)) blur(${pose.blur.toFixed(2)}px)`;

export function describeReferenceRenderState(
  state: RenderState | null,
  nowMs = state?.enteredAtMs ?? 0,
): ReferenceRenderView {
  const seamProgress = clamp(state?.seam?.progress ?? 1);
  const incomingPose = composePose(
    poseOfState(state?.frame.character_state ?? "idle"),
    playbackPoseOf(state),
    reflexPoseOf(state),
    ambientPoseOf(state, nowMs),
    seamIncomingPoseOf(state),
  );
  const outgoingPose = state?.seam
    ? composePose(
        poseOfState(state.seam.outgoingFrame.character_state),
        seamOutgoingPoseOf(state),
      )
    : idlePose();
  const stageGlowOpacity = clamp(
    Math.max(incomingPose.glow, outgoingPose.glow) + (state?.frame.fx ? 0.12 : 0),
  );
  return {
    actorEmoji: emojiOf(state?.frame.character_state ?? "idle"),
    outgoingEmoji: state?.seam ? emojiOf(state.seam.outgoingFrame.character_state) : null,
    labelText: labelOf(state),
    bubbleText: bubbleOf(state),
    cardText: cardOf(state),
    badges: badgesOf(state),
    incomingOpacity: state?.seam ? seamProgress : 1,
    outgoingOpacity: state?.seam ? 1 - seamProgress : 0,
    incomingTransform: transformOf(incomingPose),
    outgoingTransform: transformOf(outgoingPose),
    incomingFilter: filterOf(incomingPose),
    outgoingFilter: filterOf(outgoingPose),
    stageGlowOpacity,
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

  const stage = requireElement(root.querySelector<HTMLElement>(".asr-stage"), "stage");
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
    const view = describeReferenceRenderState(state, performance.now());
    stage.style.setProperty("--asr-glow", view.stageGlowOpacity.toFixed(3));
    label.textContent = view.labelText;
    incoming.textContent = view.actorEmoji;
    incoming.style.opacity = String(view.incomingOpacity);
    incoming.style.transform = view.incomingTransform;
    incoming.style.filter = view.incomingFilter;
    outgoing.textContent = view.outgoingEmoji ?? "";
    outgoing.style.opacity = String(view.outgoingOpacity);
    outgoing.style.transform = view.outgoingTransform;
    outgoing.style.filter = view.outgoingFilter;
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
