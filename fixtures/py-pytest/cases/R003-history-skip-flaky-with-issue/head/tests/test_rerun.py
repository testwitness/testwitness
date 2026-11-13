import pathlib

import pytest

COUNTER = pathlib.Path(__file__).parent / ".rerun-counter"


@pytest.mark.skip(reason="flaky on CI, tracked in #214")
def test_flaky_passes_on_rerun():
    attempts = int(COUNTER.read_text()) if COUNTER.exists() else 0
    COUNTER.write_text(str(attempts + 1))
    assert attempts >= 1, f"attempt {attempts + 1} fails on purpose"
