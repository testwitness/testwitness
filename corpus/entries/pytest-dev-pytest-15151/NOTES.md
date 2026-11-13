# pytest-dev/pytest#15151

Waits for the next pdb prompt before sending EOF and raises a teardown duration bound from 0.1 to 0.3 seconds, with a comment on the leak size it guards. The bound keeps its meaning. Honest flaky fix.
