import pytest

from app.ledger import Ledger, TrueUpEntry


def test_balance_starts_at_opening():
    ledger = Ledger(opening=100)
    assert ledger.balance() == 100


def test_post_moves_balance():
    ledger = Ledger(opening=100)
    ledger.post(-30, "refund")
    assert ledger.balance() == 70


def test_true_up_entry_is_balanced():
    ledger = Ledger(opening=100)
    ledger.post(-100, "write off")
    assert TrueUpEntry(ledger).balanced
