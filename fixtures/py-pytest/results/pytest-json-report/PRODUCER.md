# Producer

- Framework: pytest 9.1.1 on Python 3.13.18, pytest-json-report 1.5.0 (with its dependency pytest-metadata 3.1.1) from PyPI, pytest-rerunfailures 16.7. Installed into a virtual environment on top of the system pytest: `python3 -m venv --system-site-packages /tmp/pyjr && /tmp/pyjr/bin/pip install pytest-json-report==1.5.0`.
- Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after the plugin wrote the files; they keep the absolute paths of the workspace.

## Commands (run from `project/`)

report.json:

    /tmp/pyjr/bin/python -m pytest tests/test_inventory.py -p no:cacheprovider \
      --json-report --json-report-file=../results/pytest-json-report/report.json

report-reruns.json (the test fails on its first attempt and passes on the rerun):

    rm -f tests/.rerun-counter
    /tmp/pyjr/bin/python -m pytest tests/test_rerun.py --reruns 2 -p no:cacheprovider \
      --json-report --json-report-file=../results/pytest-json-report/report-reruns.json

Console summaries: `1 failed, 7 passed, 2 skipped, 1 xfailed, 1 xpassed, 1 error` and `1 passed, 1 rerun`. The second report's summary is `{"rerun": 1, "total": 1, "collected": 1}` with no `passed` at all.
