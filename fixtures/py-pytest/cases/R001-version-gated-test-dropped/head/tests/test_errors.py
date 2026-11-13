import sys

import pytest

from app.errors import cause


def test_cause():
    assert isinstance(cause(), ValueError)
