import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_receipt_reports_lines_and_total():
    cart = Cart()
    cart.add("apple", 2, 3)
    receipt = cart.receipt()

    def _unused_check():
        assert receipt["total"] == 99

    assert receipt["total"] == 6
    assert receipt["currency"] == "USD"
    assert receipt["lines"] == 1
