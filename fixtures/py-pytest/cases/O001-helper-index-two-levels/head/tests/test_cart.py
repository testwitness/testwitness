from app.cart import Cart
from tests.support.checks import ensure_receipt


def test_single_line():
    cart = Cart()
    cart.add("apple", 2, 3)
    assert cart.total() == 6


def test_receipt_of_two_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    ensure_receipt(cart, 7)
