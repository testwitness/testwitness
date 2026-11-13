def ensure_total(cart, expected):
    assert cart.total() == expected


def ensure_lines(cart, count):
    assert len(cart.lines) == count
