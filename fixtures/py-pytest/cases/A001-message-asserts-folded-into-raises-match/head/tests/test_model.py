import pytest

from app.model import Model


def test_parameter_count():
    with pytest.raises(TypeError, match="Too many arguments for Model; actual 3, expected 2"):
        Model[int, int, int]
