import pytest

from app.cart import Cart


class TestCart:
    def test_total_of_empty_cart_is_zero(self):
        cart = Cart()
        assert cart.total() == 0


    def test_add_accepts_fractional_price(self):
        cart = Cart()
        cart.add("apple", 0.5, 2)
        cart.total()
