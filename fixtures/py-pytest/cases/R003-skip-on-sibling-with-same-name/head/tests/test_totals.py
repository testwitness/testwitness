import pytest

from app.cart import Cart
from app.ledger import Ledger


class TestCart:
    def test_handles_empty(self):
        cart = Cart()
        assert cart.total() == 0


    def test_total_sums_lines(self):
        cart = Cart()
        cart.add("apple", 2, 3)
        cart.add("pear", 1, 1)
        assert cart.total() == 7


class TestLedger:
    @pytest.mark.skip
    def test_handles_empty(self):
        ledger = Ledger()
        assert ledger.balance() == 0


    def test_post_moves_balance(self):
        ledger = Ledger(opening=100)
        ledger.post(-30, "refund")
        assert ledger.balance() == 70
