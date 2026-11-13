# cia1.tqc: TQC braid engine

**This is a classical simulation of topological quantum computation.** There is
no quantum hardware, no anyons and no qubits. Braids are integer tuples, the
invariants are exact Laurent polynomials, and the Fibonacci-anyon gate is a 2×2
complex matrix product.

**The complexity is bounded on purpose.** Exact evaluation of the Jones
polynomial is #P-hard in general. This engine uses an exact state sum, which is
exponential in the number of crossings, so it refuses words longer than
`MAX_CROSSINGS = 16` and wider than `MAX_STRANDS = 8`, and inputs longer than
4096 bytes. It never truncates a word quietly.

## What it computes

```
bytes ──encode_bytes──► braid words (one per 12-byte block, 3 strands by default)
      ──► Kauffman bracket ⟨L⟩, Jones V(t), V(e^{2πi/5}), Fibonacci-anyon run
      ──► receipt (LUCA hash rule, geometry only, no raw input)
      ──► verify_receipt: recomputes everything from the braid words (and the input, if given)
```

- **Encoding (a choice, not physics):** byte `b` becomes generator `(b % (n-1)) + 1`.
  The crossing is positive when `popcount(b)` is even and negative when it is odd.
- **Bracket:** Temperley–Lieb state sum: `⟨σᵢ⟩ = A⟨1⟩ + A⁻¹⟨eᵢ⟩` and `⟨σᵢ⁻¹⟩ = A⁻¹⟨1⟩ + A⟨eᵢ⟩`,
  and each closed state contributes `d^(loops−1)`, where `d = −A² − A⁻²`.
- **Jones:** `V(t) = (−A³)^(−w) ⟨L⟩`, with `A = t^(−1/4)`. Exponents are exact
  fractions, so links show half-integer powers.
- **Pinned by tests:** the unknot gives `1`. The trefoil σ₁³ gives `t + t³ − t⁴`, and its mirror is
  `t⁻¹ + t⁻³ − t⁻⁴`. The Hopf link σ₁² gives `−t^(1/2) − t^(5/2)`, and the figure-eight `(σ₁σ₂⁻¹)²` gives
  `t² − t + 1 − t⁻¹ + t⁻²`.
- **Invariance (tested):** results are unchanged by conjugation and positive or negative stabilization
  (Markov moves), by σ₁σ₂σ₁ = σ₂σ₁σ₂, by far commutation and by free cancellation.
- **Fibonacci gate:** a port of Monarch-X `_AnyonGate`. The tests pin its outputs to the
  upstream numbers and check that it satisfies the braid relation and stays unitary.

## Receipts

`compute(data)` returns a dict with `schema_version: "luca.tqc.v1"`,
`simulation: "classical"`, `input_sha256` and `input_length`. The raw input is
never included. It also has the encoding rule, the per-block invariants, an
`invariant_digest` (sha256 over the chained Jones digests) and the provenance.

`content_hash` follows the sovereign-instrument `mesh_receipt.LucaReceipt` rule:
the sha256 hex of `json.dumps(body_without_signature, sort_keys=True,
separators=(",", ":"))`. `sign_receipt(r, sign_fn)` takes a caller-held signer.
This package never reads or stores keys.

Anyone can check a receipt:

```bash
python -m cia1.tqc compute --text "hello braid" > r.json
python -m cia1.tqc verify r.json --text "hello braid"   # VALID <hash>
python -m cia1.tqc verify r.json                         # recompute from braid words only
```

## Monarch-X wiring

| Piece | Source | Status |
|---|---|---|
| `FibonacciGate` | `Monarch-X/sophia_os/braiding_governor.py` `_AnyonGate` @ `9581f00ef9fdbe16e578caa0bd24847eff62aa26` (blob `fa79095d904efddd038739fc04798fddf6f2e371`) | **Ported.** Same R phases and F matrix, int generators, no prints |
| `GovernorBridge` | `SophiaBraidingGovernor.encode_reality_chunk` (same file) | **Adapter.** If a Monarch-X governor object is passed in, it anchors the invariant digest and receipt hash, never the raw input |
| Kauffman bracket / Jones | new in this package | **Implemented** (exact) |
| `reality_encoder.KauffmanBracket` | `Monarch-X/sophia_os/reality_encoder.py` @ `9581f00` (blob `d1a5625cde0218a0fbe6fcf339366cdb2c373833`) | **Not used.** Upstream multiplies by (A + A⁻¹) for every crossing, whatever the diagram topology, so its `jones_digest` is not a knot invariant. Monarch-X was left unchanged |

## Limits

- This is a classical computation and gives no quantum speed-up.
- `jones_at_e2pi_i_5` is the exact value at the Fibonacci point, computed classically.
  It is not an estimate from a quantum circuit.
- The Fibonacci gate is only the 3-strand representation, so `anyon` is `null` for other widths.
- The encoding is many-to-one: different inputs can give the same braid word, and so
  the same invariants. `input_sha256` is what binds a receipt to its input.
- The package uses only the standard library, makes no network calls, and has no hardware drivers.

Tests: `pytest tests/test_tqc.py`.
