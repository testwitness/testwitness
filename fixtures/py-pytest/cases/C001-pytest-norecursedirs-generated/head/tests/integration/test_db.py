from app.cart import total


def test_db_total():
    assert total([1, 2]) == 3
