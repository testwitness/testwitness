from app.cart import Cart
from tests.support import show_receipt


def test_single_line():
    cart = Cart()
    cart.add("apple", 2, 3)
    assert cart.total() == 6


def test_receipt_of_two_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    show_receipt(cart.receipt())
