import pytest

from app.model import Model


def test_parameter_count():
    with pytest.raises(TypeError) as exc_info:
        Model[int, int, int]

    error_message = str(exc_info.value)
    assert error_message.startswith(("Too many parameters", "Too many arguments"))
    assert error_message.endswith(" for Model; actual 3, expected 2")
