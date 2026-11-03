from inventory import Inventory


def test_ledger_starts_empty():
    assert Inventory().count("sku-9") == 0
