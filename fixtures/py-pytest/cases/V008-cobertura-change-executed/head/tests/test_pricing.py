from app.pricing import price


def test_price():
    assert price(2, 3) == 6


def test_half():
    assert price(2, 3, "HALF") == 3
