# streamlit/streamlit#13813

Wraps the changed files Playwright pytest step so exit code 5 (no tests collected) exits 0. The job now passes when the changed files select no test. The engine reads --suppress-no-test-exit-code but not explicit exit code 5 handling in a workflow script (missed). Stresses C003 on exit code handling.
