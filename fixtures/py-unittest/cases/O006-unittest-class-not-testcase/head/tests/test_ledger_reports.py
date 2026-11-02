from app.ledger import Ledger


class LedgerReportChecks:
    def test_balance(self):
        assert Ledger(opening=3).balance() == 3
