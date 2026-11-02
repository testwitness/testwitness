from app.cart import Cart


def build_cases():
    def test_empty():
        assert Cart().total() == 0

    def test_one():
        cart = Cart()
        cart.add("apple", 2, 1)
        assert cart.total() == 2

    return [test_empty, test_one]
