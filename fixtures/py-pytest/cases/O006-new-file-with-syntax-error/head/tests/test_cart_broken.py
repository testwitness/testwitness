from app.cart import Cart


def test_total_of_empty_cart_is_zero(
    cart = Cart()
    assert cart.total() == 0
