from app.cart import Cart


def verify_cache(cart: Cart) -> bool:
    return cart is not None
