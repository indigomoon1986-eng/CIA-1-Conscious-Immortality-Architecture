"""Resonance lock and Sophia-facing decode over a CIA brainprint.

Ports the bounded formulas in sophia-agentic-orchestration
``sophia_fullstack/monarch_bci_mr7.py`` (object ``bb4f90a4d55b42b0edea9490f88e4b7b538da95c``):

- ``BCIEngine._assemble_signal``
- ``NeuralDecoder.decode`` at the default baseline
- ``build_immersive_brainwave_directive``
- ``_classify_action``

Bands come from a consented brainprint montage. Sophia-MD-Prime's
``quantum_dna_bci`` acquisition methods are empty stubs and are not copied.
There is no headset, no quantum-DNA scan, and no therapy claim.

Signal quality is carrier lock mixed with Veritas coherence. That is the
stand-in for MR7's live-adapter ``signal_quality``, which this repo does not have.

While overload is above the MR7 safety line, a lock parks the audible beat
on alpha (10 Hz). The protocol field itself keeps integrating until the
session withdraws. Consent false blocks the lock.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional

BANDS = ("delta", "theta", "alpha", "smr", "beta", "gamma")
BAND_HZ = {"delta": 2.0, "theta": 6.0, "alpha": 10.0, "smr": 14.0, "beta": 18.0, "gamma": 40.0}
_BASELINE = {"focus": 0.5, "calm": 0.5, "overload": 0.15}


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(value)))


def dominant_band(bands: Dict[str, float]) -> str:
    return max(BANDS, key=lambda band: float(bands.get(band, 0.0)))


def assemble_signal(
    alpha: float,
    beta: float,
    theta: float,
    gamma: float,
    previous: Optional[List[float]] = None,
) -> dict:
    alpha = max(0.0, min(float(alpha), 2.0))
    beta = max(0.0, min(float(beta), 2.0))
    theta = max(0.0, min(float(theta), 2.0))
    gamma = max(0.0, min(float(gamma), 2.0))
    focus = beta / (alpha + theta + 0.001)
    calm = alpha / (beta + gamma + 0.001)
    overload = max(0.0, gamma + beta - alpha)
    vector = [alpha, beta, theta, gamma]
    if previous is None:
        curvature = 0.0
    else:
        curvature = math.sqrt(sum((a - b) ** 2 for a, b in zip(vector, previous)))
    return {
        "alpha": alpha,
        "beta": beta,
        "theta": theta,
        "gamma": gamma,
        "focus": focus,
        "calm": calm,
        "overload": overload,
        "informational_curvature": float(curvature),
    }


def decode_signal(signal: dict) -> dict:
    focus = max(0.0, float(signal.get("focus", 0.0)))
    calm = max(0.0, float(signal.get("calm", 0.0)))
    overload = _clamp(float(signal.get("overload", 0.0)))
    curvature = max(0.0, float(signal.get("informational_curvature", signal.get("curvature", 0.0))))
    baseline_focus = max(0.05, float(_BASELINE["focus"]))
    baseline_calm = max(0.05, float(_BASELINE["calm"]))
    baseline_overload = max(0.01, float(_BASELINE["overload"]))
    attention = _clamp(focus / (baseline_focus * 2.0))
    stability = _clamp(calm / (baseline_calm * 2.0))
    safety = _clamp(1.0 - (overload / (baseline_overload + 1.0)))
    curvature_gain = _clamp(curvature / 2.0)
    coherence = _clamp((attention * 0.45) + (stability * 0.35) + (safety * 0.2))
    confidence = _clamp(coherence * 0.7 + curvature_gain * 0.15 + (1.0 - overload) * 0.15)
    if overload > 0.75:
        label = "safety_pause"
        phrase = "Pause and reduce stimulus load."
    elif focus > calm and attention >= 0.55:
        label = "focus_select"
        phrase = "Select and deepen the current focus."
    elif calm >= focus and stability >= 0.55:
        label = "calm_hold"
        phrase = "Hold a stable, low-curvature state."
    else:
        label = "neutral_observe"
        phrase = "Observe and wait for more signal clarity."
    return {
        "label": label,
        "confidence": round(confidence, 6),
        "coherence": round(coherence, 6),
        "intent_vector": [round(attention, 6), round(stability, 6), round(safety, 6)],
        "phrase": phrase,
        "signal_quality": {
            "attention": round(attention, 6),
            "stability": round(stability, 6),
            "safety": round(safety, 6),
            "curvature_gain": round(curvature_gain, 6),
        },
    }


def classify_action(focus: float, calm: float, overload: float) -> str:
    if float(overload) > 0.75:
        return "SAFETY_PAUSE"
    if float(focus) > 1.1:
        return "FOCUS_SELECT"
    if float(calm) > 1.1:
        return "CALM_HOLD"
    return "NEUTRAL_OBSERVE"


def model_signal_quality(lock: float, rho: float) -> float:
    """Stand-in for an MR7 adapter quality reading. Not a hardware SNR."""
    return _clamp(0.62 * float(lock) + 0.38 * float(rho))


def immersive_directive(bands: Dict[str, float], dominant: str, signal_quality: float) -> dict:
    alpha = max(0.0, float(bands.get("alpha", 0.0)))
    beta = max(0.0, float(bands.get("beta", 0.0)))
    theta = max(0.0, float(bands.get("theta", 0.0)))
    gamma = max(0.0, float(bands.get("gamma", 0.0)))
    delta = max(0.0, float(bands.get("delta", 0.0)))
    total = alpha + beta + theta + gamma + delta + 0.001
    quality = max(0.0, min(1.0, float(signal_quality)))
    if dominant in {"beta", "gamma"}:
        mode = "vr"
        environment = "focus_vault"
    elif dominant in {"alpha", "theta"}:
        mode = "hologram"
        environment = "resonance_sanctuary"
    else:
        mode = "ar"
        environment = "grounding_field"
    intent = [
        min(1.0, beta / total + gamma / (2.0 * total)),
        min(1.0, alpha / total + theta / (2.0 * total)),
        min(1.0, quality + delta / (2.0 * total)),
    ]
    curvature = float(max(alpha, beta, theta, gamma, delta) / 2.0)
    return {
        "intent_vector": intent,
        "global_curvature": curvature,
        "mode": mode,
        "engine": "holographic" if dominant in {"alpha", "theta"} else "unreal_engine_5",
        "resolution": "7680x4320",
        "audio_intensity": quality,
        "metadata": {
            "source": "cia_brainprint",
            "dominant_band": dominant,
            "signal_quality": round(quality, 6),
            "immersive_environment": environment,
            "note": "Synthetic montage. Not a headset and not a medical environment.",
        },
        "spatial_anchors": [
            {
                "name": "brainwave_anchor",
                "position": [round(intent[0], 4), round(intent[1], 4), round(curvature, 4)],
                "radius": round(1.0 + quality, 4),
            }
        ],
    }


def lock_target(dominant: str, action: str) -> float:
    if action == "SAFETY_PAUSE":
        return BAND_HZ["alpha"]
    return float(BAND_HZ.get(dominant, BAND_HZ["alpha"]))


class ResonanceLock:
    """Holds the previous band vector the way BCIEngine holds ``_prev``."""

    def __init__(self) -> None:
        self._prev: Optional[List[float]] = None

    def read(self, frame: dict, beat_hz: float, consent: bool = True) -> dict:
        bands = frame.get("bands")
        if not isinstance(bands, dict):
            raise ValueError("brainprint frame is missing absolute band means")
        if consent is not True:
            dominant = dominant_band(bands)
            return {
                "status": "blocked",
                "reason": "consent_required",
                "role": "Meta Observer",
                "spoken": "Consent first. I will not lock a rhythm that has not been allowed.",
                "dominant": dominant,
                "target_hz": float(BAND_HZ.get(dominant, 10.0)),
                "quality": 0.0,
            }
        signal = assemble_signal(
            bands.get("alpha", 0.0),
            bands.get("beta", 0.0),
            bands.get("theta", 0.0),
            bands.get("gamma", 0.0),
            self._prev,
        )
        self._prev = [signal["alpha"], signal["beta"], signal["theta"], signal["gamma"]]
        decoded = decode_signal(signal)
        action = classify_action(signal["focus"], signal["calm"], signal["overload"])
        dominant = dominant_band(bands)
        quality_in = model_signal_quality(float(frame.get("lock", 0.0)), float(frame.get("rho", 0.0)))
        directive = immersive_directive(bands, dominant, quality_in)
        target = lock_target(dominant, action)
        error = abs(float(beat_hz) - target)
        miss = min(1.0, error / 12.0)
        quality = _clamp((1.0 - miss) * (0.35 + 0.65 * quality_in))
        return {
            "status": "ok",
            "role": "Meta Observer",
            "spoken": decoded["phrase"],
            "dominant": dominant,
            "target_hz": target,
            "lock_error": error,
            "quality": quality,
            "signal_quality": quality_in,
            "action": action,
            "focus": signal["focus"],
            "calm": signal["calm"],
            "overload": signal["overload"],
            "curvature": signal["informational_curvature"],
            "decode": decoded,
            "directive": directive,
            "environment": directive["metadata"]["immersive_environment"],
            "label": decoded["label"],
        }
