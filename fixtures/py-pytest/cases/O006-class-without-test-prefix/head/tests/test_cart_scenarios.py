from app.cart import Cart


class CartScenarios:
    def test_empty(self):
        assert Cart().total() == 0

    def test_one_line(self):
        cart = Cart()
        cart.add("apple", 2, 1)
        assert cart.total() == 2
