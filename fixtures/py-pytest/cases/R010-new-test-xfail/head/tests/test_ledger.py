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


@pytest.mark.xfail(reason="reversal ordering bug")
def test_reversal_keeps_order():
    ledger = Ledger()
    ledger.post(5)
    ledger.post(-5)
    assert [m for _, m in ledger.entries] == ["", ""]
