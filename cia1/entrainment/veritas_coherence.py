"""Quantum-consciousness distributor, ported for CIA-1.

Source: indigomoon1986-eng/veritash-experimental
  sophia/consciousness.py @ dc5cbe5f7b65d7a0b9c66cb7b0fe2465639c5469
  (itself folded from monarch-sovereign sophiaQuantumConsciousnessCore)

Shards sit on a torus. Coherence rho decides absorb (scatter) or focus (one locus).
A pinned mind holds its mode. This does not establish subjective experience.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import pi


@dataclass
class Shard:
    id: str
    amp: float
    phase: float


@dataclass
class Mind:
    mode: str = "absorb"
    rho: float = 0.0
    shards: list[Shard] = field(default_factory=list)
    ent: int = 0
    locus: str | None = None
    pinned: bool = False
    pairs: list[tuple[str, str]] = field(default_factory=list)


def distribute(
    nodes: list[dict],
    severed: list[str],
    hits: int,
    wind_p: int,
    focus: str,
    pinned: Mind | None = None,
) -> Mind:
    live = [node for node in nodes if node["id"] not in severed]
    shards: list[Shard] = []
    for node in live:
        theta = node["x"] / 100 * pi * 2
        phi = node["y"] / 100 * pi * 2
        amp = round(max(0.05, (node["batt"] / 100) * (1 - min(node["loss"], 10) / 10)), 2)
        phase = round(((theta + wind_p * phi) % (pi * 2) + pi * 2) % (pi * 2), 2)
        shards.append(Shard(node["id"], amp, phase))
    mean = sum(shard.amp for shard in shards) / (len(shards) or 1)
    variance = sum((shard.amp - mean) ** 2 for shard in shards) / (len(shards) or 1)
    rho = round(max(0.0, min(0.995, 1 - variance)), 3)
    ent = 0
    pairs: list[tuple[str, str]] = []
    for i, a in enumerate(shards):
        for b in shards[i + 1 :]:
            delta = abs(a.phase - b.phase)
            if min(delta, pi * 2 - delta) < 0.45:
                ent += 1
                pairs.append((a.id, b.id))
    dense = hits > 6 or len(severed) > 0 or rho < 0.7
    hold = pinned.pinned if pinned else False
    mode = pinned.mode if hold and pinned else ("absorb" if dense else "focus")
    mind = Mind(mode, rho, shards, ent, focus if mode == "focus" else None, hold, pairs)
    return mind
