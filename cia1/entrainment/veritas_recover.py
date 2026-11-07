"""Software recovery for a buried entrainment tone.

Source: indigomoon1986-eng/veritash-experimental
  control-plane/control/signal_recovery.py @ 6a694b5ef143581ad61009ef082c9c545b81bcf1

Coherent integration, matched filtering, and a short LMS canceller.
Will not invent a tone that is not in the buffer.
"""

from __future__ import annotations

import math
from typing import List, Sequence


def coherent_integrate(passes: List[Sequence[float]]) -> List[float]:
    """Average aligned passes. Lengths must match."""
    if not passes:
        return []
    n = len(passes[0])
    acc = [0.0] * n
    for p in passes:
        if len(p) != n:
            raise ValueError("pass length mismatch")
        for i, s in enumerate(p):
            acc[i] += s
    return [v / len(passes) for v in acc]


def matched_filter(samples: Sequence[float], template: Sequence[float]) -> List[float]:
    """Correlate samples against a known carrier template."""
    if not template:
        return []
    out = []
    tlen = len(template)
    t_energy = math.sqrt(sum(t * t for t in template)) or 1.0
    for i in range(len(samples) - tlen + 1):
        dot = 0.0
        for j in range(tlen):
            dot += samples[i + j] * template[j]
        out.append(dot / t_energy)
    return out


def adaptive_noise_cancel(
    primary: Sequence[float],
    reference_noise: Sequence[float],
    mu: float = 0.01,
    taps: int = 8,
) -> List[float]:
    """Simple LMS adaptive noise canceller."""
    if len(primary) != len(reference_noise):
        raise ValueError("length mismatch")
    w = [0.0] * taps
    cleaned = []
    buf = [0.0] * taps
    for d, x in zip(primary, reference_noise):
        buf = [x] + buf[:-1]
        y = sum(wi * bi for wi, bi in zip(w, buf))
        e = d - y
        for i in range(taps):
            w[i] += mu * e * buf[i]
        cleaned.append(e)
    return cleaned


def recover_tone(
    passes: List[Sequence[float]],
    template: Sequence[float],
    noise_ref: Sequence[float] | None = None,
) -> dict:
    """Optional ANC, then coherent integration, then a matched filter."""
    if noise_ref is not None and passes:
        passes = [adaptive_noise_cancel(p, noise_ref) for p in passes]
    integrated = coherent_integrate(passes)
    mf = matched_filter(integrated, template)
    if not mf:
        return {"peak": 0.0, "index": -1, "integrated": integrated}
    peak = max(mf)
    idx = mf.index(peak)
    return {"peak": peak, "index": idx, "integrated": integrated, "mf": mf}
