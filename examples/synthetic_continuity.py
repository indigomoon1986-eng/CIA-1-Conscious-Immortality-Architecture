"""Example: Synthetic continuity vector and SCI computation.

Demonstrates functional continuity scoring only.
Does not claim subjective transfer.
"""

from cia1.continuity.tensor import ContinuityTensor
from cia1.continuity.sci import SubjectiveContinuityIndex
from cia1.sentium.core import SENTIUMState

def main():
    # Example continuity features (normalized 0-1)
    features = [0.92, 0.88, 0.85, 0.90, 0.75, 0.60]  # causal, memory, behavior, self, topology, embodiment

    tensor = ContinuityTensor(features)
    print("Continuity Vector:", tensor.vector.tolist())
    print("Tensor Frobenius norm:", round(tensor.frobenius_norm(), 4))

    sci = SubjectiveContinuityIndex()
    result = sci.with_uncertainty(features)
    print("SCI:", result)

    state = SENTIUMState()
    state.continuity.continuity_vector = features
    state.continuity.continuity_tensor = tensor.to_list()
    state.continuity.sci_score = result["sci"]
    state.compute_identity_anchor()

    print("\nSENTIUM State (canonical):")
    print(state.to_canonical_json())

if __name__ == "__main__":
    main()
