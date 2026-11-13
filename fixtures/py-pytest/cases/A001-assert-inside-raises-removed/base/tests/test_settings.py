import pytest

from app.settings import Settings


def test_unknown_setting_is_an_attribute_error():
    settings = Settings(region="eu")
    assert settings.region == "eu"
    with pytest.raises(AttributeError):
        assert settings.timeout
