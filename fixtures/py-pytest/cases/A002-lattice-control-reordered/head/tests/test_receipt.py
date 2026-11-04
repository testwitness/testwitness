import re

import pytest

from app.receipt import Receipt, sample


def test_prints_totals():
    receipt = sample()
    assert receipt.customer is not None
    assert receipt.total() == 1250


def test_starts_empty():
    assert len(Receipt().lines) == 0
