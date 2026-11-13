"""TQC braid engine: real input -> braid words -> invariants -> verifiable receipt.

CLASSICAL SIMULATION of topological quantum computation. No quantum hardware,
no anyons, no qubits. The "compute primitive" is the braid: input bytes are
encoded as braid words, and the outputs are exact knot/link invariants of the
braid closures (Kauffman bracket, Jones polynomial) plus a classical simulation
of the 3-strand Fibonacci-anyon representation ported from the Monarch-X
braiding governor. Everything is deterministic, so anyone holding the input (or
just the receipt's braid words) can recompute and check the receipt.

Pipeline
--------
    bytes --encode_bytes--> [Braid, ...]   (one word per block)
          --jones_polynomial / FibonacciGate--> per-block invariants
          --build_receipt--> LUCA-style receipt (geometry only, no raw input)
          --verify_receipt--> True/False, recomputed from scratch

Receipt hashing is the sovereign-instrument ``mesh_receipt.LucaReceipt`` rule:
``sha256_hex(json.dumps(body_minus_signature, sort_keys=True, separators=(",", ":")))``.
"""

from __future__ import annotations

import argparse
import cmath
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from .braid import (MAX_CROSSINGS, Braid, BraidError, Laurent, evaluate_at_root_of_unity,
                    jones_polynomial, kauffman_bracket)

ENGINE_VERSION = "cia1.tqc/0.1.0"
SCHEMA = "luca.tqc.v1"
DEFAULT_STRANDS = 3          # 3 strands = the Monarch-X AnyonGate's two generators
DEFAULT_BLOCK = 12           # bytes (= crossings) per braid word
MAX_INPUT_BYTES = 4096       # bound the work: 4096/12 blocks of 2^12 states each
FLOAT_DIGITS = 9             # rounding for cross-platform deterministic floats

MONARCH_X_SOURCE = {
    "repo": "indigomoon1986-eng/Monarch-X",
    "commit": "9581f00ef9fdbe16e578caa0bd24847eff62aa26",
    "path": "sophia_os/braiding_governor.py",
    "blob": "fa79095d904efddd038739fc04798fddf6f2e371",
    "ported": "_AnyonGate (R phases, F matrix, sigma_1/sigma_2, measurement_probability)",
}


# --------------------------------------------------------------------------- input encoding


def encode_bytes(data: bytes, strands: int = DEFAULT_STRANDS,
                 block: int = DEFAULT_BLOCK) -> List[Braid]:
    """Deterministically encode bytes as braid words, one word per ``block`` bytes.

    Byte b becomes one crossing: generator index ``(b % (strands-1)) + 1`` and sign
    ``+`` when popcount(b) is even, ``-`` when odd. The mapping is a documented
    encoding choice, not physics. Empty input encodes as the trivial braid.
    """
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("encode_bytes takes bytes; encode text yourself (e.g. utf-8)")
    if strands < 2:
        raise BraidError("need at least 2 strands to encode bytes")
    if not 1 <= block <= MAX_CROSSINGS:
        raise BraidError(f"block must be 1..{MAX_CROSSINGS}")
    if len(data) > MAX_INPUT_BYTES:
        raise BraidError(f"input of {len(data)} bytes exceeds MAX_INPUT_BYTES={MAX_INPUT_BYTES}")
    if not data:
        return [Braid(strands, ())]
    words = []
    for off in range(0, len(data), block):
        word = []
        for b in data[off:off + block]:
            gen = (b % (strands - 1)) + 1
            word.append(gen if bin(b).count("1") % 2 == 0 else -gen)
        words.append(Braid(strands, tuple(word)))
    return words


# --------------------------------------------------------------------------- Fibonacci anyon gate (ported)


class FibonacciGate:
    """Port of Monarch-X ``_AnyonGate`` (see MONARCH_X_SOURCE).

    Two-dimensional fusion space of three Fibonacci anyons. sigma_1 is diagonal
    in the R phases; sigma_2 = F R F^T. Same numbers as upstream; the only change
    is generator indexing by int (+1, -1, +2, -2) and no print side effects.
    This is a classical 2x2 complex matrix simulation.
    """

    R = (cmath.exp(1j * 4 * math.pi / 5), cmath.exp(-1j * 3 * math.pi / 5))

    def __init__(self) -> None:
        self.state: List[complex] = [0j, 1 + 0j]

    @staticmethod
    def _f() -> List[List[float]]:
        phi = (1 + math.sqrt(5)) / 2
        pi = 1.0 / phi
        ps = math.sqrt(pi)
        return [[pi, ps], [ps, -pi]]

    def _apply_f(self, f: List[List[float]]) -> None:
        a, b = self.state
        self.state = [f[0][0] * a + f[0][1] * b, f[1][0] * a + f[1][1] * b]

    def _apply_r(self, inverse: bool) -> None:
        self.state = [(r.conjugate() if inverse else r) * s for r, s in zip(self.R, self.state)]

    def apply(self, gen: int) -> None:
        if gen in (1, -1):
            self._apply_r(gen < 0)
        elif gen in (2, -2):
            f = self._f()
            self._apply_f(f)
            self._apply_r(gen < 0)
            self._apply_f([[f[0][0], f[1][0]], [f[0][1], f[1][1]]])
        else:
            raise BraidError("FibonacciGate is the 3-strand representation: generators +-1, +-2 only")

    def norm(self) -> float:
        return math.sqrt(sum(abs(s) ** 2 for s in self.state))

    def measurement_probability(self) -> float:
        """Upstream P = 1/2 (1 + Re<psi0|psi>) against the initial |tau tau -> tau> state."""
        return 0.5 * (1 + self.state[1].real)


def anyon_run(braid: Braid) -> Optional[Dict[str, Any]]:
    """Run a 3-strand braid through the ported Fibonacci gate; None for other widths."""
    if braid.strands != 3:
        return None
    g = FibonacciGate()
    for gen in braid.word:
        g.apply(gen)
    r = lambda x: round(x, FLOAT_DIGITS) + 0.0  # noqa: E731  (+0.0 normalises -0.0)
    return {
        "state": [[r(z.real), r(z.imag)] for z in g.state],
        "norm": r(g.norm()),
        "measurement_probability": r(g.measurement_probability()),
    }


# --------------------------------------------------------------------------- compute + receipt


def invariants(braid: Braid) -> Dict[str, Any]:
    """Every deterministic output for one braid word."""
    v = jones_polynomial(braid)
    v5 = evaluate_at_root_of_unity(v, 5)
    r = lambda x: round(x, FLOAT_DIGITS) + 0.0  # noqa: E731
    return {
        "braid": braid.to_dict(),
        "writhe": braid.writhe,
        "components": braid.components(),
        "kauffman_bracket": kauffman_bracket(braid).canonical(),
        "jones": v.canonical(),
        "jones_pretty": v.pretty(),
        "jones_digest": v.digest(),
        "jones_at_e2pi_i_5": [r(v5.real), r(v5.imag)],
        "anyon": anyon_run(braid),
    }


def canonical_body(receipt: Mapping[str, Any]) -> bytes:
    body = {k: v for k, v in receipt.items() if k != "signature"}
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")


def content_hash(receipt: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_body(receipt)).hexdigest()


def compute(data: bytes, strands: int = DEFAULT_STRANDS, block: int = DEFAULT_BLOCK) -> Dict[str, Any]:
    """Encode ``data`` and return the full (unsigned) receipt. Raw bytes are not included."""
    blocks = [invariants(b) for b in encode_bytes(data, strands, block)]
    chain = hashlib.sha256()
    for blk in blocks:
        chain.update(bytes.fromhex(blk["jones_digest"]))
    return {
        "schema_version": SCHEMA,
        "event_kind": "tqc_braid_compute",
        "engine": ENGINE_VERSION,
        "simulation": "classical",
        "input_sha256": hashlib.sha256(bytes(data)).hexdigest(),
        "input_length": len(data),
        "encoding": {"strands": strands, "block": block,
                     "rule": "gen=(b%(n-1))+1; sign=+ if popcount(b) even else -"},
        "blocks": blocks,
        "invariant_digest": chain.hexdigest(),
        "provenance": {"monarch_x": MONARCH_X_SOURCE},
        "signature": "",
    }


def sign_receipt(receipt: Mapping[str, Any], sign_fn: Callable[[bytes], str]) -> Dict[str, Any]:
    """Sign with a caller-held key. ``sign_fn(bytes) -> str``; no key handling here."""
    out = dict(receipt)
    out["signature"] = sign_fn(canonical_body(out))
    return out


def verify_receipt(receipt: Mapping[str, Any], data: Optional[bytes] = None,
                   verify_fn: Optional[Callable[[bytes, str], bool]] = None) -> bool:
    """Recompute every invariant from the receipt's braid words and compare.

    If ``data`` is given, also re-encode it and require identical braid words and
    input hash. If ``verify_fn`` is given, the signature must verify too.
    """
    try:
        if receipt.get("schema_version") != SCHEMA:
            return False
        enc = receipt["encoding"]
        if data is not None:
            if hashlib.sha256(bytes(data)).hexdigest() != receipt["input_sha256"]:
                return False
            expected = compute(data, enc["strands"], enc["block"])
            expected["signature"] = receipt.get("signature", "")
            if content_hash(expected) != content_hash(receipt):
                return False
        chain = hashlib.sha256()
        for blk in receipt["blocks"]:
            b = Braid(int(blk["braid"]["strands"]), tuple(int(g) for g in blk["braid"]["word"]))
            if invariants(b) != blk:
                return False
            chain.update(bytes.fromhex(blk["jones_digest"]))
        if chain.hexdigest() != receipt["invariant_digest"]:
            return False
        if verify_fn is not None and not verify_fn(canonical_body(receipt), receipt.get("signature", "")):
            return False
        return True
    except (KeyError, TypeError, ValueError, BraidError):
        return False


# --------------------------------------------------------------------------- Monarch-X governor wiring


class GovernorBridge:
    """Wire the engine to the Monarch-X braiding governor.

    Default: uses the ported FibonacciGate (no Monarch-X checkout needed).
    If ``governor`` is passed (e.g. ``sophia_os.braiding_governor.SophiaBraidingGovernor()``
    from a Monarch-X checkout), ``anchor`` also calls its ``encode_reality_chunk`` so the
    braided result lands in the governor's toroidal memory. The receipt is always ours.

    Known upstream gap (not changed here): Monarch-X ``reality_encoder.KauffmanBracket``
    multiplies (A + A^-1) per crossing regardless of diagram topology, so its
    ``jones_digest`` is not a knot invariant. This engine computes the real bracket.
    """

    def __init__(self, governor: Any = None) -> None:
        self.governor = governor
        self.anchored: List[Dict[str, Any]] = []

    def anchor(self, data: bytes, winding_p: int = 1, winding_q: int = 1) -> Dict[str, Any]:
        receipt = compute(data)
        status = "LOCAL_ONLY"
        if self.governor is not None:
            status = self.governor.encode_reality_chunk(
                data_stream={"invariant_digest": receipt["invariant_digest"],
                             "input_sha256": receipt["input_sha256"]},
                winding_p=winding_p, winding_q=winding_q,
                metadata={"engine": ENGINE_VERSION, "receipt_hash": content_hash(receipt)})
        entry = {"receipt_hash": content_hash(receipt), "torus": [winding_p, winding_q],
                 "governor_status": status}
        self.anchored.append(entry)
        return {"receipt": receipt, "anchor": entry}


# --------------------------------------------------------------------------- CLI


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m cia1.tqc",
                                 description="Classical-simulation TQC braid engine")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compute", help="compute a receipt for a file or text")
    c.add_argument("--text")
    c.add_argument("--file")
    c.add_argument("--strands", type=int, default=DEFAULT_STRANDS)
    c.add_argument("--block", type=int, default=DEFAULT_BLOCK)
    v = sub.add_parser("verify", help="verify a receipt JSON file")
    v.add_argument("receipt")
    v.add_argument("--file")
    v.add_argument("--text")
    a = ap.parse_args(argv)
    if a.cmd == "compute":
        data = a.text.encode() if a.text is not None else open(a.file, "rb").read() if a.file else b""
        r = compute(data, a.strands, a.block)
        print(json.dumps({"hash": content_hash(r), "receipt": r}, indent=2))
        return 0
    r = json.load(open(a.receipt))
    r = r.get("receipt", r)
    data = a.text.encode() if a.text is not None else open(a.file, "rb").read() if a.file else None
    ok = verify_receipt(r, data)
    print("VALID" if ok else "INVALID", content_hash(r))
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
