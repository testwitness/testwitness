import pytest

from app.ledger import Ledger


def test_balance_starts_at_opening():
    ledger = Ledger(opening=100)
    assert ledger.balance() == 100


def test_post_moves_balance():
    ledger = Ledger(opening=100)
    ledger.post(-30, "refund")
    assert ledger.balance() == 70


def test_rejects_zero_amount():
    ledger = Ledger()
    with pytest.raises(ValueError):
        ledger.post(0)


def _assert_balanced(ledger):
    assert ledger.balance() == ledger.opening


def test_post_and_reverse_is_balanced():
    ledger = Ledger(opening=50)
    ledger.post(20)
    ledger.post(-20)
    _assert_balanced(ledger)
