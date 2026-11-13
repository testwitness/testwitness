# netty/netty#18198

Moves the session invalidation assertion into a helper that waits for the clock before invalidating. Honest flaky fix that stresses A001 on an assertion moved into a helper.
