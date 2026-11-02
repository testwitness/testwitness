class Cart:
    def __init__(self):
        self.items = []

    def add(self, sku, unit_price, quantity=1):
        if unit_price < 0:
            raise ValueError("price must not be negative")
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        self.items.append((sku, unit_price, quantity))

    def total(self):
        return sum(price * qty for _, price, qty in self.items)

    def receipt(self):
        return {"total": self.total(), "currency": "USD", "lines": len(self.items)}
