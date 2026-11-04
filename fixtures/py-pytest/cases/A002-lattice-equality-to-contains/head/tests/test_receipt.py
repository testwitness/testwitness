import re

import pytest

from app.receipt import Receipt, sample


def test_prints_totals():
    receipt = sample()
    assert "12.50" in receipt.summary()


def test_starts_empty():
    assert len(Receipt().lines) == 0
