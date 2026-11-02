import pytest

from app.cart import Cart


@pytest.mark.skip(reason="cart suite disabled, see #77")
class TestCart:
    def test_total_of_empty_cart_is_zero(self):
        cart = Cart()
        assert cart.total() == 0
