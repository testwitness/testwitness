import pytest

from app.cart import Cart


@pytest.fixture
def empty_cart():
    return Cart()


@pytest.fixture
def stocked_cart():
    cart = Cart()
    cart.add("apple", 2, 3)
    return cart
