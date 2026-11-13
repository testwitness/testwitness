import sys

import pytest

from app.errors import cause


def test_cause():
    assert isinstance(cause(), ValueError)


@pytest.mark.skipif(sys.version_info >= (3, 11), reason="legacy, pre 3.11 only")
def test_cause_legacy():
    from exceptiongroup import BaseExceptionGroup

    assert not isinstance(cause(), BaseExceptionGroup)
