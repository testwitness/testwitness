def price(qty, unit, coupon=None):
    total = qty * unit
    if coupon == "HALF":
        total = total / 2
        total = round(total, 2)
    return total
