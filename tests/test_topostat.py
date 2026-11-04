"""Basic tests for TopoStat and fork experiment logic."""

from cia1.topostat.homology import PersistentHomologyStub
from cia1.topostat.manifold import ContinuityManifold
from cia1.luca.operators import RelationalOperator

def test_homology_stub_empty():
    stub = PersistentHomologyStub()
    assert stub.compute([]) == []

def test_manifold_distance():
    m = ContinuityManifold(dimensions=2)
    p = m.embed_vector([1.0, 0.0], "a")
    q = m.embed_vector([0.0, 1.0], "b")
    assert m.geodesic_distance(p, q) > 0

def test_relational_compose():
    op = RelationalOperator()
    r1 = op.relate("self", "has", "memory")
    r2 = op.relate("memory", "supports", "continuity")
    composed = op.compose(r1, r2)
    assert composed is not None
    assert composed.object == "continuity"
