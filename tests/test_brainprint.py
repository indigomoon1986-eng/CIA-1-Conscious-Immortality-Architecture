"""Brainprint entrainment tests. Stdlib plus pytest when the suite runs."""

import math

import pytest

from cia1.entrainment.brainprint import BrainprintSession
from cia1.entrainment.veritas_recover import matched_filter


def test_consent_required():
    session = BrainprintSession("did:monarch:test", consent=False)
    with pytest.raises(PermissionError):
        session.frame(0)


def test_vector_sci_and_tensor():
    frame = BrainprintSession("did:monarch:test", "baseline", consent=True).frame(0)
    assert len(frame["vector"]) == 6
    assert abs(frame["sci"] - sum(frame["vector"]) / 6) < 1e-9
    assert frame["tensor"][0][1] == pytest.approx(frame["vector"][0] * frame["vector"][1])
    assert frame["anchor"].startswith("sha256:")
    assert 0.0 <= frame["rho"] <= 0.995
    assert frame["h0"] >= 1


def test_deterministic_and_subjective():
    a = BrainprintSession("did:monarch:alpha", "mirror", consent=True).frame(12)
    b = BrainprintSession("did:monarch:alpha", "mirror", consent=True).frame(12)
    c = BrainprintSession("did:monarch:beta", "mirror", consent=True).frame(12)
    assert a["anchor"] == b["anchor"]
    assert a["vector"] == b["vector"]
    assert a["anchor"] != c["anchor"]


def test_focus_lifts_behavior_and_holds_focus():
    rest = BrainprintSession("subj", "focus", consent=True).frame(0)
    driven = BrainprintSession("subj", "focus", consent=True).frame(40)
    assert driven["vector"][2] > rest["vector"][2]
    assert driven["sci"] > rest["sci"] + 0.05
    assert driven["mode"] == "focus"
    assert driven["locus"]


def test_absorb_scatters():
    frame = BrainprintSession("subj", "absorb", consent=True).frame(20)
    assert frame["mode"] == "absorb"
    assert frame["locus"] is None
    assert frame["vector"][5] > frame["vector"][2]


def test_pin_holds_across_a_focus_drive():
    frame = BrainprintSession("subj", "focus", consent=True, pin="absorb").frame(25)
    assert frame["mode"] == "absorb"
    assert frame["pinned"] is True


def test_lock_is_bounded_and_tone_is_found():
    frame = BrainprintSession("subj", "baseline", consent=True).frame(5)
    assert 0.0 <= frame["lock"] <= 1.0
    template = [math.sin(2 * math.pi * 10 * i / 256) for i in range(32)]
    samples = [0.0] * 10 + template + [0.0] * 10
    scanned = matched_filter(samples, template)
    assert scanned.index(max(scanned)) == 10
