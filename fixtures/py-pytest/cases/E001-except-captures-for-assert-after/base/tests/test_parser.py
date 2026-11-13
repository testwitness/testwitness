from app.parser import parse


def test_parses_digits():
    assert parse("42") == 42
