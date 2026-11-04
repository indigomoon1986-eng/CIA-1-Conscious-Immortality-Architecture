"""SENTIUM Ontological Core

Structured cognitive-state and recursive observer representation.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
import hashlib
import json


class IdentityAnchor(BaseModel):
    subject_did: str = "did:monarch:example"
    identity_anchor: str = Field(default_factory=lambda: "sha256:" + hashlib.sha256(b"uninitialized").hexdigest())
    consent_policy: str = "owner-controlled"


class CognitionState(BaseModel):
    perception_state: Dict[str, Any] = Field(default_factory=dict)
    autobiographical_memory: Dict[str, Any] = Field(default_factory=dict)
    valuation_state: Dict[str, Any] = Field(default_factory=dict)
    intention_state: Dict[str, Any] = Field(default_factory=dict)
    self_model: Dict[str, Any] = Field(default_factory=dict)
    environment_model: Dict[str, Any] = Field(default_factory=dict)


class RecursionState(BaseModel):
    observer_model: Dict[str, Any] = Field(default_factory=dict)
    self_prediction: Dict[str, Any] = Field(default_factory=dict)
    prediction_error: Optional[float] = None
    recursive_depth: int = 0


class ContinuityState(BaseModel):
    causal_lineage: List[str] = Field(default_factory=list)
    continuity_vector: List[float] = Field(default_factory=list)
    continuity_tensor: List[List[float]] = Field(default_factory=list)
    sci_score: Optional[float] = None
    uncertainty: Optional[float] = None


class GovernanceState(BaseModel):
    human_authorization: str = "required"
    xtax_policy: str = "cia1-sovereign"
    provenance_required: bool = True
    migration_claim: str = "unverified"


class SENTIUMState(BaseModel):
    """Full SENTIUM cognitive state representation."""
    identity: IdentityAnchor = Field(default_factory=IdentityAnchor)
    cognition: CognitionState = Field(default_factory=CognitionState)
    recursion: RecursionState = Field(default_factory=RecursionState)
    continuity: ContinuityState = Field(default_factory=ContinuityState)
    governance: GovernanceState = Field(default_factory=GovernanceState)

    def to_canonical_json(self) -> str:
        return self.model_dump_json(indent=2)

    def compute_identity_anchor(self) -> str:
        payload = json.dumps(self.cognition.model_dump(), sort_keys=True).encode()
        digest = hashlib.sha256(payload).hexdigest()
        self.identity.identity_anchor = f"sha256:{digest}"
        return self.identity.identity_anchor

    def update_observer(self, observation: Dict[str, Any]) -> None:
        """Placeholder recursive observer update: R_{n+1} = O(R_n, X_t)"""
        self.recursion.observer_model.update(observation)
        self.recursion.recursive_depth += 1
        # Prediction error would be computed against expected self-model
        self.recursion.prediction_error = 0.0  # placeholder
