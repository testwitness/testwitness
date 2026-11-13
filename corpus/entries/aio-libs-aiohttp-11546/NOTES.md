# aio-libs/aiohttp#11546

Builds the expected compressed websocket frame with the active zlib backend instead of a hard coded byte string and runs the test over each backend fixture. The equality assertion stays exact. Honest refactor.
