from app.cart import Cart


def stocked_cart():
    cart = Cart()
    cart.add("apple", 2, 3)
    return cart
