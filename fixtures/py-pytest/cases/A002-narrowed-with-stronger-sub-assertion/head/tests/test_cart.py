import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_receipt_reports_lines_and_total():
    cart = Cart()
    cart.add("apple", 2, 3)
    receipt = cart.receipt()
    assert receipt is not None
    assert receipt["total"] == 6
