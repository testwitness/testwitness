from app.cart import Cart


def test_single_line():
    cart = Cart()
    cart.add("apple", 2, 3)
    assert cart.total() == 6
