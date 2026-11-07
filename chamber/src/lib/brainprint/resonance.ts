/**
 * Resonance lock and Sophia-facing decode over a CIA brainprint.
 *
 * Ports the bounded formulas in sophia-agentic-orchestration
 * `sophia_fullstack/monarch_bci_mr7.py`:
 * - BCIEngine._assemble_signal
 * - NeuralDecoder.decode (default baseline)
 * - build_immersive_brainwave_directive
 * - _classify_action
 *
 * Bands are the synthetic montage means. There is no headset and no
 * quantum-DNA scan. Sophia-MD-Prime's acquisition methods return empty
 * stubs and are not copied. Signal quality is carrier lock mixed with
 * Veritas coherence, the stand-in for MR7's live-adapter quality.
 *
 * Research instrument. Not a clinical decoder and not a therapy.
 */

import { BANDS, type BandId, type Frame } from "./engine.ts";

export const BAND_HZ: Record<BandId, number> = {
  delta: 2,
  theta: 6,
  alpha: 10,
  smr: 14,
  beta: 18,
  gamma: 40,
};

const BASELINE = { focus: 0.5, calm: 0.5, overload: 0.15 };

export type DecodeLabel = "safety_pause" | "focus_select" | "calm_hold" | "neutral_observe";
export type Action = "SAFETY_PAUSE" | "FOCUS_SELECT" | "CALM_HOLD" | "NEUTRAL_OBSERVE";
export type Environment = "focus_vault" | "resonance_sanctuary" | "grounding_field";
export type SceneMode = "vr" | "hologram" | "ar";

export type Resonance = {
  status: "ok" | "blocked";
  focus: number;
  calm: number;
  overload: number;
  curvature: number;
  label: DecodeLabel;
  phrase: string;
  confidence: number;
  coherence: number;
  attention: number;
  stability: number;
  safety: number;
  action: Action;
  dominant: BandId;
  targetHz: number;
  lockError: number;
  quality: number;
  signalQuality: number;
  environment: Environment;
  sceneMode: SceneMode;
  intent: [number, number, number];
  anchor: [number, number, number];
  radius: number;
  role: string;
  spoken: string;
};

function clamp(value: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, value));
}

export function dominantBand(bands: Record<BandId, number>): BandId {
  let best: BandId = "alpha";
  let score = -Infinity;
  for (const band of BANDS) {
    if (bands[band] > score) {
      score = bands[band];
      best = band;
    }
  }
  return best;
}

export function assembleSignal(
  alphaIn: number,
  betaIn: number,
  thetaIn: number,
  gammaIn: number,
  previous: [number, number, number, number] | null,
): {
  alpha: number;
  beta: number;
  theta: number;
  gamma: number;
  focus: number;
  calm: number;
  overload: number;
  curvature: number;
} {
  const alpha = clamp(alphaIn, 0, 2);
  const beta = clamp(betaIn, 0, 2);
  const theta = clamp(thetaIn, 0, 2);
  const gamma = clamp(gammaIn, 0, 2);
  const focus = beta / (alpha + theta + 0.001);
  const calm = alpha / (beta + gamma + 0.001);
  const overload = Math.max(0, gamma + beta - alpha);
  const vector: [number, number, number, number] = [alpha, beta, theta, gamma];
  let curvature = 0;
  if (previous) {
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const d = vector[i] - previous[i];
      sum += d * d;
    }
    curvature = Math.sqrt(sum);
  }
  return { alpha, beta, theta, gamma, focus, calm, overload, curvature };
}

export function decodeSignal(signal: {
  focus: number;
  calm: number;
  overload: number;
  curvature: number;
}): {
  label: DecodeLabel;
  phrase: string;
  confidence: number;
  coherence: number;
  attention: number;
  stability: number;
  safety: number;
  intent: [number, number, number];
} {
  const focus = Math.max(0, signal.focus);
  const calm = Math.max(0, signal.calm);
  const overload = clamp(signal.overload);
  const curvature = Math.max(0, signal.curvature);
  const baselineFocus = Math.max(0.05, BASELINE.focus);
  const baselineCalm = Math.max(0.05, BASELINE.calm);
  const baselineOverload = Math.max(0.01, BASELINE.overload);
  const attention = clamp(focus / (baselineFocus * 2));
  const stability = clamp(calm / (baselineCalm * 2));
  const safety = clamp(1 - overload / (baselineOverload + 1));
  const curvatureGain = clamp(curvature / 2);
  const coherence = clamp(attention * 0.45 + stability * 0.35 + safety * 0.2);
  const confidence = clamp(coherence * 0.7 + curvatureGain * 0.15 + (1 - overload) * 0.15);
  let label: DecodeLabel = "neutral_observe";
  let phrase = "Observe and wait for more signal clarity.";
  if (overload > 0.75) {
    label = "safety_pause";
    phrase = "Pause and reduce stimulus load.";
  } else if (focus > calm && attention >= 0.55) {
    label = "focus_select";
    phrase = "Select and deepen the current focus.";
  } else if (calm >= focus && stability >= 0.55) {
    label = "calm_hold";
    phrase = "Hold a stable, low-curvature state.";
  }
  return {
    label,
    phrase,
    confidence,
    coherence,
    attention,
    stability,
    safety,
    intent: [attention, stability, safety],
  };
}

export function classifyAction(focus: number, calm: number, overload: number): Action {
  if (overload > 0.75) return "SAFETY_PAUSE";
  if (focus > 1.1) return "FOCUS_SELECT";
  if (calm > 1.1) return "CALM_HOLD";
  return "NEUTRAL_OBSERVE";
}

export function immersiveDirective(
  bands: { alpha: number; beta: number; theta: number; gamma: number; delta: number },
  dominant: BandId,
  signalQuality: number,
): {
  environment: Environment;
  sceneMode: SceneMode;
  intent: [number, number, number];
  anchor: [number, number, number];
  radius: number;
  curvature: number;
} {
  const alpha = Math.max(0, bands.alpha);
  const beta = Math.max(0, bands.beta);
  const theta = Math.max(0, bands.theta);
  const gamma = Math.max(0, bands.gamma);
  const delta = Math.max(0, bands.delta);
  const total = alpha + beta + theta + gamma + delta + 0.001;
  const quality = clamp(signalQuality);
  let sceneMode: SceneMode = "ar";
  let environment: Environment = "grounding_field";
  if (dominant === "beta" || dominant === "gamma") {
    sceneMode = "vr";
    environment = "focus_vault";
  } else if (dominant === "alpha" || dominant === "theta") {
    sceneMode = "hologram";
    environment = "resonance_sanctuary";
  }
  const intent: [number, number, number] = [
    Math.min(1, beta / total + gamma / (2 * total)),
    Math.min(1, alpha / total + theta / (2 * total)),
    Math.min(1, quality + delta / (2 * total)),
  ];
  const curvature = Math.max(alpha, beta, theta, gamma, delta) / 2;
  return {
    environment,
    sceneMode,
    intent,
    anchor: [intent[0], intent[1], curvature],
    radius: 1 + quality,
    curvature,
  };
}

/** While a safety pause is active the lock parks on alpha so the audible beat drops. */
export function lockTarget(dominant: BandId, action: Action): number {
  if (action === "SAFETY_PAUSE") return BAND_HZ.alpha;
  return BAND_HZ[dominant];
}

export function slewBeat(current: number, target: number, gain = 0.42): number {
  const next = current + (target - current) * gain;
  const clamped = Math.min(40, Math.max(1, next));
  return Math.round(clamped * 10) / 10;
}

export function readResonance(
  frame: Frame,
  previous: [number, number, number, number] | null,
  consent: boolean,
  beatHz: number,
): Resonance {
  const signal = assembleSignal(frame.bands.alpha, frame.bands.beta, frame.bands.theta, frame.bands.gamma, previous);
  const decoded = decodeSignal({
    focus: signal.focus,
    calm: signal.calm,
    overload: signal.overload,
    curvature: signal.curvature,
  });
  const action = classifyAction(signal.focus, signal.calm, signal.overload);
  const dominant = dominantBand(frame.bands);
  const directive = immersiveDirective(
    {
      alpha: frame.bands.alpha,
      beta: frame.bands.beta,
      theta: frame.bands.theta,
      gamma: frame.bands.gamma,
      delta: frame.bands.delta,
    },
    dominant,
    clamp(0.62 * frame.lock + 0.38 * frame.rho),
  );
  const signalQuality = clamp(0.62 * frame.lock + 0.38 * frame.rho);
  const targetHz = lockTarget(dominant, action);
  const lockError = Math.abs(beatHz - targetHz);
  const miss = Math.min(1, lockError / 12);
  const quality = consent ? clamp((1 - miss) * (0.35 + 0.65 * signalQuality)) : 0;
  const spoken = consent
    ? decoded.phrase
    : "Consent first. I will not lock a rhythm that has not been allowed.";
  return {
    status: consent ? "ok" : "blocked",
    focus: signal.focus,
    calm: signal.calm,
    overload: signal.overload,
    curvature: signal.curvature,
    label: decoded.label,
    phrase: decoded.phrase,
    confidence: decoded.confidence,
    coherence: decoded.coherence,
    attention: decoded.attention,
    stability: decoded.stability,
    safety: decoded.safety,
    action,
    dominant,
    targetHz,
    lockError,
    quality,
    signalQuality,
    environment: directive.environment,
    sceneMode: directive.sceneMode,
    intent: directive.intent,
    anchor: directive.anchor,
    radius: directive.radius,
    role: "Meta Observer",
    spoken,
  };
}

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  focus_vault: "Focus vault",
  resonance_sanctuary: "Resonance sanctuary",
  grounding_field: "Grounding field",
};
