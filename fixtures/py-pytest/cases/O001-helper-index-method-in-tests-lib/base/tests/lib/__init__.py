from app.cart import Cart


class CartResult:
    """Wraps a cart with checks shared by the functional tests."""

    def __init__(self, cart):
        self.cart = cart

    def did_total(self, expected):
        assert self.cart.total() == expected, self.cart.lines


def make_cart(*lines):
    cart = Cart()
    for name, qty, price in lines:
        cart.add(name, qty, price)
    return CartResult(cart)
