def check_receipt(receipt, total):
    assert receipt["total"] == total


def assert_receipt(receipt, total):
    assert receipt["total"] == total
