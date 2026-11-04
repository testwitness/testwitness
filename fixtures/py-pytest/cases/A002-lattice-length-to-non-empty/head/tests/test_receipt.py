import re

import pytest

from app.receipt import Receipt, sample


def test_prints_totals():
    receipt = sample()
    assert receipt.lines


def test_starts_empty():
    assert len(Receipt().lines) == 0
