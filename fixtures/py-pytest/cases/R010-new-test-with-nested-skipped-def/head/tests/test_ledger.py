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


def test_refund_restores_balance():
    @pytest.mark.skip
    def test_scratch():
        assert False

    ledger = Ledger(opening=100)
    ledger.post(-30, "refund")
    ledger.post(30, "reversal")
    assert ledger.balance() == 100
