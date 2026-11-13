from app.parser import parse


def test_parses_digits():
    assert parse("42") == 42


def test_rejects_empty_input():
    err = None
    try:
        parse("")
    except Exception as e:
        err = e
    assert isinstance(err, ValueError)
    assert str(err) == "empty input"
