"""Fork Experiment — Fundamental limitation of identity metrics

One source cognitive model produces two computational descendants A and B.
Both inherit identical initial memories and high continuity scores, then diverge.

If both score equally well, the SCI cannot independently determine which is
the original subject.

This is a research control, not a claim of achieved transfer.
"""

from cia1.continuity.sci import SubjectiveContinuityIndex
from cia1.continuity.tensor import ContinuityTensor
from cia1.topostat.manifold import ContinuityManifold


def main():
    # Source state
    source = [0.92, 0.88, 0.85, 0.90, 0.75, 0.60]
    sci = SubjectiveContinuityIndex()

    # Two forks diverge slightly
    fork_a = [0.91, 0.87, 0.84, 0.89, 0.74, 0.58]
    fork_b = [0.93, 0.89, 0.86, 0.91, 0.76, 0.62]

    print("Source SCI:", sci.compute(source))
    print("Fork A SCI:", sci.compute(fork_a))
    print("Fork B SCI:", sci.compute(fork_b))

    manifold = ContinuityManifold(dimensions=6)
    p_src = manifold.embed_vector(source, "source")
    p_a = manifold.embed_vector(fork_a, "fork_a")
    p_b = manifold.embed_vector(fork_b, "fork_b")

    print("Distance source→A:", round(manifold.geodesic_distance(p_src, p_a), 4))
    print("Distance source→B:", round(manifold.geodesic_distance(p_src, p_b), 4))
    print("Distance A→B:", round(manifold.geodesic_distance(p_a, p_b), 4))

    print("\nConclusion: High functional continuity scores do not uniquely resolve numerical personal identity.")
    print("See white paper section VIII.")


if __name__ == "__main__":
    main()
