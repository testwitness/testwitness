class Cart:
    def __init__(self):
        self.lines = []

    def add(self, name, qty, price):
        if qty <= 0:
            raise ValueError("quantity")
        self.lines.append((name, qty, price))

    def total(self):
        return sum(q * p for _, q, p in self.lines)

    def receipt(self):
        return {"lines": len(self.lines), "total": self.total()}
