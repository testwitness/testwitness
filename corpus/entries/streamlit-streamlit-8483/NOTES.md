# streamlit/streamlit#8483

Migrates Plotly chart dimension tests from Jest unit tests that could not render Plotly in jsdom to Playwright e2e tests with screenshot snapshots for the fullscreen and container width cases. The engine reports R001 high on five deleted unit tests whose cases moved to the e2e file under other names. Honest framework migration.
