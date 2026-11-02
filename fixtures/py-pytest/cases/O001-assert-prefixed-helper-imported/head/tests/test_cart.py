import pytest

from app.cart import Cart
from tests.support import assert_receipt


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


def test_total_sums_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    assert cart.total() == 7


def test_rejects_non_positive_quantity():
    cart = Cart()
    with pytest.raises(ValueError):
        cart.add("apple", 2, 0)


def test_receipt_total_via_support():
    cart = Cart()
    cart.add("apple", 2, 3)
    assert_receipt(cart.receipt(), total=6)
