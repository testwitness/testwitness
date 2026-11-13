import pytest

from app.forms import post


@pytest.mark.parametrize("extra", ["ignore", "allow", "forbid"])
def test_submit(extra):
    response = post(extra)
    assert response.status_code == 200, response.text
