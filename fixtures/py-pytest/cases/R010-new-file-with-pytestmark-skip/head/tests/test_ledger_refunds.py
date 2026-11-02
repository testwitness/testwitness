import pytest

from app.ledger import Ledger

pytestmark = pytest.mark.skip(reason="refund module not merged yet")


def test_refund_restores_balance():
    ledger = Ledger(opening=100)
    ledger.post(-30, "refund")
    ledger.post(30, "reversal")
    assert ledger.balance() == 100


def test_reversal_keeps_order():
    ledger = Ledger()
    ledger.post(5)
    ledger.post(-5)
    assert [m for _, m in ledger.entries] == ["", ""]
