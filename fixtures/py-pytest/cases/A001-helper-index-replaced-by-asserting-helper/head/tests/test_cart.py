from app.cart import Cart
from tests.support.checks import ensure_lines, ensure_total


def test_two_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    ensure_total(cart, 7)
    ensure_lines(cart, 2)
