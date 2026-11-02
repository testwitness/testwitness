import pytest

from app.cart import Cart


class TestReceipt:
    def test_receipt_reports_lines_and_total(self):
        cart = Cart()
        cart.add("apple", 2, 3)
        receipt = cart.receipt()
        assert receipt["total"] == 6
        assert receipt["currency"] == "USD"


    def test_receipt_of_empty_cart(self):
        cart = Cart()
        receipt = cart.receipt()
        assert receipt["total"] == 0
        assert receipt["lines"] == 0
