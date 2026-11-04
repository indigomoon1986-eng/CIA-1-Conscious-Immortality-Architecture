"""Basic tests for Continuity Tensor and SCI."""

import pytest
from cia1.continuity.tensor import ContinuityTensor
from cia1.continuity.sci import SubjectiveContinuityIndex

def test_tensor_outer_product():
    t = ContinuityTensor([1.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    assert t.tensor[0, 0] == 1.0
    assert t.tensor[0, 1] == 0.0

def test_sci_equal_weights():
    sci = SubjectiveContinuityIndex()
    score = sci.compute([1.0] * 6)
    assert abs(score - 1.0) < 1e-6

def test_sci_rejects_bad_weights():
    with pytest.raises(ValueError):
        SubjectiveContinuityIndex([0.5, 0.5])
