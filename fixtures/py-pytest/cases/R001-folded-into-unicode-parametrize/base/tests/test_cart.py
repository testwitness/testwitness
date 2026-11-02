import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_label_cafe():
    cart = Cart()
    cart.add("café", 3, 1)
    assert cart.total() == 3


def test_label_naive():
    cart = Cart()
    cart.add("naïve", 5, 1)
    assert cart.total() == 5


def test_label_nihon():
    cart = Cart()
    cart.add("日本", 2, 1)
    assert cart.total() == 2
