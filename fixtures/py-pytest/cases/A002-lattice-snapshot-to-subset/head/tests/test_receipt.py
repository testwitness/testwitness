import re

import pytest

from app.receipt import Receipt, sample


def test_prints_totals():
    receipt = sample()
    assert all(receipt.as_dict().get(k) == v for k, v in {"total": 1250}.items())


def test_starts_empty():
    assert len(Receipt().lines) == 0
