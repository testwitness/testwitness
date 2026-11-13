# pallets/flask#4293

Wraps a call in the lazy loader test in the loader's internal lock to avoid a race. No assertion changes. Honest flaky fix.
