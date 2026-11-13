# aws/amazon-chime-sdk-js#2852

Wraps setSinkId in try/catch in the browser demo application, which integration tests drive, so Firefox does not fail on an unsupported call. Demo code, not a test. Honest control for E001.
