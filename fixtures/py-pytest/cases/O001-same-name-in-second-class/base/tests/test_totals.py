import pytest

from app.cart import Cart
from app.ledger import Ledger


class TestCart:
    def test_handles_empty(self):
        cart = Cart()
        assert cart.total() == 0


class TestLedger:
    def test_post_moves_balance(self):
        ledger = Ledger(opening=100)
        ledger.post(-30, "refund")
        assert ledger.balance() == 70
