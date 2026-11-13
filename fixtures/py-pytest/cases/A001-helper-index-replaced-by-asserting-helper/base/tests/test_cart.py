from app.cart import Cart


def test_two_lines():
    cart = Cart()
    cart.add("apple", 2, 3)
    cart.add("pear", 1, 1)
    assert cart.total() == 7
    assert len(cart.lines) == 2
