"""Entrainment prescriptions mapped onto CPMP phases and CIA continuity axes.

Beats are audio differences (binaural) or pulse rates (isochronic), not clinical
doses. Gains are relative drives on six non-overlapping research bands.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Protocol:
    id: str
    phase: str
    title: str
    band: str
    beat_hz: float
    audio: str
    summary: str
    gains: dict


def _g(delta: float, theta: float, alpha: float, smr: float, beta: float, gamma: float) -> dict:
    return {
        "delta": delta,
        "theta": theta,
        "alpha": alpha,
        "smr": smr,
        "beta": beta,
        "gamma": gamma,
    }


PROTOCOLS_LIST: tuple[Protocol, ...] = (
    Protocol(
        "baseline",
        "phase_0_consent_baseline",
        "Consent baseline",
        "alpha",
        10.0,
        "binaural",
        "10 Hz alpha. A quiet self-model before any drive.",
        _g(0.15, 0.25, 1.0, 0.35, 0.20, 0.08),
    ),
    Protocol(
        "mirror",
        "phase_1_neural_mirror",
        "Neural mirror",
        "theta",
        6.0,
        "binaural",
        "6 Hz theta. Memory channel of the C-loop, mirrored, not migrated.",
        _g(0.20, 1.0, 0.40, 0.18, 0.16, 0.08),
    ),
    Protocol(
        "couple",
        "phase_2_coupled_cognition",
        "Coupled cognition",
        "alpha",
        8.0,
        "binaural",
        "8 Hz border. Alpha and theta share the loop.",
        _g(0.12, 0.75, 0.90, 0.30, 0.22, 0.10),
    ),
    Protocol(
        "focus",
        "phase_3_functional_integration",
        "Focus locus",
        "beta",
        18.0,
        "binaural",
        "18 Hz beta. Veritas focus: one locus, behavior and intention.",
        _g(0.05, 0.12, 0.28, 0.55, 1.0, 0.30),
    ),
    Protocol(
        "absorb",
        "phase_0_consent_baseline",
        "Absorb",
        "delta",
        2.0,
        "binaural",
        "2 Hz delta. Veritas absorb: the spectrum is dense and awareness scatters.",
        _g(1.0, 0.30, 0.16, 0.08, 0.06, 0.04),
    ),
    Protocol(
        "bind",
        "phase_4_continuity_verification",
        "Gamma bind",
        "gamma",
        40.0,
        "isochronic",
        "40 Hz isochronic. A short causal-binding check, not a treatment.",
        _g(0.04, 0.08, 0.16, 0.22, 0.40, 1.0),
    ),
)

PROTOCOLS: dict[str, Protocol] = {item.id: item for item in PROTOCOLS_LIST}
