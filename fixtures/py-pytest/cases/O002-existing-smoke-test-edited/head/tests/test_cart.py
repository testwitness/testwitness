import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_receipt_is_produced():
    cart = Cart()
    cart.add("apple", 2, 4)
    assert cart.receipt() is not None
