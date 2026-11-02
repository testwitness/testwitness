class Ledger:
    def __init__(self, opening=0):
        self.opening = opening
        self.entries = []

    def post(self, amount, memo=""):
        if amount == 0:
            raise ValueError("amount must not be zero")
        self.entries.append((amount, memo))

    def balance(self):
        return self.opening + sum(amount for amount, _ in self.entries)


class TrueUpEntry:
    def __init__(self, ledger):
        self.ledger = ledger

    @property
    def balanced(self):
        return self.ledger.balance() == 0
