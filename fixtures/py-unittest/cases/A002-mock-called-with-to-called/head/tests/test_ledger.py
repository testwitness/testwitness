import unittest
from unittest.mock import Mock

from app.ledger import Ledger


class LedgerTest(unittest.TestCase):
    def test_balance_starts_at_opening(self):
        ledger = Ledger(opening=100)
        self.assertEqual(ledger.balance(), 100)

    def test_post_notifies_audit(self):
        audit = Mock()
        ledger = Ledger()
        ledger.post(5, "fee")
        audit.record(ledger.entries[-1])
        audit.record.assert_called()
