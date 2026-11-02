import pytest

from app.cart import Cart
from app.ledger import Ledger


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_total_sums_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    assert cart.total() == 7


def test_rejects_non_positive_quantity():
    cart = Cart()
    with pytest.raises(ValueError):
        cart.add("apple", 2, 0)


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
