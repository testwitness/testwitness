import pytest

from app.ledger import Ledger


class TestLedger:
    def test_balance_starts_at_opening(self):
        ledger = Ledger(opening=100)
        assert ledger.balance() == 100


    def test_post_moves_balance(self):
        ledger = Ledger(opening=100)
        ledger.post(-30, "refund")
        assert ledger.balance() == 70


    def test_rejects_zero_amount(self):
        ledger = Ledger()
        with pytest.raises(ValueError):
            ledger.post(0)
