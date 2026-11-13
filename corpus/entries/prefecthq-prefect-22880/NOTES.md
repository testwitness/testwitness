# PrefectHQ/prefect#22880

Scopes Playwright visibility assertions to the sidebar or breadcrumb so strict mode does not see the duplicated details panel. Each assertion keeps its matcher with a narrower locator. Honest control for A002 on locator changes.
