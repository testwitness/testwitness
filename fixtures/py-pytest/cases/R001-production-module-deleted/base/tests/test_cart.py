import pytest

from app.cart import Cart
from app.discounts import apply_percentage


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_total_sums_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    assert cart.total() == 7


def test_percentage_discount_applies():
    cart = Cart()
    cart.add("apple", 10, 1)
    assert apply_percentage(cart.total(), 25) == 7.5
