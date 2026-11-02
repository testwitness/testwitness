import pytest

from app.cart import Cart


class TestCart:
    def test_total_of_empty_cart_is_zero(self):
        cart = Cart()
        assert cart.total() == 0
