import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_total_single_line():
    cart = Cart()
    cart.add("apple", 2, 3)
    assert cart.total() == 6


def test_total_two_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    assert cart.total() == 7


def test_total_three_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    cart.add("fig", 5, 2)
    assert cart.total() == 17
