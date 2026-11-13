def ensure_total(cart, expected):
    assert cart.total() == expected


def ensure_receipt(cart, expected):
    receipt = cart.receipt()
    ensure_total(cart, receipt["total"])
    ensure_total(cart, expected)
