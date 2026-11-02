import pytest

from app.cart import Cart


@pytest.fixture
def cart():
    return Cart()
