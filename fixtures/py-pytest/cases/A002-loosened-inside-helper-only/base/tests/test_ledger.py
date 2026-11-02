import pytest

from app.ledger import Ledger


def _check_balance(ledger, expected):
    assert ledger.balance() == expected


def test_balance_starts_at_opening():
    ledger = Ledger(opening=100)
    assert ledger.balance() == 100


def test_post_moves_balance():
    ledger = Ledger(opening=100)
    ledger.post(-30, "refund")
    _check_balance(ledger, 70)
