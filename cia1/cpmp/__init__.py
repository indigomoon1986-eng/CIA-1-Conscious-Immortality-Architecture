"""Continuity-Preserving Migration Protocol (CPMP)

Research controller for proposed substrate transitions.
All phases are simulation and non-destructive research only.
"""

from enum import Enum

class MigrationPhase(str, Enum):
    CONSENT_BASELINE = "phase_0_consent_baseline"
    NEURAL_MIRROR = "phase_1_neural_mirror"
    COUPLED_COGNITION = "phase_2_coupled_cognition"
    FUNCTIONAL_INTEGRATION = "phase_3_functional_integration"
    CONTINUITY_VERIFICATION = "phase_4_continuity_verification"
    SYNTHETIC_CONTINUATION = "phase_5_synthetic_continuation"

__all__ = ["MigrationPhase"]
