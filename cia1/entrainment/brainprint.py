"""Brainprint — cognitive map from an entrainment prescription.

Builds a montage-level band field, folds it into the CIA-1 continuity vector
(causal, memory, behavior, self, topology, embodiment), the outer-product
tensor Ξ, and an SCI score. Spatial phase and coherence rho come from the
Veritas distributor. Carrier lock comes from Veritas tone recovery.

Research model only. A brainprint is not an EEG, not a diagnosis, and not
proof that a subject continued.
"""

from __future__ import annotations

import hashlib
import math
from typing import Dict, List, Optional, Sequence

from .protocols import PROTOCOLS, Protocol
from .veritas_coherence import Mind, distribute
from .veritas_recover import recover_tone

BANDS = ("delta", "theta", "alpha", "smr", "beta", "gamma")
DIMS = ("causal", "memory", "behavior", "self", "topology", "embodiment")

BASE = {
    "delta": 0.22,
    "theta": 0.16,
    "alpha": 0.28,
    "smr": 0.08,
    "beta": 0.18,
    "gamma": 0.08,
}

# Absolute axis ceiling. Resting power sits well below it; a matched drive
# approaches 1 on its own axis. Axes are independent, so SCI can rise.
CEILING = 1.35

REGION = {
    "frontal": {"delta": 0.70, "theta": 0.90, "alpha": 0.75, "smr": 0.80, "beta": 1.25, "gamma": 1.15},
    "central": {"delta": 0.80, "theta": 0.75, "alpha": 0.85, "smr": 1.35, "beta": 1.05, "gamma": 0.80},
    "parietal": {"delta": 0.75, "theta": 1.05, "alpha": 1.20, "smr": 0.90, "beta": 0.80, "gamma": 0.70},
    "occipital": {"delta": 1.10, "theta": 0.85, "alpha": 1.35, "smr": 0.70, "beta": 0.60, "gamma": 0.55},
}

# id, svg_x, svg_y, torus_x, torus_y, hemisphere, region
ELECTRODES = (
    ("Fp1", 70, 52, 32, 18, "L", "frontal"),
    ("Fp2", 130, 52, 68, 18, "R", "frontal"),
    ("F3", 58, 88, 24, 34, "L", "frontal"),
    ("F4", 142, 88, 76, 34, "R", "frontal"),
    ("C3", 46, 124, 16, 52, "L", "central"),
    ("C4", 154, 124, 84, 52, "R", "central"),
    ("P3", 62, 160, 28, 70, "L", "parietal"),
    ("P4", 138, 160, 72, 70, "R", "parietal"),
    ("O1", 80, 192, 38, 88, "L", "occipital"),
    ("O2", 120, 192, 62, 88, "R", "occipital"),
)


def fnv(text: str) -> int:
    """32-bit FNV-1a. Shared with the browser model so signatures match."""
    h = 2166136261
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _unit(subject: str, electrode: str, band: str) -> float:
    n = fnv(f"{subject}|{electrode}|{band}") / 0xFFFFFFFF
    return (n * 2.0 - 1.0) * 0.045


def _depth(elapsed: float) -> float:
    return 1.0 - math.exp(-max(0.0, elapsed) / 12.0)


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _dist(a: Sequence[float], b: Sequence[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def trajectory_stability(points: Sequence[Sequence[float]]) -> float:
    """CIA ContinuityManifold proxy: span / path length, clipped to 1."""
    if len(points) < 2:
        return 1.0
    length = sum(_dist(points[i], points[i + 1]) for i in range(len(points) - 1))
    span = _dist(points[0], points[-1])
    if length < 1e-9:
        return 1.0
    return min(1.0, span / length)


def homology_h0(points: Sequence[Sequence[float]], threshold: float = 0.45) -> int:
    """0-dimensional connected-component proxy from cia1.topostat.homology."""
    n = len(points)
    if n == 0:
        return 0
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if _dist(points[i], points[j]) <= threshold:
                union(i, j)
    return len({find(i) for i in range(n)})


def band_power(subject: str, electrode: str, region: str, protocol: Protocol, elapsed: float) -> Dict[str, float]:
    depth = _depth(elapsed)
    spatial = REGION[region]
    out: Dict[str, float] = {}
    for band in BANDS:
        raw = BASE[band] + _unit(subject, electrode, band) + depth * protocol.gains[band] * spatial[band]
        out[band] = max(0.02, raw)
    return out


def _sine(freq: float, n: int, sr: int = 256) -> List[float]:
    return [math.sin(2.0 * math.pi * freq * i / sr) for i in range(n)]


def carrier_lock(beat_hz: float, subject: str) -> dict:
    """Bury the beat in subject-stable noise and recover it."""
    template = _sine(max(0.5, beat_hz), 64)
    noise = []
    for i in range(256):
        u = fnv(f"{subject}|noise|{i}") / 0xFFFFFFFF
        noise.append((u * 2.0 - 1.0) * 0.35)
    buried = noise[:]
    start = 48
    for j, sample in enumerate(template):
        buried[start + j] += sample
    quieter = [sample * 0.92 for sample in buried]
    # A weak noise reference so the LMS stage is actually in the chain.
    noise_ref = [sample * 0.15 for sample in noise]
    recovered = recover_tone([buried, quieter], template, noise_ref)
    peak = float(recovered["peak"])
    return {"peak": peak, "index": int(recovered["index"]), "lock": _clamp(peak / 6.0)}


def _anchor(subject: str, protocol_id: str, vector: Sequence[float], mode: str, rho: float) -> tuple[str, str]:
    payload = (
        f"{subject}|{protocol_id}|"
        + ",".join(f"{value:.3f}" for value in vector)
        + f"|{mode}|{rho:.3f}"
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return payload, f"sha256:{digest}"


class BrainprintSession:
    """One consented research session. Frames are deterministic given elapsed time."""

    def __init__(
        self,
        subject: str,
        protocol_id: str = "baseline",
        carrier_hz: float = 200.0,
        consent: bool = False,
        pin: Optional[str] = None,
    ):
        if protocol_id not in PROTOCOLS:
            raise ValueError(f"unknown protocol: {protocol_id}")
        if pin not in (None, "auto", "absorb", "focus"):
            raise ValueError("pin must be auto, absorb, focus, or None")
        self.subject = (subject or "").strip() or "did:monarch:session"
        self.protocol_id = protocol_id
        self.carrier_hz = float(carrier_hz)
        self.consent = bool(consent)
        self.pin = None if pin in (None, "auto") else pin
        self.history: List[List[float]] = []

    @property
    def protocol(self) -> Protocol:
        return PROTOCOLS[self.protocol_id]

    def frame(self, elapsed: float = 0.0) -> dict:
        if not self.consent:
            raise PermissionError(
                "SNG refusal: informed consent and human authorization are required before a brainprint frame is issued"
            )
        protocol = self.protocol
        elapsed = max(0.0, float(elapsed))
        per_site = []
        mean = {band: 0.0 for band in BANDS}
        left_power = 0.0
        right_power = 0.0
        left_n = 0
        right_n = 0
        best_id = ELECTRODES[0][0]
        best_total = -1.0
        for electrode in ELECTRODES:
            site_id, _sx, _sy, tx, ty, hemi, region = electrode
            powers = band_power(self.subject, site_id, region, protocol, elapsed)
            total = sum(powers.values())
            per_site.append((electrode, powers, total))
            for band in BANDS:
                mean[band] += powers[band]
            if hemi == "L":
                left_power += total
                left_n += 1
            else:
                right_power += total
                right_n += 1
            if total > best_total:
                best_total = total
                best_id = site_id
        n_sites = len(ELECTRODES)
        for band in BANDS:
            mean[band] /= n_sites
        total_mean = sum(mean.values()) or 1.0
        relative = {band: mean[band] / total_mean for band in BANDS}
        left_mean = left_power / max(1, left_n)
        right_mean = right_power / max(1, right_n)
        symmetry = 1.0 - abs(left_mean - right_mean) / max(1e-9, left_mean + right_mean)
        lock = carrier_lock(protocol.beat_hz, self.subject)
        # Beat used for lock is the protocol beat; carrier is the delivery frequency only.
        vector = [
            _clamp(mean["gamma"] / CEILING),
            _clamp(mean["theta"] / CEILING),
            _clamp(mean["beta"] / CEILING),
            _clamp(mean["alpha"] / CEILING),
            _clamp((mean["smr"] / CEILING) * (0.55 + 0.45 * symmetry)),
            _clamp((mean["delta"] / CEILING) * (0.70 + 0.30 * lock["lock"])),
        ]
        sci = sum(vector) / 6.0
        tensor = [[vector[i] * vector[j] for j in range(6)] for i in range(6)]
        frobenius = math.sqrt(sum(value * value for row in tensor for value in row))
        hits = 9 if protocol.id == "absorb" else sum(1 for value in relative.values() if value > 0.18)
        nodes = []
        site_cloud = []
        shard_meta = []
        for electrode, powers, total in per_site:
            site_id, sx, sy, tx, ty, hemi, region = electrode
            loss = (fnv(f"{self.subject}|loss|{site_id}") % 30) / 10.0
            batt = max(12.0, min(100.0, total * 22.0))
            nodes.append({"id": site_id, "x": tx, "y": ty, "batt": batt, "loss": loss})
            cloud = [powers[band] for band in BANDS]
            site_cloud.append(cloud)
            dominant = max(BANDS, key=lambda band: powers[band])
            shard_meta.append(
                {
                    "id": site_id,
                    "svgX": sx,
                    "svgY": sy,
                    "hemi": hemi,
                    "region": region,
                    "total": total,
                    "dominant": dominant,
                    "powers": cloud,
                }
            )
        pinned_mind = None
        if self.pin in ("absorb", "focus"):
            pinned_mind = Mind(mode=self.pin, pinned=True)
        mind = distribute(nodes, [], hits, 1, best_id, pinned_mind)
        by_id = {shard.id: shard for shard in mind.shards}
        for meta in shard_meta:
            shard = by_id[meta["id"]]
            meta["amp"] = shard.amp
            meta["phase"] = shard.phase
        path = self.history + [vector]
        payload, anchor = _anchor(self.subject, protocol.id, vector, mind.mode, mind.rho)
        self.history.append(vector)
        if len(self.history) > 64:
            self.history = self.history[-64:]
        return {
            "subject": self.subject,
            "protocol": protocol.id,
            "phase": protocol.phase,
            "title": protocol.title,
            "elapsed": elapsed,
            "depth": _depth(elapsed),
            "carrier_hz": self.carrier_hz,
            "beat_hz": protocol.beat_hz,
            "audio": protocol.audio,
            "relative": relative,
            "vector": vector,
            "dimensions": list(DIMS),
            "sci": sci,
            "uncertainty": 0.05,
            "lower": max(0.0, sci - 0.05),
            "upper": min(1.0, sci + 0.05),
            "tensor": tensor,
            "frobenius": frobenius,
            "symmetry": symmetry,
            "lock": lock["lock"],
            "lock_index": lock["index"],
            "lock_peak": lock["peak"],
            "rho": mind.rho,
            "mode": mind.mode,
            "pinned": mind.pinned,
            "locus": mind.locus,
            "entangled": list(mind.pairs),
            "shards": shard_meta,
            "stability": trajectory_stability(path),
            "px": vector[3] - vector[2],
            "py": vector[1] - vector[0],
            "h0": homology_h0(site_cloud, 0.28),
            "anchor_input": payload,
            "anchor": anchor,
            "note": "Functional continuity indicator only. Does not prove subjective identity.",
        }
