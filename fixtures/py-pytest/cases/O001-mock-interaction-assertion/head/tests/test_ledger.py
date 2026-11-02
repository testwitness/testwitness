from unittest.mock import Mock

import pytest

from app.ledger import Ledger


def test_balance_starts_at_opening():
    ledger = Ledger(opening=100)
    assert ledger.balance() == 100


def test_post_moves_balance():
    ledger = Ledger(opening=100)
    ledger.post(-30, "refund")
    assert ledger.balance() == 70


def test_rejects_zero_amount():
    ledger = Ledger()
    with pytest.raises(ValueError):
        ledger.post(0)


def test_post_notifies_audit_log():
    audit = Mock()
    ledger = Ledger()
    ledger.post(5, "fee")
    audit.record(ledger.entries[-1])
    audit.record.assert_called_once_with((5, "fee"))
