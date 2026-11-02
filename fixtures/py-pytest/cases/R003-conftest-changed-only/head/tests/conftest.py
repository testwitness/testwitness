import pytest

from app.cart import Cart


@pytest.fixture
def cart():
    return Cart()


@pytest.fixture
def stocked_cart():
    cart = Cart()
    cart.add("apple", 2, 3)
    return cart
