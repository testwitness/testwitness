# Producer

- Framework: pytest 9.1.1 on Python 3.13.18, built in junitxml plugin (`--junitxml`).
- Plugin for reruns: pytest-rerunfailures 16.7 (`pip install --break-system-packages pytest-rerunfailures`).
- The rerun test uses a file counter at `project/tests/.rerun-counter` (gitignored); delete it before the rerun run.

## Commands (run from `project/`)

junit.xml (default family, xunit2):

    python -m pytest tests/test_inventory.py --junitxml=../junit/junit.xml

junit-legacy.xml (`junit_family=legacy`, adds `file` and `line` attributes):

    python -m pytest tests/test_inventory.py -o junit_family=legacy --junitxml=../junit/junit-legacy.xml

junit-reruns.xml (one test that fails on the first attempt and passes on the rerun):

    rm -f tests/.rerun-counter && python -m pytest tests/test_rerun.py --reruns 2 --junitxml=../junit/junit-reruns.xml

Console summaries: first two runs `1 failed, 7 passed, 2 skipped, 1 xfailed, 1 xpassed, 1 error`; rerun run `1 passed, 1 rerun`.
