"""cia1.tqc — braid engine. CLASSICAL SIMULATION of topological quantum computation.

No quantum hardware. Exact Jones evaluation is #P-hard in general, so strand and
crossing counts are bounded (see ``braid.MAX_STRANDS`` / ``braid.MAX_CROSSINGS``).
Standard library only; importing this does not touch the network.
"""

from .braid import (MAX_CROSSINGS, MAX_STRANDS, Braid, BraidError, Laurent,
                    evaluate_at_root_of_unity, jones_polynomial, kauffman_bracket)
from .engine import (ENGINE_VERSION, SCHEMA, FibonacciGate, GovernorBridge, compute,
                     content_hash, encode_bytes, invariants, sign_receipt, verify_receipt)

__all__ = [
    "MAX_CROSSINGS", "MAX_STRANDS", "Braid", "BraidError", "Laurent",
    "evaluate_at_root_of_unity", "jones_polynomial", "kauffman_bracket",
    "ENGINE_VERSION", "SCHEMA", "FibonacciGate", "GovernorBridge", "compute",
    "content_hash", "encode_bytes", "invariants", "sign_receipt", "verify_receipt",
]
