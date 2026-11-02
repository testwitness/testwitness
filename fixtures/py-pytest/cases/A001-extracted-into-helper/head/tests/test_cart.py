import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def _assert_receipt(receipt, total, lines):
    assert receipt["total"] == total
    assert receipt["currency"] == "USD"
    assert receipt["lines"] == lines


def test_receipt_reports_lines_and_total():
    cart = Cart()
    cart.add("apple", 2, 3)
    receipt = cart.receipt()
    _assert_receipt(receipt, total=6, lines=1)
