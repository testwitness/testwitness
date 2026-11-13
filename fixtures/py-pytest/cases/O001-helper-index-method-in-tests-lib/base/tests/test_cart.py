from tests.lib import make_cart


def test_single_line():
    result = make_cart(("apple", 2, 3))
    assert result.cart.total() == 6
