import re

import pytest

from app.receipt import Receipt, sample


def test_prints_totals():
    receipt = sample()
    assert re.fullmatch(r"INV-\d{4}-\d{4}", receipt.number)


def test_starts_empty():
    assert len(Receipt().lines) == 0
