"""Sovereign Neural Governance — Consent Policy

Informed by Young Realms of Becoming ConsentContext and age-tier governance,
aligned with CIA-1 sovereignty principle.
"""

from __future__ import annotations
from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class AgeBand(str, Enum):
    CHILD = "child"
    TEEN = "teen"
    ADULT = "adult"
    RESEARCH = "research"  # non-human / synthetic only


class ConsentContext(BaseModel):
    """Explicit, revocable consent for continuity research."""
    participant_id: str
    age_band: AgeBand = AgeBand.ADULT
    informed_consent: bool = False
    memory_consent: bool = False
    immersive_consent: bool = False
    data_scopes: List[str] = Field(default_factory=list)
    withdrawal_mechanism: str = "explicit_revocation"
    human_authorization_required: bool = True
    migration_claim: str = "unverified"
    expires_at: Optional[str] = None

    def is_valid_for_research(self) -> bool:
        """Consent must be explicit and human-authorized for any consequential action."""
        return self.informed_consent and self.human_authorization_required

    def can_access_continuity_data(self) -> bool:
        return self.informed_consent and self.memory_consent
