"""Sovereign Neural Governance (SNG)

Consent, authorization, and restrictions on consequential actions.
"""

from pydantic import BaseModel

class ConsentPolicy(BaseModel):
    participant_id: str
    informed_consent: bool = False
    withdrawal_mechanism: str = "explicit_revocation"
    human_authorization_required: bool = True
    migration_claim: str = "unverified"

__all__ = ["ConsentPolicy"]
