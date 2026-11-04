"""Subjective Continuity Index (SCI)

SCI_t = Σ w_i * c_i(t)

Measures functional continuity indicators, not subjective experience itself.
A high SCI cannot establish numerical identity of a conscious subject.
"""

from __future__ import annotations
from typing import List, Optional
import numpy as np


class SubjectiveContinuityIndex:
    """Operational SCI score."""

    DEFAULT_WEIGHTS = [1/6] * 6  # equal weights; must be empirically calibrated

    def __init__(self, weights: Optional[List[float]] = None):
        if weights is None:
            weights = self.DEFAULT_WEIGHTS
        weights = np.array(weights, dtype=float)
        if len(weights) != 6:
            raise ValueError("Weights must have length 6")
        if np.any(weights < 0) or not np.isclose(weights.sum(), 1.0):
            raise ValueError("Weights must be non-negative and sum to 1")
        self.weights = weights

    def compute(self, continuity_vector: List[float]) -> float:
        if len(continuity_vector) != 6:
            raise ValueError("Continuity vector must have length 6")
        v = np.array(continuity_vector, dtype=float)
        # Normalize components to [0,1] if needed (caller responsibility)
        return float(np.dot(self.weights, v))

    def with_uncertainty(self, continuity_vector: List[float], variance: float = 0.05) -> dict:
        score = self.compute(continuity_vector)
        return {
            "sci": score,
            "uncertainty": variance,
            "lower": max(0.0, score - variance),
            "upper": min(1.0, score + variance),
            "note": "Functional continuity indicator only. Does not prove subjective identity.",
        }
