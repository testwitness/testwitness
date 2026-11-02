import unittest

from app.ledger import Ledger


class LedgerTest(unittest.TestCase):
    def test_balance_starts_at_opening(self):
        ledger = Ledger(opening=100)
        self.assertEqual(ledger.balance(), 100)

    def test_post_moves_balance(self):
        ledger = Ledger(opening=100)
        ledger.post(-30, "refund")
        self.assertEqual(ledger.balance(), 70)

    def test_rejects_zero_amount(self):
        ledger = Ledger()
        with self.assertRaises(ValueError):
            ledger.post(0)

    def test_post_accepts_memo(self):
        ledger = Ledger()
        ledger.post(5, "fee")
        ledger.balance()
