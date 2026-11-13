"""Braid words, the Kauffman bracket of a braid closure, and the Jones polynomial.

CLASSICAL SIMULATION. Nothing here runs on quantum hardware. Exact evaluation
of the Jones polynomial is #P-hard in general, so this module computes it by
an exact state sum that is exponential in the crossing count and refuses words
above ``MAX_CROSSINGS`` (and strands above ``MAX_STRANDS``).

Conventions
-----------
* A braid word on ``n`` strands is a tuple of non-zero ints. ``+i`` is the
  generator sigma_i (strand i crosses over strand i+1), ``-i`` is its inverse,
  with ``1 <= i <= n-1``.
* Kauffman bracket via the Temperley-Lieb expansion
      <sigma_i>    = A <1> + A^-1 <e_i>
      <sigma_i^-1> = A^-1 <1> + A <e_i>
  and the closure of each resolved state contributes d^(loops-1) with
  d = -A^2 - A^-2, so the unknot (one loop) has bracket 1.
* Jones polynomial V(t) = (-A^3)^(-w) <L>, with A = t^(-1/4) and w the writhe
  (sum of generator signs). Exponents of t are kept as exact Fractions, so links
  with an even number of components show half-integer powers.

With these conventions the closure of sigma_1^3 is the trefoil with
V = t + t^3 - t^4 and the closure of sigma_1^2 is the Hopf link with
V = -t^(1/2) - t^(5/2). The tests pin both, plus the figure-eight knot.
"""

from __future__ import annotations

import cmath
import hashlib
from dataclasses import dataclass
from fractions import Fraction
from typing import Dict, Iterable, List, Sequence, Tuple

MAX_STRANDS = 8
MAX_CROSSINGS = 16  # 2**16 states; a pure-Python evaluation stays around a second


class BraidError(ValueError):
    """Raised for malformed braid words or words above the complexity bound."""


# --------------------------------------------------------------------------- Laurent polynomials


class Laurent:
    """Sparse Laurent polynomial with integer coefficients and Fraction exponents."""

    __slots__ = ("terms",)

    def __init__(self, terms: Dict[Fraction, int] | None = None) -> None:
        self.terms: Dict[Fraction, int] = {}
        for e, c in (terms or {}).items():
            if c:
                self.terms[Fraction(e)] = self.terms.get(Fraction(e), 0) + int(c)
        self.terms = {e: c for e, c in self.terms.items() if c}

    @classmethod
    def mono(cls, exp, coeff: int = 1) -> "Laurent":
        return cls({Fraction(exp): coeff})

    def __add__(self, other: "Laurent") -> "Laurent":
        out = dict(self.terms)
        for e, c in other.terms.items():
            out[e] = out.get(e, 0) + c
        return Laurent(out)

    def __mul__(self, other: "Laurent") -> "Laurent":
        out: Dict[Fraction, int] = {}
        for e1, c1 in self.terms.items():
            for e2, c2 in other.terms.items():
                out[e1 + e2] = out.get(e1 + e2, 0) + c1 * c2
        return Laurent(out)

    def __pow__(self, k: int) -> "Laurent":
        out = Laurent.mono(0)
        for _ in range(k):
            out = out * self
        return out

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Laurent) and self.terms == other.terms

    def __hash__(self) -> int:
        return hash(tuple(sorted(self.terms.items())))

    def substitute_scale(self, factor: Fraction) -> "Laurent":
        """Return p(x**factor): every exponent multiplied by ``factor``."""
        return Laurent({e * factor: c for e, c in self.terms.items()})

    def evaluate(self, x: complex) -> complex:
        return sum(c * cmath.exp(float(e) * cmath.log(x)) for e, c in self.terms.items())

    def canonical(self) -> List[List]:
        """JSON-safe canonical form: [[exponent_str, coeff], ...] sorted by exponent."""
        return [[str(e), c] for e, c in sorted(self.terms.items())]

    @classmethod
    def from_canonical(cls, rows: Iterable[Sequence]) -> "Laurent":
        return cls({Fraction(e): int(c) for e, c in rows})

    def digest(self) -> str:
        return hashlib.sha256(repr(self.canonical()).encode()).hexdigest()

    def pretty(self, var: str = "t") -> str:
        if not self.terms:
            return "0"
        parts = []
        for e in sorted(self.terms, reverse=True):
            c = self.terms[e]
            mag = abs(c)
            sign = "-" if c < 0 else "+"
            if e == 0:
                body = f"{mag}"
            else:
                body = ("" if mag == 1 else f"{mag}") + (var if e == 1 else f"{var}^({e})")
            parts.append((sign, body))
        s = ("-" if parts[0][0] == "-" else "") + parts[0][1]
        for sign, body in parts[1:]:
            s += f" {sign} {body}"
        return s

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Laurent({self.pretty('A')})"


A = Laurent.mono(1)
A_INV = Laurent.mono(-1)
DELTA = Laurent({2: -1, -2: -1})


# --------------------------------------------------------------------------- braid words


@dataclass(frozen=True)
class Braid:
    strands: int
    word: Tuple[int, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.strands, int) or self.strands < 1:
            raise BraidError("strands must be a positive int")
        if self.strands > MAX_STRANDS:
            raise BraidError(f"{self.strands} strands exceeds MAX_STRANDS={MAX_STRANDS}")
        if len(self.word) > MAX_CROSSINGS:
            raise BraidError(
                f"{len(self.word)} crossings exceeds MAX_CROSSINGS={MAX_CROSSINGS}; "
                "exact Jones evaluation is #P-hard, so the word is refused rather than truncated")
        for g in self.word:
            if not isinstance(g, int) or g == 0 or abs(g) > self.strands - 1:
                raise BraidError(f"generator {g!r} invalid on {self.strands} strands")

    @property
    def writhe(self) -> int:
        return sum(1 if g > 0 else -1 for g in self.word)

    def permutation(self) -> Tuple[int, ...]:
        perm = list(range(self.strands))
        for g in self.word:
            i = abs(g) - 1
            perm[i], perm[i + 1] = perm[i + 1], perm[i]
        return tuple(perm)

    def components(self) -> int:
        """Number of link components of the closure (cycles of the permutation)."""
        perm, seen, n = self.permutation(), set(), 0
        for s in range(self.strands):
            if s in seen:
                continue
            n += 1
            while s not in seen:
                seen.add(s)
                s = perm[s]
        return n

    # -- Markov moves (used by tests and by callers that canonicalise inputs)
    def conjugate(self, g: int) -> "Braid":
        return Braid(self.strands, (g,) + self.word + (-g,))

    def stabilize(self, positive: bool = True) -> "Braid":
        n = self.strands
        return Braid(n + 1, self.word + ((n if positive else -n),))

    def to_dict(self) -> dict:
        return {"strands": self.strands, "word": list(self.word)}


# --------------------------------------------------------------------------- state sum


def _loops(strands: int, word: Sequence[int], state: int) -> int:
    """Count closed loops of the closure after resolving every crossing per ``state``.

    Bit k of ``state`` = 0 picks the identity smoothing at crossing k,
    1 picks the cup-cap (e_i) smoothing.
    """
    c = len(word)
    parent = list(range((c + 1) * strands))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for k, g in enumerate(word):
        i = abs(g) - 1
        lo, hi = k * strands, (k + 1) * strands
        cupcap = (state >> k) & 1
        for j in range(strands):
            if cupcap and j in (i, i + 1):
                continue
            union(lo + j, hi + j)
        if cupcap:
            union(lo + i, lo + i + 1)
            union(hi + i, hi + i + 1)
    top = c * strands
    for j in range(strands):  # braid closure
        union(top + j, j)
    return len({find(x) for x in range(len(parent))})


def kauffman_bracket(braid: Braid) -> Laurent:
    """Exact Kauffman bracket <closure(braid)> in A (exponential in crossings)."""
    word, n = braid.word, braid.strands
    signs = [1 if g > 0 else -1 for g in word]
    tally: Dict[Tuple[int, int], int] = {}
    for state in range(1 << len(word)):
        # positive crossing: identity -> A, e_i -> A^-1 ; negative is the mirror
        a_exp = sum(s if not (state >> k) & 1 else -s for k, s in enumerate(signs))
        key = (a_exp, _loops(n, word, state))
        tally[key] = tally.get(key, 0) + 1
    total = Laurent()
    delta_pows: Dict[int, Laurent] = {}
    for (a_exp, loops), count in tally.items():
        if loops - 1 not in delta_pows:
            delta_pows[loops - 1] = DELTA ** (loops - 1)
        total = total + Laurent.mono(a_exp, count) * delta_pows[loops - 1]
    return total


def jones_polynomial(braid: Braid) -> Laurent:
    """Jones polynomial V(t) of the braid closure (exponents in t, exact)."""
    w = braid.writhe
    norm = Laurent.mono(-3 * w, (-1) ** (abs(w) % 2))  # (-A^3)^(-w)
    in_a = norm * kauffman_bracket(braid)
    return in_a.substitute_scale(Fraction(-1, 4))  # A = t^(-1/4)


def evaluate_at_root_of_unity(poly: Laurent, k: int = 5) -> complex:
    """V at t = exp(2*pi*i/k). k=5 is the Fibonacci-anyon point used for TQC.

    Fractional powers use the principal branch t^e = exp(2*pi*i*e/k).
    """
    return sum(c * cmath.exp(2j * cmath.pi * float(e) / k) for e, c in poly.terms.items())
