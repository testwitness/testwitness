from inventory import Inventory


class TestRestock:
    def test_restock_adds(self):
        inv = Inventory()
        inv.add("sku-1", 1)
        inv.add("sku-1", 1)
        assert inv.count("sku-1") == 2
