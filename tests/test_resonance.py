"""Resonance lock over a consented brainprint. Research instrument only."""

import pytest

from cia1.entrainment.brainprint import BrainprintSession
from cia1.entrainment.resonance import ResonanceLock, assemble_signal, decode_signal, immersive_directive


def test_safety_pause_matches_mr7_phrase():
    signal = assemble_signal(alpha=0.2, beta=1.2, theta=0.2, gamma=0.9)
    assert signal["overload"] == pytest.approx(1.9)
    decoded = decode_signal(signal)
    assert decoded["label"] == "safety_pause"
    assert decoded["phrase"] == "Pause and reduce stimulus load."


def test_beta_directive_is_focus_vault():
    directive = immersive_directive(
        {"alpha": 0.2, "beta": 0.9, "theta": 0.1, "gamma": 0.4, "delta": 0.1},
        "beta",
        0.8,
    )
    assert directive["mode"] == "vr"
    assert directive["metadata"]["immersive_environment"] == "focus_vault"
    assert len(directive["intent_vector"]) == 3
    assert directive["spatial_anchors"][0]["radius"] == pytest.approx(1.8)


def test_focus_print_locks_beta_and_consent_blocks():
    early = BrainprintSession("did:monarch:leake", "focus", consent=True).frame(12)
    assert early["bands"]["beta"] > early["bands"]["alpha"]
    blocked = ResonanceLock().read(early, beat_hz=18, consent=False)
    assert blocked["status"] == "blocked"
    assert blocked["quality"] == 0.0
    live = ResonanceLock().read(early, beat_hz=10, consent=True)
    assert live["status"] == "ok"
    assert live["dominant"] == "beta"
    assert live["action"] == "FOCUS_SELECT"
    assert live["target_hz"] == 18.0
    assert live["lock_error"] == pytest.approx(8.0)
    assert live["environment"] == "focus_vault"
    assert live["role"] == "Meta Observer"
    deep = BrainprintSession("did:monarch:leake", "focus", consent=True).frame(24)
    paused = ResonanceLock().read(deep, beat_hz=18, consent=True)
    assert paused["dominant"] == "beta"
    assert paused["action"] == "SAFETY_PAUSE"
    assert paused["label"] == "safety_pause"
    assert paused["target_hz"] == 10.0
    assert paused["environment"] == "focus_vault"


def test_curvature_is_zero_until_the_band_vector_moves():
    early = BrainprintSession("did:monarch:leake", "focus", consent=True).frame(12)
    later = BrainprintSession("did:monarch:leake", "focus", consent=True).frame(40)
    lock = ResonanceLock()
    first = lock.read(early, beat_hz=18, consent=True)
    second = lock.read(early, beat_hz=18, consent=True)
    third = lock.read(later, beat_hz=18, consent=True)
    assert first["curvature"] == pytest.approx(0.0)
    assert second["curvature"] == pytest.approx(0.0)
    assert third["curvature"] > 0.0


def test_baseline_sanctuary_and_absorb_ground():
    base = BrainprintSession("did:monarch:leake", "baseline", consent=True).frame(24)
    absorb = BrainprintSession("did:monarch:leake", "absorb", consent=True).frame(24)
    assert ResonanceLock().read(base, 10, consent=True)["environment"] == "resonance_sanctuary"
    assert ResonanceLock().read(absorb, 2, consent=True)["environment"] == "grounding_field"
