import unittest

from app.ledger import Ledger


class LedgerTest(unittest.TestCase):
    def test_balance_starts_at_opening(self):
        ledger = Ledger(opening=100)
        self.assertEqual(ledger.balance(), 100)

    def test_post_records_memo(self):
        ledger = Ledger()
        ledger.post(5, "fee")
        self.assertEqual(ledger.entries[0][0], 5)
        self.assertEqual(ledger.entries[0][1], "fee")
        self.assertEqual(ledger.entries[-1], (5, "fee"))
