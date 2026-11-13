# home-assistant/core#183837

Decorates a test callback with @callback so it runs in the event loop instead of an executor, removing out of order appends. Honest two line flaky fix.
