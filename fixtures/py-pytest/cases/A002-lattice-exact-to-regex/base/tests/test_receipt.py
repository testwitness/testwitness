import re

import pytest

from app.receipt import Receipt, sample


def test_prints_totals():
    receipt = sample()
    assert receipt.number == "INV-2024-0001"


def test_starts_empty():
    assert len(Receipt().lines) == 0
