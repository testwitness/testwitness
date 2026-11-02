import pytest

from app.ledger import Ledger


def test_balance_starts_at_opening():
    ledger = Ledger(opening=250)
    ledger.post(10)
    assert ledger.balance() == 260
