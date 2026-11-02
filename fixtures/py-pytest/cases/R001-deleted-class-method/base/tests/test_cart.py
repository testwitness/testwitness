import pytest

from app.cart import Cart


class TestCart:
    def test_total_of_empty_cart_is_zero(self):
        cart = Cart()
        assert cart.total() == 0


    def test_total_sums_lines(self):
        cart = Cart()
        cart.add("apple", 2, 3)
        cart.add("pear", 1, 1)
        assert cart.total() == 7


    def test_rejects_non_positive_quantity(self):
        cart = Cart()
        with pytest.raises(ValueError):
            cart.add("apple", 2, 0)
