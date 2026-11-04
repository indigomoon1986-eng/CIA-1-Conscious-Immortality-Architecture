"""ContinuityManifold — Geometric trajectory analysis for cognitive states.

Adapted from sophia-manifold-cognition (ManifoldEngine) for CIA-1 E2 research.
Maps continuity vectors and SENTIUM states onto a Riemannian manifold to study
trajectory shape, geodesic distances, and topological stability.

Does not establish subjective identity or consciousness.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence


@dataclass
class ManifoldPoint:
    """A point on the continuity manifold."""
    coordinates: List[float]
    label: str = ""
    timestamp: Optional[float] = None

    @property
    def dimensions(self) -> int:
        return len(self.coordinates)

    def norm(self) -> float:
        return math.sqrt(sum(c * c for c in self.coordinates))


class ContinuityManifold:
    """Manifold embedding for continuity vectors and cognitive-state trajectories.

    Supports Euclidean, hyperbolic, and spherical geometries for research comparison.
    """

    def __init__(self, dimensions: int = 6, geometry: str = "euclidean"):
        if dimensions < 1:
            raise ValueError("dimensions must be positive")
        if geometry not in ("euclidean", "hyperbolic", "spherical"):
            raise ValueError("geometry must be euclidean, hyperbolic, or spherical")
        self.dimensions = dimensions
        self.geometry = geometry
        self._points: Dict[str, ManifoldPoint] = {}

    def embed_vector(self, vector: Sequence[float], label: str = "") -> ManifoldPoint:
        """Embed a continuity vector (or any feature vector) as a manifold point."""
        coords = list(vector)[: self.dimensions]
        while len(coords) < self.dimensions:
            coords.append(0.0)
        point = ManifoldPoint(coordinates=coords, label=label)
        if label:
            self._points[label] = point
        return point

    def geodesic_distance(self, p: ManifoldPoint, q: ManifoldPoint) -> float:
        """Compute geodesic distance under the chosen geometry."""
        if p.dimensions != q.dimensions:
            raise ValueError("dimension mismatch")
        sq = sum((a - b) ** 2 for a, b in zip(p.coordinates, q.coordinates))
        eucl = math.sqrt(sq)
        if self.geometry == "euclidean":
            return eucl
        if self.geometry == "hyperbolic":
            np_ = min(p.norm(), 0.999)
            nq_ = min(q.norm(), 0.999)
            denom = (1 - np_ ** 2) * (1 - nq_ ** 2)
            arg = 1.0 + 2.0 * sq / max(denom, 1e-9)
            return math.acosh(max(arg, 1.0))
        # spherical
        np_ = p.norm() or 1.0
        nq_ = q.norm() or 1.0
        dot = sum(a * b for a, b in zip(p.coordinates, q.coordinates)) / (np_ * nq_)
        return math.acos(max(-1.0, min(1.0, dot)))

    def trajectory_length(self, points: Sequence[ManifoldPoint]) -> float:
        """Total length of a trajectory (sum of consecutive geodesic distances)."""
        if len(points) < 2:
            return 0.0
        return sum(
            self.geodesic_distance(points[i], points[i + 1])
            for i in range(len(points) - 1)
        )

    def topological_stability(self, trajectory: Sequence[ManifoldPoint]) -> float:
        """Simple stability score: inverse of normalized path curvature proxy.

        Higher score = more stable trajectory (lower average step size relative to span).
        Research metric only.
        """
        if len(trajectory) < 2:
            return 1.0
        length = self.trajectory_length(trajectory)
        span = self.geodesic_distance(trajectory[0], trajectory[-1])
        if length < 1e-9:
            return 1.0
        return min(1.0, span / length)
