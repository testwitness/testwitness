from app.ledger import Ledger


def check_balance_is_opening():
    ledger = Ledger(opening=5)
    assert ledger.balance() == 5


def check_post_is_recorded():
    ledger = Ledger()
    ledger.post(1)
    assert len(ledger.entries) == 1
