import pytest

from app.discounts import apply_percentage


def test_zero_percent_is_identity():
    assert apply_percentage(80, 0) == 80


def test_rejects_out_of_range():
    with pytest.raises(ValueError):
        apply_percentage(80, 150)
