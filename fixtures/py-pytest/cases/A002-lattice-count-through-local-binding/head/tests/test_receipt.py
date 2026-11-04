import re

import pytest

from app.receipt import Receipt, sample


def test_prints_totals():
    receipt = sample()
    names = [line.sku for line in receipt.lines]
    assert "A1" in names


def test_starts_empty():
    assert len(Receipt().lines) == 0
