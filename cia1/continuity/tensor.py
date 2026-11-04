"""Continuity Tensor Ξ

Second-order representation of continuity dimensions.
Ξ_t = ξ_t ξ_t^⊤
"""

from __future__ import annotations
from typing import List
import numpy as np


class ContinuityTensor:
    """Reconstructed Continuity Tensor Ξ."""

    DIMENSIONS = [
        "causal",
        "memory",
        "behavior",
        "self",
        "topology",
        "embodiment",
    ]

    def __init__(self, vector: List[float] | None = None):
        if vector is None:
            vector = [0.0] * 6
        if len(vector) != 6:
            raise ValueError("Continuity vector must have exactly 6 components")
        self.vector = np.array(vector, dtype=float)
        self.tensor = np.outer(self.vector, self.vector)

    @classmethod
    def from_features(
        cls,
        causal: float = 0.0,
        memory: float = 0.0,
        behavior: float = 0.0,
        self_model: float = 0.0,
        topology: float = 0.0,
        embodiment: float = 0.0,
    ) -> "ContinuityTensor":
        return cls([causal, memory, behavior, self_model, topology, embodiment])

    def to_list(self) -> List[List[float]]:
        return self.tensor.tolist()

    def frobenius_norm(self) -> float:
        return float(np.linalg.norm(self.tensor, ord="fro"))

    def __repr__(self) -> str:
        return f"ContinuityTensor(vector={self.vector.tolist()})"
