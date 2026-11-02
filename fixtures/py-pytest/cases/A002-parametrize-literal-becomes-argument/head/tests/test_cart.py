import pytest

from app.cart import Cart


def test_total_of_empty_cart_is_zero():
    cart = Cart()
    assert cart.total() == 0


@pytest.mark.parametrize(
    "lines, expected",
    [
        ([("apple", 2, 3), ("pear", 1, 1)], 7),
        ([("apple", 2, 3)], 6),
    ],
)
def test_total_sums_lines(lines, expected):
    cart = Cart()
    for sku, price, qty in lines:
        cart.add(sku, price, qty)
    assert cart.total() == expected
