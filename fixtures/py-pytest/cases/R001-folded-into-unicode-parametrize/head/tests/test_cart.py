import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


@pytest.mark.parametrize(
    "sku, price",
    [("café", 3), ("naïve", 5), ("日本", 2)],
    ids=["café", "naïve", "日本"],
)
def test_unicode_sku_totals(sku, price):
    cart = Cart()
    cart.add(sku, price, 1)
    assert cart.total() == price
