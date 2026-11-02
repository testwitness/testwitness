class Cart:
    def __init__(self):
        self.items = []

    def add(self, sku, unit_price, quantity=1):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        self.items.append((sku, unit_price, quantity))

    def total(self):
        return round(sum(price * qty for _, price, qty in self.items), 2)

    def receipt(self):
        return {"total": self.total(), "currency": "USD", "lines": len(self.items)}
