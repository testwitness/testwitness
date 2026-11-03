import pytest

from inventory import Inventory


def test_add_increases_count():
    inv = Inventory()
    inv.add("sku-1", 4)
    assert inv.count("sku-1") == 4


def test_remove_decreases_count():
    inv = Inventory()
    inv.add("sku-1", 3)
    inv.remove("sku-1", 2)
    assert inv.count("sku-1") == 1


@pytest.mark.skip(reason="not implemented yet")
def test_transfer_between_warehouses():
    assert False


@pytest.mark.skipif(True, reason="always skipped by a constant condition")
def test_skipped_by_constant():
    assert False


@pytest.mark.xfail(reason="known bug: negative removal is not rejected")
def test_xfail_that_fails():
    inv = Inventory()
    inv.add("sku-1", 1)
    inv.remove("sku-1", 5)


@pytest.mark.xfail(reason="expected to fail but passes")
def test_xfail_that_passes():
    assert 1 + 1 == 2


@pytest.mark.parametrize(
    "sku,qty",
    [
        pytest.param("plain", 1, id="plain"),
        pytest.param("with space", 2, id="with space/slash"),
        pytest.param("unicode", 3, id="ünïcode[brackets]"),
    ],
)
def test_add_parametrized(sku, qty):
    inv = Inventory()
    inv.add(sku, qty)
    inv.add(sku, qty)
    assert inv.count(sku) == 2 * qty


def test_fails_on_purpose():
    inv = Inventory()
    inv.add("sku-1", 2)
    assert inv.count("sku-1") == 5


@pytest.fixture
def broken_fixture():
    raise RuntimeError("fixture setup exploded")


def test_errors_in_fixture(broken_fixture):
    assert True


class TestInventoryClass:
    def test_rejects_non_positive(self):
        inv = Inventory()
        with pytest.raises(ValueError):
            inv.add("sku-1", 0)

    def test_count_defaults_to_zero(self):
        assert Inventory().count("absent") == 0
