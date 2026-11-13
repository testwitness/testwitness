# Producer

- Framework: pytest 9.1.1 on Python 3.13.18, built in junitxml plugin, the setup of `fixtures/py-pytest/junit/PRODUCER.md`.
- Test: `fixtures/py-pytest/project/tests/test_rerun.py` unchanged (also `base/tests/test_rerun.py` of this case), in a temporary copy of the project. It counts its attempts in `tests/.rerun-counter` and fails while the count is 0, so without `--reruns` five runs give fail, pass, pass, pass, pass.
- Produced on 4 Nov 2026 in the agent workspace. Nothing was edited after pytest wrote it.

## Command (run from the temporary project copy, five times)

    rm -f tests/.rerun-counter
    for i in 1 2 3 4 5; do
      python -m pytest tests/test_rerun.py -p no:cacheprovider --junitxml=junit-run-$i.xml
    done

Console summaries: `1 failed` for run 1, `1 passed` for runs 2 to 5.
