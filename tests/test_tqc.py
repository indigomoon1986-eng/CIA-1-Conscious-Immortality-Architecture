"""Tests for cia1.tqc — the classical-simulation TQC braid engine."""

import json
import socket
from fractions import Fraction

import pytest

from cia1.tqc import (MAX_CROSSINGS, Braid, BraidError, FibonacciGate, GovernorBridge, Laurent,
                      compute, content_hash, encode_bytes, jones_polynomial, kauffman_bracket,
                      sign_receipt, verify_receipt)
from cia1.tqc.engine import main


def V(strands, word):
    return jones_polynomial(Braid(strands, tuple(word)))


def poly(**terms):
    return Laurent({Fraction(k.replace("m", "-").replace("_", "/")): v for k, v in terms.items()})


# ---------------------------------------------------------------- known invariants

def test_unknot_is_one():
    assert V(1, []) == Laurent.mono(0)
    assert V(2, [1]) == Laurent.mono(0)
    assert V(2, [-1]) == Laurent.mono(0)
    assert V(3, [1, -2]) == Laurent.mono(0)
    assert kauffman_bracket(Braid(1, ())) == Laurent.mono(0)


def test_trefoil_and_mirror():
    right = Laurent({1: 1, 3: 1, 4: -1})          # t + t^3 - t^4
    left = Laurent({-1: 1, -3: 1, -4: -1})        # t^-1 + t^-3 - t^-4
    assert V(2, [1, 1, 1]) == right
    assert V(2, [-1, -1, -1]) == left
    assert V(3, [1, 2, 1, 2]) == right             # same knot, 3-strand braid


def test_hopf_link_and_unlink():
    assert V(2, [1, 1]) == Laurent({Fraction(1, 2): -1, Fraction(5, 2): -1})
    assert V(2, [-1, -1]) == Laurent({Fraction(-1, 2): -1, Fraction(-5, 2): -1})
    assert V(2, []) == Laurent({Fraction(1, 2): -1, Fraction(-1, 2): -1})  # 2-component unlink
    assert Braid(2, (1, 1)).components() == 2


def test_figure_eight_is_amphichiral():
    fig8 = Laurent({2: 1, 1: -1, 0: 1, -1: -1, -2: 1})
    assert V(3, [1, -2, 1, -2]) == fig8
    assert V(3, [-1, 2, -1, 2]) == fig8


def test_jones_at_one_is_two_to_components_minus_one_sign():
    # V_L(1) = (-2)^(c-1)
    for strands, word in [(2, [1, 1, 1]), (2, [1, 1]), (3, [1, 1, 2, 2]), (3, [])]:
        b = Braid(strands, tuple(word))
        val = jones_polynomial(b).evaluate(1)
        assert abs(val - (-2) ** (b.components() - 1)) < 1e-9


# ---------------------------------------------------------------- braid relations / Markov moves

WORDS = [(3, (1, 2, -1, 2, 2)), (4, (1, -2, 3, 1, 2)), (3, (1, 1, -2, 1))]


@pytest.mark.parametrize("strands,word", WORDS)
def test_conjugation_invariance(strands, word):
    b = Braid(strands, word)
    for g in (1, -1, strands - 1):
        assert jones_polynomial(b.conjugate(g)) == jones_polynomial(b)


@pytest.mark.parametrize("strands,word", WORDS)
def test_stabilization_invariance(strands, word):
    b = Braid(strands, word)
    assert jones_polynomial(b.stabilize(True)) == jones_polynomial(b)
    assert jones_polynomial(b.stabilize(False)) == jones_polynomial(b)


def test_braid_relations():
    assert V(3, [1, 2, 1]) == V(3, [2, 1, 2])            # Yang-Baxter / Reidemeister III
    assert V(4, [1, 3, 2]) == V(4, [3, 1, 2])            # far commutation
    assert V(3, [1, -1, 2, 2]) == V(3, [2, 2])           # free cancellation (Reidemeister II)
    assert V(4, [2, 3, 2, 1]) == V(4, [3, 2, 3, 1])


def test_fibonacci_gate_satisfies_braid_relation_and_unitarity():
    def run(word):
        g = FibonacciGate()
        for x in word:
            g.apply(x)
        return g
    a, b = run([1, 2, 1]), run([2, 1, 2])
    assert all(abs(x - y) < 1e-12 for x, y in zip(a.state, b.state))
    assert abs(run([1, -1, 2, -2, 2]).norm() - 1) < 1e-12
    assert all(abs(x - y) < 1e-12 for x, y in zip(run([2, -2]).state, FibonacciGate().state))


def test_fibonacci_gate_matches_monarch_x_upstream_numbers():
    # Values produced by Monarch-X sophia_os/braiding_governor.py _AnyonGate @ 9581f00
    g = FibonacciGate()
    g.apply(1)
    assert abs(g.state[1] - complex(-0.309016994375, -0.951056516295)) < 1e-11
    assert abs(g.measurement_probability() - 0.345491502813) < 1e-11
    g = FibonacciGate()
    for x in (1, -2, 1, 2):
        g.apply(x)
    assert abs(g.state[0] - complex(-0.242934135878, 0.747674390611)) < 1e-11
    assert abs(g.state[1] - complex(0.190983005625, 0.587785252292)) < 1e-11
    assert abs(g.measurement_probability() - 0.595491502813) < 1e-11


# ---------------------------------------------------------------- bounds, encoding, determinism

def test_complexity_bounds_refuse_rather_than_truncate():
    with pytest.raises(BraidError):
        Braid(2, (1,) * (MAX_CROSSINGS + 1))
    with pytest.raises(BraidError):
        Braid(9, ())
    with pytest.raises(BraidError):
        Braid(3, (3,))
    with pytest.raises(BraidError):
        encode_bytes(b"x" * 5000)


def test_encoding_is_deterministic_and_blocked():
    words = encode_bytes(b"Sophia braids the world", strands=3, block=12)
    assert [len(w.word) for w in words] == [12, 11]
    assert words == encode_bytes(b"Sophia braids the world", strands=3, block=12)
    assert encode_bytes(b"") == [Braid(3, ())]


def test_compute_is_deterministic_and_has_no_raw_input():
    data = b"coherence map 71/87/103 THz"
    r1, r2 = compute(data), compute(data)
    assert content_hash(r1) == content_hash(r2)
    blob = json.dumps(r1)
    assert "coherence map" not in blob
    assert r1["simulation"] == "classical"
    assert compute(b"coherence map 71/87/103 THz!")["invariant_digest"] != r1["invariant_digest"]


# ---------------------------------------------------------------- receipts

def test_receipt_verifies_from_braids_and_from_input():
    data = b"real-world input: sensor summary v1"
    r = compute(data)
    assert verify_receipt(r)
    assert verify_receipt(r, data)
    assert not verify_receipt(r, b"different input")


def test_tampered_receipt_fails():
    r = compute(b"tamper me")
    bad = json.loads(json.dumps(r))
    bad["blocks"][0]["jones"][0][1] += 1
    assert not verify_receipt(bad)
    bad = json.loads(json.dumps(r))
    bad["blocks"][0]["braid"]["word"][0] *= -1
    assert not verify_receipt(bad)
    bad = json.loads(json.dumps(r))
    bad["invariant_digest"] = "00" * 32
    assert not verify_receipt(bad)


def test_signature_hook_and_hash_rule_match_luca():
    import hashlib
    r = compute(b"sign me")
    signed = sign_receipt(r, lambda body: hashlib.sha256(b"k" + body).hexdigest())
    good = lambda body, sig: sig == hashlib.sha256(b"k" + body).hexdigest()  # noqa: E731
    assert verify_receipt(signed, verify_fn=good)
    assert not verify_receipt(signed, verify_fn=lambda b, s: False)
    body = {k: v for k, v in signed.items() if k != "signature"}
    expected = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert content_hash(signed) == expected


def test_governor_bridge_local_and_with_governor():
    bridge = GovernorBridge()
    out = bridge.anchor(b"library entry", 3, 7)
    assert out["anchor"]["governor_status"] == "LOCAL_ONLY"
    assert verify_receipt(out["receipt"])

    class FakeGovernor:
        def __init__(self):
            self.calls = []

        def encode_reality_chunk(self, data_stream, winding_p, winding_q, metadata):
            self.calls.append((data_stream, winding_p, winding_q, metadata))
            return "TOPOLOGICALLY_ENCODED"

    gov = FakeGovernor()
    out = GovernorBridge(gov).anchor(b"library entry", 3, 7)
    assert out["anchor"]["governor_status"] == "TOPOLOGICALLY_ENCODED"
    assert gov.calls[0][0]["invariant_digest"] == out["receipt"]["invariant_digest"]
    assert "library entry" not in json.dumps(gov.calls)


def test_cli_roundtrip_offline(tmp_path, capsys, monkeypatch):
    def no_net(*a, **k):
        raise AssertionError("network used")
    monkeypatch.setattr(socket, "socket", no_net)
    assert main(["compute", "--text", "hello braid"]) == 0
    out = capsys.readouterr().out
    p = tmp_path / "r.json"
    p.write_text(out)
    assert main(["verify", str(p), "--text", "hello braid"]) == 0
    assert "VALID" in capsys.readouterr().out
    assert main(["verify", str(p), "--text", "other"]) == 1
