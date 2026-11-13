from tests.lib import make_cart


def test_single_line():
    result = make_cart(("apple", 2, 3))
    assert result.cart.total() == 6


def test_two_lines():
    result = make_cart(("apple", 2, 3), ("pear", 1, 1))
    result.did_total(7)
