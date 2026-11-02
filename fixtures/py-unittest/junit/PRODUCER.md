# Producer

Two producers for the same unittest suite (`project/tests/test_shapes.py`), Python 3.13.18.

## junit.xml: pytest 9.1.1 running the unittest classes

    PYTHONPATH=. python -m pytest tests --junitxml=../junit/junit.xml

Console summary: `1 failed, 4 passed, 1 skipped, 1 xfailed, 3 subtests passed`.

## xmlrunner/: unittest-xml-reporting 4.0.0 (`xmlrunner`), one file per TestCase class

    PYTHONPATH=. python -m xmlrunner discover -s tests -t . -o ../junit/xmlrunner

Console summary: `FAILED (failures=1, skipped=1, expected failures=1)`. Installed with `pip install --break-system-packages unittest-xml-reporting`. File names carry a run timestamp (`TEST-<classname>-<YYYYMMDDHHMMSS>.xml`).
