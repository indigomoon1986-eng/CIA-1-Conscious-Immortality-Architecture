"""CIA-1 — Conscious Immortality Architecture

Monarch Sovereign Systems · SENTIUM Project · Leakean Physics
Author: Steven Craig Leake Jr.
Reconstructed edition: November 4, 2026

Research status: Conceptual architecture with implementable software components.
Conscious immortality and subjective transfer remain unproven.
"""

__version__ = "0.1.0-e1"
__author__ = "Steven Craig Leake Jr."

from .sentium.core import SENTIUMState
from .continuity.tensor import ContinuityTensor
from .continuity.sci import SubjectiveContinuityIndex
from .entrainment.brainprint import BrainprintSession
from .entrainment.resonance import ResonanceLock

__all__ = [
    "SENTIUMState",
    "ContinuityTensor",
    "SubjectiveContinuityIndex",
    "BrainprintSession",
    "ResonanceLock",
]
